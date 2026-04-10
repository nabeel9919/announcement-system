import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueueStore } from '../../store/queue'
import { useAppStore } from '../../store/app'
import type { QueueTicket, ServiceWindow, QueueCategory } from '@announcement/shared'
import { buildAnnouncementText, AudioEngine } from '@announcement/audio-engine'
import { cn, generateId, padNumber, minutesSince } from '../../lib/utils'
import chimeUrl from '../../assets/chime.wav'
import {
  Volume2, VolumeX, RotateCcw, SkipForward, Check, Monitor,
  RefreshCw, Bell, ChevronDown, Plus, Mic, CreditCard, Printer, Tablet,
  Settings, BarChart2, Download, ArrowUpCircle, Wifi, Lock, Unlock,
  Shield, X, ChevronRight, Activity, Clock, Users, CheckCircle2,
  AlertCircle, Zap, Hash, Film
} from 'lucide-react'

// ── Admin PIN modal ──────────────────────────────────────────────────────────
function PinModal({ onVerified, onClose }: { onVerified: () => void; onClose: () => void }) {
  const [digits, setDigits] = useState(['', '', '', ''])
  const [error, setError] = useState(false)
  const [shaking, setShaking] = useState(false)
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  async function checkPin(pin: string) {
    const ok = await window.api.config.verifyPin(pin)
    if (ok) {
      onVerified()
    } else {
      setShaking(true)
      setError(true)
      setDigits(['', '', '', ''])
      setTimeout(() => { setShaking(false); setError(false); inputs.current[0]?.focus() }, 700)
    }
  }

  function handleKey(i: number, val: string) {
    if (!/^\d?$/.test(val)) return
    const next = [...digits]
    next[i] = val
    setDigits(next)
    if (val && i < 3) inputs.current[i + 1]?.focus()
    if (val && i === 3) checkPin(next.join(''))
  }

  function handleBackspace(i: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className={cn(
          'bg-zinc-900 border border-zinc-700 rounded-2xl p-8 w-80 text-center shadow-2xl',
          shaking && 'animate-[shake_0.4s_ease-in-out]'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-12 rounded-full bg-primary-600/20 border border-primary-500/40 flex items-center justify-center mx-auto mb-4">
          <Shield className="w-6 h-6 text-primary-400" />
        </div>
        <h2 className="text-lg font-bold text-zinc-100 mb-1">Admin Access</h2>
        <p className="text-sm text-zinc-500 mb-6">Enter your 4-digit PIN to continue</p>

        <div className="flex justify-center gap-3 mb-4">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { inputs.current[i] = el }}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={d}
              autoFocus={i === 0}
              onChange={(e) => handleKey(i, e.target.value)}
              onKeyDown={(e) => handleBackspace(i, e)}
              className={cn(
                'w-12 h-14 text-center text-2xl font-bold rounded-xl border bg-zinc-800 text-zinc-100 outline-none transition-all',
                error ? 'border-red-500 text-red-400' : d ? 'border-primary-500 ring-2 ring-primary-500/30' : 'border-zinc-700 focus:border-primary-500'
              )}
            />
          ))}
        </div>
        {error && <p className="text-xs text-red-400 mb-2">Incorrect PIN</p>}
        <button onClick={onClose} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors mt-2">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, color, icon: Icon }: {
  label: string; value: number; color: string; icon: React.ElementType
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-zinc-800/50 border border-zinc-700/50 px-4 py-3">
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', `bg-${color}-500/15`)}>
        <Icon className={cn('w-4 h-4', `text-${color}-400`)} />
      </div>
      <div>
        <p className="text-xl font-bold tabular-nums text-zinc-100 leading-none">{value}</p>
        <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function OperatorPage() {
  const { config, setPage, updateAvailable, updateDownloaded, operatorWindowId } = useAppStore()
  const {
    tickets, windows, categories,
    setTickets, setWindows, setCategories, setStats, stats,
    addTicket, updateTicket, waitingTickets, calledTickets
  } = useQueueStore()

  const audioRef = useRef<AudioEngine | null>(null)
  const [selectedWindowId, setSelectedWindowId] = useState<string>('')
  const [nameInput, setNameInput] = useState('')
  const [cardInput, setCardInput] = useState('')
  const [isMuted, setIsMuted] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [lanUrl, setLanUrl] = useState<string | null>(null)
  const [screens, setScreens] = useState<{ index: number; label: string; width: number; height: number; hasDisplay: boolean }[]>([])
  const [time, setTime] = useState(new Date())
  const [lastCallFlash, setLastCallFlash] = useState(false)

  // Admin state
  const [isAdmin, setIsAdmin] = useState(false)
  const [showPinModal, setShowPinModal] = useState(false)
  const [pendingAdminAction, setPendingAdminAction] = useState<(() => void) | null>(null)
  const adminTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Active view tab in center panel
  const [centerTab, setCenterTab] = useState<'call' | 'called'>('call')

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Admin auto-lock after 3 minutes of inactivity
  function resetAdminTimer() {
    if (adminTimerRef.current) clearTimeout(adminTimerRef.current)
    if (isAdmin) {
      adminTimerRef.current = setTimeout(() => setIsAdmin(false), 3 * 60 * 1000)
    }
  }
  useEffect(() => { resetAdminTimer() }, [isAdmin])

  function requireAdmin(action: () => void) {
    if (isAdmin) { action(); return }
    setPendingAdminAction(() => action)
    setShowPinModal(true)
  }

  // Init audio engine
  useEffect(() => {
    const langMap: Record<string, string> = { sw: 'sw-TZ', ar: 'ar-SA', fr: 'fr-FR', en: 'en-US' }
    const language = langMap[config?.language ?? 'en'] ?? 'en-US'
    audioRef.current = new AudioEngine({
      provider: (config as any)?.provider ?? 'web_speech',
      language,
      secondLanguage: (config as any)?.secondLanguage,
      voiceName: (config as any)?.voiceName,
      volume: (config as any)?.volume ?? 1,
      rate: (config as any)?.rate ?? 0.9,
      pitch: (config as any)?.pitch ?? 1,
      interAnnouncementDelayMs: 1500,
      autoRecallAfterSeconds: (config as any)?.autoRecallAfterSeconds ?? 90,
      maxAutoRecalls: (config as any)?.maxAutoRecalls ?? 2,
      chimeUrl,
    })
  }, [config])

  // Load data
  useEffect(() => {
    async function load() {
      const [cats, wins, tix, s, scr] = await Promise.all([
        window.api.categories.list(),
        window.api.windows.list(),
        window.api.tickets.list(),
        window.api.stats.today(),
        window.api.screens.list(),
      ])
      setCategories(cats as QueueCategory[])
      setWindows(wins as ServiceWindow[])
      setTickets(tix as QueueTicket[])
      setStats(s as any)
      setScreens(scr as any[])
      // Prefer the window chosen at login; fall back to first active window
      const allWins = wins as ServiceWindow[]
      const preferred = operatorWindowId && allWins.find((w) => w.id === operatorWindowId)
      setSelectedWindowId(preferred ? preferred.id : (allWins[0]?.id ?? ''))
      setIsLoading(false)
    }
    load()
  }, [])

  // LAN URL
  useEffect(() => {
    window.api.lan.getUrl().then(setLanUrl)
    const interval = setInterval(async () => {
      const url = await window.api.lan.getUrl()
      if (url) { setLanUrl(url); clearInterval(interval) }
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  // Screen change notification
  useEffect(() => {
    window.api.onScreensChanged?.(() => {
      window.api.screens.list().then((scr) => setScreens(scr as any[]))
    })
  }, [])

  // Announce helper
  const announce = useCallback((text: string, displayNumber?: string) => {
    if (!isMuted && audioRef.current) {
      try { audioRef.current.announce(text) } catch { /* TTS unavailable */ }
    }
    const win = windows.find((w) => w.id === selectedWindowId)
    window.api.display.send({
      type: 'call',
      text,
      displayNumber: displayNumber ?? '—',
      windowLabel: win?.label ?? 'Counter',
      windowId: selectedWindowId || 'default',
      timestamp: new Date().toISOString(),
    })
    setLastCallFlash(true)
    setTimeout(() => setLastCallFlash(false), 1200)
  }, [isMuted, selectedWindowId, windows])

  // Keep a stable ref to announce so the IPC handler never captures a stale closure.
  // onAnnounce uses ipcRenderer.on which accumulates listeners — we only register once.
  const announceRef = useRef(announce)
  useEffect(() => { announceRef.current = announce })

  // Wire LAN remote announce — registered ONCE, reads from ref
  useEffect(() => {
    window.api.lan.onAnnounce((data) => announceRef.current(data.text, data.displayNumber))
  }, [])

  // Auto-recall
  const autoRecallRef = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; count: number }>>(new Map())
  useEffect(() => {
    const recallSec = (config as any)?.autoRecallAfterSeconds ?? 90
    const maxRecalls = (config as any)?.maxAutoRecalls ?? 2
    if (recallSec === 0) return
    const called = tickets.filter((t) => t.status === 'called')
    const tracked = autoRecallRef.current
    for (const ticket of called) {
      if (!tracked.has(ticket.id)) {
        const entry = { timer: null as any, count: 0 }
        const scheduleRecall = (delayMs: number) => {
          entry.timer = setTimeout(async () => {
            const current = await window.api.tickets.list('called') as QueueTicket[]
            const still = current.find((t) => t.id === ticket.id)
            if (!still) { tracked.delete(ticket.id); return }
            entry.count += 1
            if (entry.count > maxRecalls) {
              await window.api.tickets.skip(ticket.id)
              updateTicket(ticket.id, { status: 'skipped' })
              tracked.delete(ticket.id)
              refreshStats()
            } else {
              await window.api.tickets.recall(ticket.id)
              const win = windows.find((w) => w.currentTicketId === ticket.id || w.id === ticket.windowId)
              const text = buildAnnouncementText({
                displayNumber: ticket.displayNumber,
                windowLabel: win?.label ?? 'Counter',
                language: appLang(),
                mode: ticket.calleeName ? 'name' : 'ticket',
              })
              announce(text, ticket.displayNumber)
              scheduleRecall(recallSec * 1000)
            }
          }, delayMs)
        }
        scheduleRecall(recallSec * 1000)
        tracked.set(ticket.id, entry)
      }
    }
    for (const [id, entry] of tracked) {
      if (!called.find((t) => t.id === id)) {
        clearTimeout(entry.timer)
        tracked.delete(id)
      }
    }
  }, [tickets])

  // Push queue stats to display
  useEffect(() => {
    const catStats = categories.map((cat) => ({
      code: cat.code, label: cat.label, color: cat.color,
      waiting: tickets.filter((t) => t.categoryId === cat.id && t.status === 'waiting').length,
      called: tickets.filter((t) => t.categoryId === cat.id && t.status === 'called').length,
    }))
    window.api.display.send({ type: 'queue_stats', categories: catStats, totalWaiting: catStats.reduce((s, c) => s + c.waiting, 0) })
  }, [tickets, categories])

  // Updater events
  useEffect(() => {
    window.api.updater.onAvailable(() => useAppStore.getState().setUpdateAvailable(true))
    window.api.updater.onDownloaded(() => useAppStore.getState().setUpdateDownloaded(true))
  }, [])

  // ── Helpers ──────────────────────────────────────────────────────────────
  function appLang(): string {
    const map: Record<string, string> = { sw: 'sw-TZ', ar: 'ar-SA', fr: 'fr-FR', en: 'en-US' }
    return map[config?.language ?? 'en'] ?? 'en-US'
  }

  async function refreshScreens() {
    const list = await window.api.screens.list()
    setScreens(list as any[])
  }

  async function toggleDisplay(screenIndex: number, hasDisplay: boolean) {
    if (hasDisplay) {
      await window.api.display.close(screenIndex)
    } else {
      await window.api.display.open(screenIndex)
    }
    setTimeout(refreshScreens, 400)
  }

  async function printTicket(ticket: QueueTicket) {
    const cat = categories.find((c) => c.id === ticket.categoryId)
    await window.api.print.ticket({
      displayNumber: ticket.displayNumber,
      categoryLabel: cat?.label ?? ticket.categoryId,
      organizationName: config?.organizationName ?? 'Announcement System',
      issuedAt: ticket.createdAt,
      windowCount: config?.windowCount ?? 1,
    })
  }

  async function issueTicket(categoryId: string) {
    const seq = await window.api.tickets.nextSequence(categoryId)
    const cat = categories.find((c) => c.id === categoryId)
    if (!cat) return
    const displayNumber = `${cat.prefix}${padNumber(seq)}`
    const ticket: QueueTicket = {
      id: generateId(), displayNumber, sequenceNumber: seq, categoryId,
      status: 'waiting', createdAt: new Date().toISOString(), recallCount: 0,
    }
    await window.api.tickets.create(ticket as any)
    addTicket(ticket)
    printTicket(ticket)
    refreshStats()
  }

  async function callNext() {
    const waiting = waitingTickets()
    if (waiting.length === 0) return
    const next = waiting[0]
    const win = windows.find((w) => w.id === selectedWindowId)
    const windowLabel = win?.label ?? 'Counter'
    await window.api.tickets.call(next.id, selectedWindowId)
    updateTicket(next.id, { status: 'called', windowId: selectedWindowId, calledAt: new Date().toISOString() })
    const text = buildAnnouncementText({ displayNumber: next.displayNumber, windowLabel, calleeName: next.calleeName, language: appLang(), mode: next.calleeName ? 'name' : 'ticket' })
    announce(text, next.displayNumber)
    refreshStats()
    setCenterTab('called')
  }

  async function recallTicket(ticketId: string) {
    const ticket = tickets.find((t) => t.id === ticketId)
    if (!ticket) return
    const windowLabel = windows.find((w) => w.id === selectedWindowId)?.label ?? 'Counter'
    await window.api.tickets.recall(ticketId)
    const text = buildAnnouncementText({ displayNumber: ticket.displayNumber, windowLabel, calleeName: ticket.calleeName, language: appLang(), mode: ticket.calleeName ? 'name' : 'ticket' })
    announce(text, ticket.displayNumber)
  }

  function callByName() {
    if (!nameInput.trim()) return
    const windowLabel = windows.find((w) => w.id === selectedWindowId)?.label ?? 'Counter'
    const text = buildAnnouncementText({ displayNumber: '', windowLabel, calleeName: nameInput.trim(), language: appLang(), mode: 'name' })
    announce(text, nameInput.trim())
    setNameInput('')
  }

  function callByCard() {
    if (!cardInput.trim()) return
    const windowLabel = windows.find((w) => w.id === selectedWindowId)?.label ?? 'Counter'
    const text = buildAnnouncementText({ displayNumber: cardInput.trim(), windowLabel, language: appLang(), mode: 'card' })
    announce(text, cardInput.trim())
    setCardInput('')
  }

  async function markServed(ticketId: string) {
    await window.api.tickets.serve(ticketId)
    updateTicket(ticketId, { status: 'served' })
    refreshStats()
  }

  async function markSkipped(ticketId: string) {
    await window.api.tickets.skip(ticketId)
    updateTicket(ticketId, { status: 'skipped' })
    refreshStats()
  }

  async function refreshStats() {
    const s = await window.api.stats.today()
    setStats(s as any)
  }

  // ── Keyboard shortcuts (global + local) ──────────────────────────────────
  // Refs hold the latest action handlers so the stable IPC listener never
  // captures stale closures — even though it is set up only once.
  const callNextRef = useRef(callNext)
  const recallTicketRef = useRef(recallTicket)
  const calledTicketsRef = useRef(calledTickets)
  useEffect(() => { callNextRef.current = callNext })
  useEffect(() => { recallTicketRef.current = recallTicket })
  useEffect(() => { calledTicketsRef.current = calledTickets })

  useEffect(() => {
    function handleShortcut(action: string) {
      if (action === 'call-next') {
        callNextRef.current()
      } else if (action === 'recall-last') {
        const called = calledTicketsRef.current()
        if (called.length > 0) recallTicketRef.current(called[called.length - 1].id)
      } else if (action === 'toggle-mute') {
        setIsMuted((m) => !m)
      }
    }

    // IPC from main process — fires even when the window is minimized / unfocused
    window.api.onShortcut(handleShortcut)

    // DOM keydown fallback — fires when the window IS focused (prevents browser
    // default handling of F1 help, etc.)
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'F1') { e.preventDefault(); handleShortcut('call-next') }
      if (e.key === 'F2') { e.preventDefault(); handleShortcut('recall-last') }
      if (e.key === 'F9') { e.preventDefault(); handleShortcut('toggle-mute') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // empty — stable listener, reads from refs

  const mode = config?.callingMode ?? 'hybrid'
  const waiting = waitingTickets()
  const called = calledTickets()
  const selectedWin = windows.find((w) => w.id === selectedWindowId)

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 flex-col gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
        <p className="text-sm text-zinc-500">Loading system…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0f] text-zinc-50 overflow-hidden">

      {/* ══ ADMIN PIN MODAL ═══════════════════════════════════════════════════ */}
      {showPinModal && (
        <PinModal
          onVerified={() => {
            setIsAdmin(true)
            setShowPinModal(false)
            if (pendingAdminAction) { pendingAdminAction(); setPendingAdminAction(null) }
          }}
          onClose={() => { setShowPinModal(false); setPendingAdminAction(null) }}
        />
      )}

      {/* ══ TOP NAVBAR ═══════════════════════════════════════════════════════ */}
      <header className="flex items-center h-12 min-h-[48px] px-4 border-b border-zinc-800/80 bg-zinc-900/60 backdrop-blur-sm gap-3">

        {/* Brand */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg bg-primary-600 flex items-center justify-center">
            <Activity className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-zinc-200 hidden sm:block">
            {config?.organizationName ?? 'Announcement System'}
          </span>
        </div>

        <div className="w-px h-5 bg-zinc-700/60 mx-1" />

        {/* Window selector */}
        <div className="relative flex-shrink-0">
          <select
            value={selectedWindowId}
            onChange={(e) => setSelectedWindowId(e.target.value)}
            className="appearance-none rounded-lg border border-zinc-700 bg-zinc-800/80 pl-3 pr-7 py-1.5 text-xs font-medium text-zinc-200 focus:outline-none focus:ring-1 focus:ring-primary-500 cursor-pointer"
          >
            {windows.map((w) => (
              <option key={w.id} value={w.id}>{w.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* LAN URL — compact */}
        {lanUrl && (
          <button
            onClick={() => window.api.openExternal(lanUrl)}
            className="flex items-center gap-1.5 rounded-lg border border-blue-700/40 bg-blue-900/20 px-2.5 py-1.5 text-xs text-blue-300 hover:bg-blue-900/40 transition-colors"
            title="Open LAN panel in browser"
          >
            <Wifi className="w-3 h-3" />
            <span className="font-mono">{lanUrl.replace('http://', '')}</span>
          </button>
        )}

        {/* Update badges */}
        {updateDownloaded && (
          <button onClick={() => window.api.updater.install()} className="flex items-center gap-1.5 rounded-lg bg-emerald-600/20 border border-emerald-600/30 px-2.5 py-1.5 text-xs text-emerald-300 hover:bg-emerald-600/30 transition-colors">
            <ArrowUpCircle className="w-3 h-3" />Restart to update
          </button>
        )}
        {updateAvailable && !updateDownloaded && (
          <button onClick={() => window.api.updater.download()} className="flex items-center gap-1.5 rounded-lg bg-primary-600/20 border border-primary-600/30 px-2.5 py-1.5 text-xs text-primary-300 hover:bg-primary-600/30 transition-colors">
            <Download className="w-3 h-3" />Update available
          </button>
        )}

        {/* Clock */}
        <div className="flex items-center gap-1.5 text-zinc-400 flex-shrink-0">
          <Clock className="w-3 h-3" />
          <span className="text-xs tabular-nums font-medium">
            {time.toLocaleTimeString('en-TZ', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        <div className="w-px h-5 bg-zinc-700/60 mx-1" />

        {/* Mute toggle */}
        <button
          onClick={() => setIsMuted(!isMuted)}
          title="Toggle audio (F9)"
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all border',
            isMuted
              ? 'bg-red-500/15 text-red-400 border-red-500/30'
              : 'border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:bg-zinc-800'
          )}
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{isMuted ? 'Muted' : 'Audio'}</span>
        </button>

        {/* Admin toggle */}
        <button
          onClick={() => isAdmin ? setIsAdmin(false) : requireAdmin(() => {})}
          title={isAdmin ? 'Admin mode active — click to lock' : 'Enter admin mode'}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all border',
            isAdmin
              ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
              : 'border-zinc-700 bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
          )}
        >
          {isAdmin ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{isAdmin ? 'Admin' : 'Locked'}</span>
        </button>
      </header>

      {/* ══ BODY ══════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
        <aside className="w-56 min-w-[200px] border-r border-zinc-800/80 bg-zinc-900/30 flex flex-col">

          {/* Stats */}
          <div className="p-3 space-y-2 border-b border-zinc-800/80">
            <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest px-1 mb-2">Today</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Waiting', value: stats.waiting, color: 'amber', Icon: Clock },
                { label: 'Called', value: stats.called, color: 'blue', Icon: Bell },
                { label: 'Served', value: stats.served, color: 'emerald', Icon: CheckCircle2 },
                { label: 'Skipped', value: stats.skipped, color: 'zinc', Icon: SkipForward },
              ].map(({ label, value, color, Icon }) => (
                <div key={label} className={cn(
                  'rounded-xl border p-2.5 flex flex-col gap-1',
                  color === 'amber' ? 'border-amber-500/20 bg-amber-500/5' :
                  color === 'blue' ? 'border-blue-500/20 bg-blue-500/5' :
                  color === 'emerald' ? 'border-emerald-500/20 bg-emerald-500/5' :
                  'border-zinc-700/50 bg-zinc-800/30'
                )}>
                  <p className={cn('text-xl font-bold tabular-nums leading-none',
                    color === 'amber' ? 'text-amber-400' :
                    color === 'blue' ? 'text-blue-400' :
                    color === 'emerald' ? 'text-emerald-400' : 'text-zinc-400'
                  )}>{value}</p>
                  <p className="text-[10px] text-zinc-600">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Categories */}
          <div className="p-3 border-b border-zinc-800/80 flex-shrink-0">
            <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-2">Queue</p>
            <div className="space-y-1">
              {categories.map((cat) => {
                const count = waiting.filter((t) => t.categoryId === cat.id).length
                return (
                  <div key={cat.id} className="flex items-center justify-between rounded-lg px-2.5 py-1.5 bg-zinc-800/30 hover:bg-zinc-800/50 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                      <span className="text-xs text-zinc-400 truncate">{cat.label}</span>
                    </div>
                    <span className={cn('text-xs font-bold tabular-nums', count > 0 ? 'text-amber-400' : 'text-zinc-600')}>{count}</span>
                  </div>
                )
              })}
              {categories.length === 0 && <p className="text-xs text-zinc-700 py-2 text-center">No categories</p>}
            </div>
          </div>

          {/* Displays */}
          <div className="p-3 border-b border-zinc-800/80 flex-shrink-0">
            <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-2">Displays</p>
            <div className="space-y-1">
              {screens.map((s) => (
                <button
                  key={s.index}
                  onClick={() => toggleDisplay(s.index, s.hasDisplay)}
                  className={cn(
                    'w-full flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all',
                    s.hasDisplay
                      ? 'border-primary-500/40 bg-primary-600/10 text-primary-300'
                      : 'border-zinc-700/60 bg-zinc-800/30 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Monitor className="w-3 h-3" />
                    <span>{s.label}</span>
                  </div>
                  <div className={cn('w-1.5 h-1.5 rounded-full', s.hasDisplay ? 'bg-primary-400' : 'bg-zinc-700')} />
                </button>
              ))}
              {screens.length === 0 && (
                <p className="text-xs text-zinc-700 text-center py-1">No screens</p>
              )}
            </div>
          </div>

          {/* Navigation */}
          <div className="p-3 space-y-1 mt-auto">
            <button
              onClick={() => window.api.kiosk.open(0)}
              className="w-full flex items-center gap-2.5 rounded-lg border border-zinc-700/60 bg-zinc-800/30 hover:bg-zinc-800/60 px-3 py-2 text-xs text-zinc-300 transition-colors"
            >
              <Tablet className="w-3.5 h-3.5 text-zinc-500" />Kiosk
            </button>
            <button
              onClick={() => setPage('analytics')}
              className="w-full flex items-center gap-2.5 rounded-lg border border-zinc-700/60 bg-zinc-800/30 hover:bg-zinc-800/60 px-3 py-2 text-xs text-zinc-300 transition-colors"
            >
              <BarChart2 className="w-3.5 h-3.5 text-zinc-500" />Analytics
            </button>
            <button
              onClick={() => setPage('summary')}
              className="w-full flex items-center gap-2.5 rounded-lg border border-zinc-700/60 bg-zinc-800/30 hover:bg-zinc-800/60 px-3 py-2 text-xs text-zinc-300 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5 text-zinc-500" />End of Day
            </button>
            <button
              onClick={() => requireAdmin(() => setPage('settings'))}
              className={cn(
                'w-full flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs transition-colors relative',
                isAdmin
                  ? 'border-amber-500/30 bg-amber-500/5 text-amber-300 hover:bg-amber-500/10'
                  : 'border-zinc-700/60 bg-zinc-800/30 hover:bg-zinc-800/60 text-zinc-300'
              )}
            >
              <Settings className="w-3.5 h-3.5 text-zinc-500" />Settings
              {!isAdmin && <Lock className="w-2.5 h-2.5 text-zinc-600 ml-auto" />}
            </button>
            <button
              onClick={() => requireAdmin(() => setPage('settings'))}
              className={cn(
                'w-full flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs transition-colors',
                isAdmin
                  ? 'border-amber-500/30 bg-amber-500/5 text-amber-300 hover:bg-amber-500/10'
                  : 'border-zinc-700/60 bg-zinc-800/30 hover:bg-zinc-800/60 text-zinc-300'
              )}
            >
              <Film className="w-3.5 h-3.5 text-zinc-500" />Media
              {!isAdmin && <Lock className="w-2.5 h-2.5 text-zinc-600 ml-auto" />}
            </button>
          </div>
        </aside>

        {/* ── CENTER PANEL ─────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#0a0a0f]">

          {/* Tab switcher */}
          <div className="flex items-center gap-1 px-5 pt-4 pb-0 flex-shrink-0">
            <button
              onClick={() => setCenterTab('call')}
              className={cn(
                'flex items-center gap-2 rounded-t-lg px-4 py-2 text-sm font-medium border-b-2 transition-all',
                centerTab === 'call'
                  ? 'text-zinc-100 border-primary-500'
                  : 'text-zinc-500 border-transparent hover:text-zinc-300'
              )}
            >
              <Zap className="w-3.5 h-3.5" />
              Issue & Call
            </button>
            <button
              onClick={() => setCenterTab('called')}
              className={cn(
                'flex items-center gap-2 rounded-t-lg px-4 py-2 text-sm font-medium border-b-2 transition-all relative',
                centerTab === 'called'
                  ? 'text-zinc-100 border-primary-500'
                  : 'text-zinc-500 border-transparent hover:text-zinc-300'
              )}
            >
              <Users className="w-3.5 h-3.5" />
              Active Calls
              {called.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary-600 text-white text-[9px] font-bold flex items-center justify-center">
                  {called.length}
                </span>
              )}
            </button>
          </div>
          <div className="h-px bg-zinc-800/80 mx-5" />

          <div className="flex-1 overflow-y-auto p-5 space-y-4">

            {centerTab === 'call' && (
              <>
                {/* ── Main call area ────────────────────────────────── */}
                <div className={cn(
                  'rounded-2xl border p-5 transition-all duration-300',
                  lastCallFlash
                    ? 'border-primary-500/70 bg-primary-600/10 shadow-lg shadow-primary-500/10'
                    : 'border-zinc-800/80 bg-zinc-900/40'
                )}>
                  {/* Next ticket hero */}
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-2">Next in Queue</p>
                      <div className="flex items-baseline gap-3">
                        <p className="text-5xl font-extrabold tabular-nums text-zinc-100 leading-none tracking-tight">
                          {waiting.length > 0 ? waiting[0].displayNumber : '—'}
                        </p>
                        {waiting.length > 0 && (
                          <div>
                            <p className="text-xs text-zinc-500">{categories.find(c => c.id === waiting[0].categoryId)?.label}</p>
                            <p className="text-xs text-zinc-700 mt-0.5">{minutesSince(waiting[0].createdAt)}m waiting</p>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-zinc-600 mt-2">
                        {waiting.length === 0 ? 'Queue is empty' : `${waiting.length} ticket${waiting.length !== 1 ? 's' : ''} waiting`}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <button
                        onClick={callNext}
                        disabled={waiting.length === 0}
                        className="flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-500 active:bg-primary-700 disabled:opacity-30 disabled:cursor-not-allowed px-5 py-3 text-sm font-bold text-white transition-all shadow-lg shadow-primary-600/20"
                      >
                        <Bell className="w-4 h-4" />
                        Call Next
                        <kbd className="ml-1 text-[9px] font-mono opacity-60 bg-white/10 px-1 py-0.5 rounded">F1</kbd>
                      </button>
                      {called.length > 0 && (
                        <button
                          onClick={() => recallTicket(called[called.length - 1].id)}
                          className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 px-4 py-2.5 text-xs font-medium text-zinc-300 transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Recall Last
                          <kbd className="text-[9px] font-mono opacity-60 bg-white/10 px-1 py-0.5 rounded">F2</kbd>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Issue ticket buttons */}
                  {(mode === 'ticket' || mode === 'hybrid') && (
                    <div>
                      <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-2">Issue Ticket</p>
                      <div className="flex flex-wrap gap-2">
                        {categories.map((cat) => {
                          const count = waiting.filter((t) => t.categoryId === cat.id).length
                          return (
                            <button
                              key={cat.id}
                              onClick={() => issueTicket(cat.id)}
                              className="group flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                              style={{
                                color: cat.color,
                                borderColor: `${cat.color}30`,
                                background: `${cat.color}08`,
                              }}
                            >
                              <Plus className="w-3 h-3 group-hover:rotate-90 transition-transform" />
                              <span>{cat.code}</span>
                              {count > 0 && (
                                <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                                  style={{ background: `${cat.color}20` }}>
                                  {count}
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Card call ─────────────────────────────────────── */}
                {(mode === 'card' || mode === 'hybrid') && (
                  <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <CreditCard className="w-3.5 h-3.5 text-zinc-500" />
                      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Card Call</p>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={cardInput}
                        onChange={(e) => setCardInput(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === 'Enter' && callByCard()}
                        placeholder="e.g. OPD K 11 or PHR B 04"
                        className="flex-1 rounded-xl border border-zinc-700/70 bg-zinc-800/60 px-3.5 py-2.5 text-sm font-mono text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 transition-all tracking-wide"
                      />
                      <button
                        onClick={callByCard}
                        disabled={!cardInput.trim()}
                        className="flex items-center gap-2 rounded-xl bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors"
                      >
                        <Volume2 className="w-4 h-4" />
                        Announce
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Name call ─────────────────────────────────────── */}
                {(mode === 'name' || mode === 'hybrid') && (
                  <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Mic className="w-3.5 h-3.5 text-zinc-500" />
                      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Call by Name</p>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && callByName()}
                        placeholder="Type patient or passenger name…"
                        className="flex-1 rounded-xl border border-zinc-700/70 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all"
                      />
                      <button
                        onClick={callByName}
                        disabled={!nameInput.trim()}
                        className="flex items-center gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors"
                      >
                        <Mic className="w-4 h-4" />
                        Call
                      </button>
                    </div>
                  </div>
                )}

                {/* Hotkeys hint */}
                <div className="flex items-center gap-4 px-1">
                  {[
                    { key: 'F1', label: 'Call Next' },
                    { key: 'F2', label: 'Recall' },
                    { key: 'F9', label: 'Mute toggle' },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <kbd className="text-[9px] font-mono text-zinc-600 bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded">{key}</kbd>
                      <span className="text-[10px] text-zinc-700">{label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {centerTab === 'called' && (
              <>
                {called.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-12 h-12 rounded-full border border-zinc-800 flex items-center justify-center mb-3">
                      <Bell className="w-5 h-5 text-zinc-700" />
                    </div>
                    <p className="text-sm text-zinc-600">No active calls</p>
                    <p className="text-xs text-zinc-700 mt-1">Press <kbd className="text-[9px] font-mono bg-zinc-800 border border-zinc-700 px-1 py-0.5 rounded">F1</kbd> to call next ticket</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {called.slice().reverse().map((t) => {
                      const win = windows.find((w) => w.id === t.windowId)
                      const cat = categories.find((c) => c.id === t.categoryId)
                      const age = t.calledAt ? minutesSince(t.calledAt) : 0
                      return (
                        <div key={t.id} className="flex items-center gap-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3 hover:border-zinc-700/80 transition-all group">
                          {/* Number */}
                          <div className="flex flex-col items-center w-14 flex-shrink-0">
                            <span className="text-2xl font-extrabold tabular-nums text-zinc-100 leading-none">{t.displayNumber}</span>
                            {age > 0 && (
                              <span className={cn('text-[10px] mt-0.5 tabular-nums', age > 5 ? 'text-amber-500' : 'text-zinc-600')}>
                                {age}m
                              </span>
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            {cat && (
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                                <span className="text-xs text-zinc-500 truncate">{cat.label}</span>
                              </div>
                            )}
                            <p className="text-xs text-zinc-600">→ {win?.label ?? '—'}</p>
                            {t.calleeName && <p className="text-xs text-zinc-500 mt-0.5 truncate">{t.calleeName}</p>}
                          </div>

                          {/* Actions */}
                          <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => recallTicket(t.id)}
                              title="Recall"
                              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-amber-400 hover:bg-amber-400/10 border border-amber-500/20 hover:border-amber-500/40 transition-all"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => markServed(t.id)}
                              title="Mark served"
                              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-emerald-400 hover:bg-emerald-400/10 border border-emerald-500/20 hover:border-emerald-500/40 transition-all"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => markSkipped(t.id)}
                              title="Skip"
                              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-700/50 border border-zinc-700/50 hover:border-zinc-600 transition-all"
                            >
                              <SkipForward className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}

          </div>
        </main>

        {/* ── RIGHT PANEL: Waiting Queue ─────────────────────────────────── */}
        <aside className="w-60 min-w-[220px] border-l border-zinc-800/80 bg-zinc-900/30 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80 flex-shrink-0">
            <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">Waiting</p>
            <span className={cn('text-sm font-bold tabular-nums', waiting.length > 0 ? 'text-amber-400' : 'text-zinc-700')}>
              {waiting.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {waiting.map((t, idx) => {
              const cat = categories.find((c) => c.id === t.categoryId)
              return (
                <div
                  key={t.id}
                  className={cn(
                    'rounded-xl border px-3 py-2.5 transition-all',
                    idx === 0
                      ? 'border-primary-500/40 bg-primary-600/8 shadow-sm shadow-primary-500/5'
                      : 'border-zinc-800/60 bg-zinc-800/20 hover:bg-zinc-800/40'
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={cn('font-bold tabular-nums text-base', idx === 0 ? 'text-white' : 'text-zinc-200')}>
                      {t.displayNumber}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-zinc-700 tabular-nums">{minutesSince(t.createdAt)}m</span>
                      <button
                        onClick={() => printTicket(t)}
                        title="Reprint ticket"
                        className="p-1 rounded hover:bg-zinc-700 text-zinc-700 hover:text-zinc-400 transition-colors"
                      >
                        <Printer className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>
                  {cat && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-1 h-1 rounded-full" style={{ backgroundColor: cat.color }} />
                      <span className="text-[10px] text-zinc-600 truncate">{cat.label}</span>
                    </div>
                  )}
                  {idx === 0 && (
                    <p className="text-[9px] text-primary-500/70 font-medium mt-1 uppercase tracking-wide">Next</p>
                  )}
                </div>
              )
            })}
            {waiting.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center opacity-40">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mb-2" />
                <p className="text-xs text-zinc-600">Queue empty</p>
              </div>
            )}
          </div>
        </aside>

      </div>
    </div>
  )
}
