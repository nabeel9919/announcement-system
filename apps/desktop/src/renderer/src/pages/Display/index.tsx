import { useEffect, useState } from 'react'
import { cn, formatTime, formatDate } from '../../lib/utils'

interface DisplayCall {
  displayNumber: string
  windowLabel: string
  windowId: string
  calledAt: string
}

interface CategoryStat {
  code: string
  label: string
  color: string
  waiting: number
  called: number
}

interface DisplayState {
  currentCalls: DisplayCall[]
  organizationName: string
  tickerText?: string
  categories: CategoryStat[]
  totalWaiting: number
}

export default function DisplayPage() {
  const [state, setState] = useState<DisplayState>({
    currentCalls: [],
    organizationName: 'Announcement System',
    tickerText: 'Welcome — Please take your ticket and wait to be called',
    categories: [],
    totalWaiting: 0,
  })
  const [time, setTime] = useState(new Date())
  const [flash, setFlash] = useState(false)
  const [broadcast, setBroadcast] = useState<string | null>(null)

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    window.api.display.onUpdate((payload: any) => {
      if (payload?.type === 'call') {
        const call: DisplayCall = {
          displayNumber: payload.displayNumber ?? '—',
          windowLabel: payload.windowLabel ?? 'Window',
          windowId: payload.windowId,
          calledAt: payload.timestamp,
        }
        setState((prev) => {
          const others = prev.currentCalls.filter((c) => c.windowId !== call.windowId)
          return { ...prev, currentCalls: [call, ...others].slice(0, 6) }
        })
        setFlash(true)
        setTimeout(() => setFlash(false), 1200)
      }

      if (payload?.type === 'queue_stats') {
        setState((prev) => ({
          ...prev,
          categories: payload.categories ?? [],
          totalWaiting: payload.totalWaiting ?? 0,
        }))
      }

      if (payload?.type === 'config') {
        setState((prev) => ({ ...prev, ...payload.config }))
      }

      if (payload?.type === 'broadcast') {
        setBroadcast(payload.text as string)
        setTimeout(() => setBroadcast(null), 30_000)
      }
    })

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

      {/* ── Emergency broadcast overlay ─────────────────────────────── */}
      {broadcast && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-red-950/95">
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

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-zinc-800/60 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center">
            <span className="text-white font-bold text-xs">AS</span>
          </div>
          <div>
            <p className="text-base font-semibold text-zinc-100">{state.organizationName}</p>
            <p className="text-xs text-zinc-500">{formatDate(time)}</p>
          </div>
        </div>
        <p className="text-4xl font-bold tabular-nums text-zinc-100">{formatTime(time)}</p>
      </header>

      {/* ── Body: two-column ───────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left: Now Serving (65%) */}
        <main className="flex-1 flex flex-col items-center justify-center px-8 py-6 gap-6">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-[0.3em]">Now Serving</p>

          {mainCall ? (
            <>
              <div className={cn(
                'w-full max-w-xl rounded-3xl border-2 p-8 text-center transition-all duration-500',
                flash
                  ? 'border-primary-400 bg-primary-600/20 shadow-[0_0_60px_rgba(99,102,241,0.4)]'
                  : 'border-zinc-700 bg-zinc-900/60'
              )}>
                <p className="font-display font-extrabold tracking-tight text-white leading-none"
                  style={{ fontSize: 'clamp(4rem, 12vw, 10rem)' }}>
                  {mainCall.displayNumber}
                </p>
                <p className="text-xl font-semibold text-primary-400 mt-3">{mainCall.windowLabel}</p>
              </div>

              {otherCalls.length > 0 && (
                <div className="flex gap-3 w-full max-w-xl">
                  {otherCalls.map((call, i) => (
                    <div key={i} className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-center">
                      <p className="font-display font-extrabold text-zinc-100"
                        style={{ fontSize: 'clamp(1.8rem, 4vw, 3.5rem)' }}>
                        {call.displayNumber}
                      </p>
                      <p className="text-xs text-zinc-500 mt-1">{call.windowLabel}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 opacity-30">
              <div className="w-20 h-20 rounded-full border-2 border-zinc-700 flex items-center justify-center">
                <p className="text-3xl font-bold text-zinc-600">—</p>
              </div>
              <p className="text-zinc-600 text-base">Waiting for calls...</p>
            </div>
          )}
        </main>

        {/* Right: Queue Board (35%) */}
        <aside className="w-80 border-l border-zinc-800/60 bg-zinc-900/30 flex flex-col">
          <div className="px-5 py-4 border-b border-zinc-800/60">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Queue Status</p>
            {state.totalWaiting > 0 && (
              <p className="text-2xl font-bold text-amber-400 mt-0.5">{state.totalWaiting}
                <span className="text-sm font-normal text-zinc-500 ml-1">waiting</span>
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {state.categories.length > 0 ? (
              state.categories.map((cat) => (
                <div key={cat.code} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                      <p className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">{cat.code}</p>
                    </div>
                    <span className={cn(
                      'text-xs font-medium px-2 py-0.5 rounded-full',
                      cat.waiting === 0 ? 'bg-zinc-800 text-zinc-500' : 'bg-amber-400/10 text-amber-400'
                    )}>
                      {cat.waiting === 0 ? 'Clear' : `${cat.waiting} waiting`}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 truncate">{cat.label}</p>
                  {cat.called > 0 && (
                    <p className="text-xs text-primary-400 mt-1">{cat.called} being served</p>
                  )}
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-32 opacity-30">
                <p className="text-zinc-600 text-sm text-center">Queue data will<br />appear here</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ── Ticker ────────────────────────────────────────────────── */}
      <footer className="border-t border-zinc-800/60 bg-zinc-900/40 py-2.5 overflow-hidden flex-shrink-0">
        <p className="text-xs text-zinc-400 whitespace-nowrap animate-ticker" style={{ animationDuration: '40s' }}>
          {state.tickerText ?? 'Welcome — Please take your ticket and wait to be called'}
          {'   ·   '}
          {state.tickerText ?? 'Welcome — Please take your ticket and wait to be called'}
        </p>
      </footer>
    </div>
  )
}
