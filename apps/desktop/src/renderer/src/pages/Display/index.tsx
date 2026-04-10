import { useEffect, useState, useRef, useCallback } from 'react'
import { cn, formatTime, formatDate } from '../../lib/utils'

interface DisplayCall {
  displayNumber: string
  windowLabel: string
  windowId: string
  calledAt: string
  text?: string
}

interface CategoryStat {
  code: string
  label: string
  color: string
  waiting: number
  called: number
}

interface DisplayState {
  organizationName: string
  tickerText: string
  categories: CategoryStat[]
  totalWaiting: number
}

interface VideoEntry {
  name: string
  fileUrl: string
}

// ── Lower-third visibility states ────────────────────────────────────────────
type LowerThirdState = 'hidden' | 'entering' | 'visible' | 'leaving'

const LOWER_THIRD_DURATION_MS = 10_000  // how long it stays visible
const ENTER_DURATION_MS = 600
const LEAVE_DURATION_MS = 500

export default function DisplayPage() {
  const [state, setState] = useState<DisplayState>({
    organizationName: 'Announcement System',
    tickerText: 'Welcome — Please take your ticket and wait to be called',
    categories: [],
    totalWaiting: 0,
  })
  const [time, setTime] = useState(new Date())
  const [broadcast, setBroadcast] = useState<string | null>(null)

  // ── Video playlist ─────────────────────────────────────────────────────────
  const [videos, setVideos] = useState<VideoEntry[]>([])
  const [currentVideoIdx, setCurrentVideoIdx] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const broadcastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Lower-third ────────────────────────────────────────────────────────────
  const [lowerThirdState, setLowerThirdState] = useState<LowerThirdState>('hidden')
  const [activeCall, setActiveCall] = useState<DisplayCall | null>(null)
  const [recentCalls, setRecentCalls] = useState<DisplayCall[]>([])
  const lowerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [progress, setProgress] = useState(100)  // 100→0 over LOWER_THIRD_DURATION_MS

  // ── Clock ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // ── Load config + videos ───────────────────────────────────────────────────
  useEffect(() => {
    window.api.display.register().catch(() => {})

    window.api.config.read().then((config: any) => {
      if (config?.installationConfig) {
        setState((prev) => ({
          ...prev,
          organizationName: config.installationConfig.organizationName ?? prev.organizationName,
          tickerText: config.installationConfig.tickerText ?? prev.tickerText,
        }))
      }
    })

    window.api.videos.list().then((list) => {
      setVideos(list.map((v) => ({ name: v.name, fileUrl: v.fileUrl })))
    })
  }, [])

  // ── Advance playlist on video end ──────────────────────────────────────────
  const onVideoEnded = useCallback(() => {
    setCurrentVideoIdx((prev) => (videos.length > 0 ? (prev + 1) % videos.length : 0))
  }, [videos.length])

  useEffect(() => {
    const vid = videoRef.current
    if (!vid || videos.length === 0) return
    vid.src = videos[currentVideoIdx]?.fileUrl ?? ''
    vid.load()
    vid.play().catch(() => { /* autoplay blocked — user must interact first */ })
  }, [currentVideoIdx, videos])

  // ── Lower-third trigger ────────────────────────────────────────────────────
  const showLowerThird = useCallback((call: DisplayCall) => {
    // Clear any existing timer
    if (lowerTimerRef.current) clearTimeout(lowerTimerRef.current)
    if (progressRef.current) clearInterval(progressRef.current)

    setActiveCall(call)
    setProgress(100)
    setLowerThirdState('entering')

    // After enter animation, mark visible
    setTimeout(() => setLowerThirdState('visible'), ENTER_DURATION_MS)

    // Start progress countdown
    const startTime = Date.now()
    progressRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, 100 - (elapsed / LOWER_THIRD_DURATION_MS) * 100)
      setProgress(remaining)
      if (remaining === 0) {
        clearInterval(progressRef.current!)
        progressRef.current = null
      }
    }, 100)

    // After duration, start leave animation
    lowerTimerRef.current = setTimeout(() => {
      setLowerThirdState('leaving')
      setTimeout(() => setLowerThirdState('hidden'), LEAVE_DURATION_MS)
    }, LOWER_THIRD_DURATION_MS)
  }, [])

  // ── IPC updates ───────────────────────────────────────────────────────────
  useEffect(() => {
    window.api.display.onUpdate((payload: any) => {
      if (!payload) return

      if (payload.type === 'call') {
        const call: DisplayCall = {
          displayNumber: payload.displayNumber ?? '—',
          windowLabel: payload.windowLabel ?? 'Counter',
          windowId: payload.windowId ?? 'default',
          calledAt: payload.timestamp ?? new Date().toISOString(),
          text: payload.text,
        }
        setRecentCalls((prev) => {
          const others = prev.filter((c) => c.windowId !== call.windowId)
          return [call, ...others].slice(0, 5)
        })
        showLowerThird(call)
      }

      if (payload.type === 'queue_stats') {
        setState((prev) => ({
          ...prev,
          categories: payload.categories ?? prev.categories,
          totalWaiting: payload.totalWaiting ?? prev.totalWaiting,
        }))
      }

      if (payload.type === 'broadcast') {
        if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current)
        setBroadcast(payload.text as string)
        broadcastTimerRef.current = setTimeout(() => setBroadcast(null), 30_000)
      }

      if (payload.type === 'config') {
        setState((prev) => ({ ...prev, ...payload.config }))
      }
    })
  }, [showLowerThird])

  // ── DB polling for queue stats ─────────────────────────────────────────────
  useEffect(() => {
    async function poll() {
      try {
        const [tickets, cats] = await Promise.all([
          window.api.tickets.list(),
          window.api.categories.list(),
        ])
        const tix = tickets as any[]
        const categories = cats as any[]
        const catStats: CategoryStat[] = categories.map((cat: any) => ({
          code: cat.code,
          label: cat.label,
          color: cat.color,
          waiting: tix.filter((t) => t.categoryId === cat.id && t.status === 'waiting').length,
          called: tix.filter((t) => t.categoryId === cat.id && t.status === 'called').length,
        }))
        setState((prev) => ({
          ...prev,
          categories: catStats,
          totalWaiting: catStats.reduce((s, c) => s + c.waiting, 0),
        }))
      } catch { /* ignore */ }
    }
    poll()
    const interval = setInterval(poll, 5_000)
    return () => clearInterval(interval)
  }, [])

  const noVideos = videos.length === 0

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0a0a0f] select-none">

      {/* ══ BACKGROUND VIDEO ══════════════════════════════════════════════════ */}
      {!noVideos ? (
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay
          muted
          playsInline
          onEnded={onVideoEnded}
        />
      ) : (
        /* Fallback: dark gradient when no videos loaded */
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a0f] via-zinc-900 to-[#0a0a0f]" />
      )}

      {/* ══ DARK SCRIM — keeps text readable over any video ════════════════ */}
      <div className="absolute inset-0 bg-black/45 pointer-events-none" />

      {/* ══ TOP BAR ══════════════════════════════════════════════════════════ */}
      <header className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-8 py-4
                         bg-gradient-to-b from-black/70 to-transparent">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary-600/90 flex items-center justify-center shadow-lg">
            <span className="text-white font-bold text-xs">AS</span>
          </div>
          <div>
            <p className="text-base font-semibold text-white drop-shadow">{state.organizationName}</p>
            <p className="text-xs text-white/60">{formatDate(time)}</p>
          </div>
        </div>
        <p className="text-5xl font-bold tabular-nums text-white drop-shadow-lg">{formatTime(time)}</p>
      </header>

      {/* ══ QUEUE BOARD — right panel ════════════════════════════════════════ */}
      <aside className="absolute top-0 right-0 bottom-0 z-10 w-64 flex flex-col
                        bg-black/50 backdrop-blur-md border-l border-white/10">
        <div className="px-5 py-4 border-b border-white/10 mt-[72px]">
          <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Queue Status</p>
          {state.totalWaiting > 0 && (
            <p className="text-2xl font-bold text-amber-400 mt-0.5">
              {state.totalWaiting}
              <span className="text-sm font-normal text-white/40 ml-1">waiting</span>
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {state.categories.length > 0 ? (
            state.categories.map((cat) => (
              <div key={cat.code} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                    <p className="text-xs font-bold text-white/80 uppercase tracking-wide">{cat.code}</p>
                  </div>
                  <span className={cn(
                    'text-xs font-medium px-2 py-0.5 rounded-full',
                    cat.waiting === 0 ? 'bg-white/5 text-white/30' : 'bg-amber-400/15 text-amber-300'
                  )}>
                    {cat.waiting === 0 ? 'Clear' : `${cat.waiting} waiting`}
                  </span>
                </div>
                <p className="text-xs text-white/40 truncate">{cat.label}</p>
                {cat.called > 0 && (
                  <p className="text-xs text-primary-400 mt-1">{cat.called} being served</p>
                )}
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center h-32">
              <p className="text-white/20 text-sm text-center">Queue data<br />appears here</p>
            </div>
          )}
        </div>

        {/* Recent calls mini-list */}
        {recentCalls.length > 1 && (
          <div className="border-t border-white/10 p-3 space-y-1.5">
            <p className="text-xs text-white/30 uppercase tracking-wider mb-2">Recent</p>
            {recentCalls.slice(1, 4).map((call, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-sm font-bold text-white/60">{call.displayNumber}</span>
                <span className="text-xs text-white/30">{call.windowLabel}</span>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* ══ TICKER ═══════════════════════════════════════════════════════════ */}
      <div className="absolute bottom-0 left-0 right-0 z-10
                      bg-gradient-to-t from-black/70 to-transparent py-3 px-4 overflow-hidden">
        <p className="text-xs text-white/60 whitespace-nowrap animate-ticker" style={{ animationDuration: '50s' }}>
          {state.tickerText}{'   ·   '}{state.tickerText}{'   ·   '}{state.tickerText}
        </p>
      </div>

      {/* ══ LOWER-THIRD OVERLAY ══════════════════════════════════════════════ */}
      {lowerThirdState !== 'hidden' && activeCall && (
        <div
          className={cn(
            'absolute left-0 right-64 z-20 bottom-8',
            'transition-all',
          )}
          style={{
            transform: lowerThirdState === 'entering' || lowerThirdState === 'leaving'
              ? 'translateY(120%)'
              : 'translateY(0)',
            opacity: lowerThirdState === 'leaving' ? 0 : 1,
            transitionDuration: lowerThirdState === 'entering'
              ? `${ENTER_DURATION_MS}ms`
              : `${LEAVE_DURATION_MS}ms`,
            transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <div className="mx-8 rounded-2xl overflow-hidden shadow-2xl shadow-black/60">
            {/* Progress bar at top */}
            <div className="h-1 bg-white/10">
              <div
                className="h-full bg-primary-500 transition-none"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Content */}
            <div className="bg-black/80 backdrop-blur-xl px-8 py-5 flex items-center gap-6
                            border border-white/10 border-t-0">
              {/* Bell icon */}
              <div className="w-14 h-14 rounded-full bg-primary-600/30 border-2 border-primary-500/60
                              flex items-center justify-center flex-shrink-0 animate-pulse">
                <span className="text-2xl">🔔</span>
              </div>

              {/* Ticket info */}
              <div className="flex-1 min-w-0">
                <p className="text-white/60 text-sm font-medium uppercase tracking-widest mb-1">
                  Now Calling
                </p>
                <p className="text-white font-extrabold leading-none"
                   style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', letterSpacing: '0.04em' }}>
                  {activeCall.displayNumber}
                </p>
              </div>

              {/* Window */}
              <div className="text-right flex-shrink-0 max-w-[200px]">
                <p className="text-white/50 text-xs uppercase tracking-widest mb-1">Proceed to</p>
                <p className="text-primary-300 font-bold text-xl leading-tight truncate">{activeCall.windowLabel}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ NO-VIDEO IDLE STATE (centre) — only when no videos ══════════════ */}
      {noVideos && lowerThirdState === 'hidden' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-5 pr-64">
          {recentCalls.length > 0 ? (
            <div className="text-center">
              <p className="text-white/30 text-xs uppercase tracking-[0.3em] mb-6">Now Serving</p>
              <p className="font-extrabold text-white leading-none drop-shadow-2xl"
                 style={{ fontSize: 'clamp(5rem, 15vw, 12rem)', letterSpacing: '0.04em' }}>
                {recentCalls[0].displayNumber}
              </p>
              <p className="text-primary-400 text-2xl font-semibold mt-4 truncate max-w-xs mx-auto">{recentCalls[0].windowLabel}</p>
            </div>
          ) : (
            <div className="opacity-20 text-center">
              <div className="w-24 h-24 rounded-full border-2 border-white/20 flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl">📋</span>
              </div>
              <p className="text-white/50 text-lg">Waiting for calls…</p>
              <p className="text-white/20 text-sm mt-2">Add videos in Settings → Media for a background</p>
            </div>
          )}
        </div>
      )}

      {/* ══ EMERGENCY BROADCAST ══════════════════════════════════════════════ */}
      {broadcast && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-red-950/95">
          <div className="w-20 h-20 rounded-full bg-red-600/30 border-2 border-red-500 flex items-center justify-center mb-8">
            <span className="text-4xl">⚠</span>
          </div>
          <p className="text-red-300 text-lg font-semibold uppercase tracking-widest mb-6">Emergency Announcement</p>
          <p className="text-white text-4xl font-bold text-center max-w-3xl leading-snug px-8">{broadcast}</p>
          <button
            onClick={() => setBroadcast(null)}
            className="mt-12 px-8 py-3 rounded-xl border border-red-500/40 text-red-300 text-sm hover:bg-red-900/40 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
