import { useEffect, useState } from 'react'
import { cn, formatTime, formatDate } from '../../lib/utils'

interface DisplayCall {
  displayNumber: string
  windowLabel: string
  windowId: string
  calledAt: string
}

interface DisplayState {
  currentCalls: DisplayCall[]   // currently serving (one per window)
  organizationName: string
  tickerText?: string
  logoText?: string
}

/**
 * Public Display Screen
 * Shown on the TV/second monitor.
 * Receives updates from the operator window via IPC.
 */
export default function DisplayPage() {
  const [state, setState] = useState<DisplayState>({
    currentCalls: [],
    organizationName: 'Announcement System',
    tickerText: 'Welcome — Please take your ticket and wait to be called',
  })
  const [time, setTime] = useState(new Date())
  const [flash, setFlash] = useState(false)
  const [broadcast, setBroadcast] = useState<string | null>(null)

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Listen for display updates from operator
  useEffect(() => {
    window.api.display.onUpdate((payload: any) => {
      if (payload?.type === 'call') {
        const call: DisplayCall = {
          displayNumber: payload.displayNumber ?? payload.text?.match(/([A-Z\-\s\d]+)/)?.[0]?.trim() ?? '—',
          windowLabel: payload.windowLabel ?? 'Window',
          windowId: payload.windowId,
          calledAt: payload.timestamp,
        }

        setState((prev) => {
          const others = prev.currentCalls.filter((c) => c.windowId !== call.windowId)
          return { ...prev, currentCalls: [call, ...others].slice(0, 6) }
        })

        // Flash effect
        setFlash(true)
        setTimeout(() => setFlash(false), 1200)
      }

      if (payload?.type === 'config') {
        setState((prev) => ({ ...prev, ...payload.config }))
      }

      if (payload?.type === 'broadcast') {
        setBroadcast(payload.text as string)
        // Auto-dismiss after 30 seconds
        setTimeout(() => setBroadcast(null), 30_000)
      }
    })

    // Load config from main
    async function loadConfig() {
      const config = await window.api.config.read()
      if (config?.installationConfig) {
        setState((prev) => ({
          ...prev,
          organizationName: config.installationConfig.organizationName,
        }))
      }
    }
    loadConfig()
  }, [])

  const mainCall = state.currentCalls[0]
  const otherCalls = state.currentCalls.slice(1)

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white overflow-hidden select-none">

      {/* ── Emergency broadcast overlay ───────────────────────────────── */}
      {broadcast && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-red-950/95 animate-fade-in">
          <div className="w-20 h-20 rounded-full bg-red-600/30 border-2 border-red-500 flex items-center justify-center mb-8">
            <span className="text-4xl">⚠</span>
          </div>
          <p className="text-red-300 text-lg font-semibold uppercase tracking-widest mb-6">Announcement</p>
          <p className="text-white text-4xl font-bold text-center max-w-3xl leading-snug px-8">{broadcast}</p>
          <button onClick={() => setBroadcast(null)}
            className="mt-12 px-8 py-3 rounded-xl border border-red-500/40 text-red-300 text-sm hover:bg-red-900/40 transition-colors">
            Dismiss
          </button>
        </div>
      )}

      {/* ── Header bar ───────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-10 py-5 border-b border-zinc-800/60">
        <div className="flex items-center gap-4">
          {/* Logo placeholder */}
          <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">AS</span>
          </div>
          <div>
            <p className="text-lg font-semibold text-zinc-100">{state.organizationName}</p>
            <p className="text-xs text-zinc-500">Public Display Screen</p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-3xl font-display font-bold tabular-nums text-zinc-100">
            {formatTime(time)}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">{formatDate(time)}</p>
        </div>
      </header>

      {/* ── Main display area ─────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center px-10 py-8 gap-8">

        {/* NOW SERVING label */}
        <p className="text-sm font-semibold text-zinc-500 uppercase tracking-[0.3em]">Now Serving</p>

        {mainCall ? (
          <>
            {/* Primary call — large */}
            <div
              className={cn(
                'w-full max-w-2xl rounded-3xl border-2 p-10 text-center transition-all duration-500',
                flash
                  ? 'border-primary-400 bg-primary-600/20 shadow-[0_0_60px_rgba(99,102,241,0.4)]'
                  : 'border-zinc-700 bg-zinc-900/60'
              )}
            >
              <p
                className="font-display font-extrabold tracking-tight text-white leading-none"
                style={{ fontSize: 'clamp(5rem, 14vw, 11rem)' }}
              >
                {mainCall.displayNumber}
              </p>
              <p className="text-2xl font-semibold text-primary-400 mt-4">{mainCall.windowLabel}</p>
            </div>

            {/* Secondary calls — smaller row */}
            {otherCalls.length > 0 && (
              <div className="flex gap-4 w-full max-w-2xl">
                {otherCalls.map((call, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 text-center"
                  >
                    <p className="font-display font-extrabold text-zinc-100"
                      style={{ fontSize: 'clamp(2rem, 5vw, 4rem)' }}>
                      {call.displayNumber}
                    </p>
                    <p className="text-sm text-zinc-500 mt-1">{call.windowLabel}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          /* Idle state */
          <div className="flex flex-col items-center gap-4 opacity-40">
            <div className="w-24 h-24 rounded-full border-2 border-zinc-700 flex items-center justify-center">
              <p className="text-4xl font-display font-bold text-zinc-600">—</p>
            </div>
            <p className="text-zinc-600 text-lg">Waiting for calls...</p>
          </div>
        )}
      </main>

      {/* ── Footer ticker ─────────────────────────────────────────────────── */}
      <footer className="border-t border-zinc-800/60 bg-zinc-900/40 py-3 overflow-hidden">
        <div className="flex">
          <p
            className="text-sm text-zinc-400 whitespace-nowrap animate-ticker"
            style={{ animationDuration: '40s' }}
          >
            {state.tickerText ?? 'Welcome — Please take your ticket and wait to be called'}
            {'  ·  '}
            {state.tickerText ?? 'Welcome — Please take your ticket and wait to be called'}
          </p>
        </div>
      </footer>
    </div>
  )
}
