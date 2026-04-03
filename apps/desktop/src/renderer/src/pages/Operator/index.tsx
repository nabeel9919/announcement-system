import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueueStore } from '../../store/queue'
import { useAppStore } from '../../store/app'
import type { QueueTicket, ServiceWindow, QueueCategory } from '@announcement/shared'
import { buildAnnouncementText, AudioEngine } from '@announcement/audio-engine'
import { cn, generateId, padNumber, minutesSince, formatTime } from '../../lib/utils'
import {
  Volume2, VolumeX, RotateCcw, SkipForward, Check, Monitor,
  RefreshCw, Bell, ChevronDown, Plus, Mic, CreditCard, Printer, Tablet, Settings
} from 'lucide-react'

export default function OperatorPage() {
  const { config, setPage } = useAppStore()
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

  // Init audio engine
  useEffect(() => {
    audioRef.current = new AudioEngine({
      provider: 'web_speech',
      language: config?.language === 'sw' ? 'sw-TZ' : config?.language === 'ar' ? 'ar-SA' : 'en-US',
      volume: 1,
      rate: 0.9,
      pitch: 1,
      interAnnouncementDelayMs: 1500,
      autoRecallAfterSeconds: 90,
      maxAutoRecalls: 2,
    })
  }, [])

  // Load data from DB
  useEffect(() => {
    async function load() {
      const [cats, wins, tix, s] = await Promise.all([
        window.api.categories.list(),
        window.api.windows.list(),
        window.api.tickets.list(),
        window.api.stats.today(),
      ])
      setCategories(cats as QueueCategory[])
      setWindows(wins as ServiceWindow[])
      setTickets(tix as QueueTicket[])
      setStats(s as any)
      if (wins.length > 0) setSelectedWindowId((wins[0] as ServiceWindow).id)
      setIsLoading(false)
    }
    load()
  }, [])

  const announce = useCallback((text: string, displayNumber?: string) => {
    if (!isMuted && audioRef.current) {
      audioRef.current.announce(text)
    }
    // Push to display window
    const win = windows.find((w) => w.id === selectedWindowId)
    window.api.display.send({
      type: 'call',
      text,
      displayNumber: displayNumber ?? '—',
      windowLabel: win?.label ?? '',
      windowId: selectedWindowId,
      timestamp: new Date().toISOString(),
    })
  }, [isMuted, selectedWindowId, windows])

  // ─── Print ticket slip ───────────────────────────────────────────────────
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

  // ─── Issue ticket (ticket mode) ──────────────────────────────────────────
  async function issueTicket(categoryId: string) {
    const seq = await window.api.tickets.nextSequence(categoryId)
    const cat = categories.find((c) => c.id === categoryId)
    if (!cat) return

    const displayNumber = `${cat.prefix}${padNumber(seq)}`
    const ticket: QueueTicket = {
      id: generateId(),
      displayNumber,
      sequenceNumber: seq,
      categoryId,
      status: 'waiting',
      createdAt: new Date().toISOString(),
      recallCount: 0,
    }

    await window.api.tickets.create({
      id: ticket.id,
      displayNumber: ticket.displayNumber,
      sequenceNumber: ticket.sequenceNumber,
      categoryId: ticket.categoryId,
      createdAt: ticket.createdAt,
    })

    addTicket(ticket)
    refreshStats()
    // Auto-print ticket slip if a printer is available
    printTicket(ticket).catch(() => {/* no printer — silently skip */})
  }

  // ─── Call next ticket ────────────────────────────────────────────────────
  async function callNext() {
    const waiting = waitingTickets()
    if (waiting.length === 0) return
    const next = waiting[0]
    const win = windows.find((w) => w.id === selectedWindowId)
    if (!win) return

    await window.api.tickets.call(next.id, selectedWindowId)
    updateTicket(next.id, { status: 'called', windowId: selectedWindowId, calledAt: new Date().toISOString() })

    const text = buildAnnouncementText({
      displayNumber: next.displayNumber,
      windowLabel: win.label,
      announcementPrefix: 'Attention please,',
      calleeName: next.calleeName,
    })
    announce(text, next.displayNumber)
    refreshStats()
  }

  // ─── Recall last called ──────────────────────────────────────────────────
  async function recallTicket(ticketId: string) {
    const ticket = tickets.find((t) => t.id === ticketId)
    const win = windows.find((w) => w.id === selectedWindowId)
    if (!ticket || !win) return

    await window.api.tickets.recall(ticketId)
    const text = buildAnnouncementText({
      displayNumber: ticket.displayNumber,
      windowLabel: win.label,
      announcementPrefix: 'Recall —',
    })
    announce(text, ticket.displayNumber)
  }

  // ─── Call by name ────────────────────────────────────────────────────────
  function callByName() {
    if (!nameInput.trim()) return
    const win = windows.find((w) => w.id === selectedWindowId)
    if (!win) return
    const text = buildAnnouncementText({ displayNumber: '', windowLabel: win.label, calleeName: nameInput.trim() })
    announce(text, nameInput.trim())
    setNameInput('')
  }

  // ─── Call by card ────────────────────────────────────────────────────────
  function callByCard() {
    if (!cardInput.trim()) return
    const win = windows.find((w) => w.id === selectedWindowId)
    if (!win) return
    const text = buildAnnouncementText({ displayNumber: cardInput.trim(), windowLabel: win.label })
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

  async function openDisplay() {
    await window.api.display.open(config?.displayScreenIndex ?? 1)
  }

  async function openKiosk() {
    await window.api.kiosk.open(0)
  }

  const mode = config?.callingMode ?? 'hybrid'
  const waiting = waitingTickets()
  const called = calledTickets()
  const selectedWindow = windows.find((w) => w.id === selectedWindowId)

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <RefreshCw className="w-6 h-6 text-zinc-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-50 overflow-hidden">

      {/* ── Left: Queue status ──────────────────────────────────────────── */}
      <aside className="w-72 border-r border-zinc-800 bg-zinc-900/50 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-zinc-800">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-0.5">
            {config?.organizationName ?? 'Announcement System'}
          </p>
          <p className="text-xs text-zinc-600">
            {new Date().toLocaleDateString('en-TZ', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 p-4 border-b border-zinc-800">
          {[
            { label: 'Waiting', value: stats.waiting, color: 'text-amber-400' },
            { label: 'Called', value: stats.called, color: 'text-blue-400' },
            { label: 'Served', value: stats.served, color: 'text-emerald-400' },
            { label: 'Skipped', value: stats.skipped, color: 'text-zinc-500' },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-zinc-800/60 p-3">
              <p className={cn('text-2xl font-display font-bold', s.color)}>{s.value}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Category breakdown */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">By Category</p>
          {categories.map((cat) => {
            const count = waiting.filter((t) => t.categoryId === cat.id).length
            return (
              <div key={cat.id} className="flex items-center justify-between rounded-lg px-3 py-2.5 bg-zinc-800/40">
                <div className="flex items-center gap-2.5">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                  <span className="text-sm text-zinc-300">{cat.label}</span>
                </div>
                <span className="text-sm font-semibold text-zinc-100">{count}</span>
              </div>
            )
          })}
        </div>

        {/* Bottom actions */}
        <div className="p-4 border-t border-zinc-800 flex gap-2">
          <button
            onClick={openDisplay}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <Monitor className="w-3.5 h-3.5" /> Display
          </button>
          <button
            onClick={openKiosk}
            title="Open self-service kiosk"
            className="flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <Tablet className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setPage('summary')}
            title="End of day summary"
            className="flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setPage('settings')}
            title="Settings"
            className="flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>

      {/* ── Center: Call Panel ──────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Topbar */}
        <header className="flex items-center justify-between px-6 py-3.5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-zinc-100">Operator Panel</p>
            <span className="text-xs text-zinc-600">·</span>
            {/* Window selector */}
            <div className="relative">
              <select
                value={selectedWindowId}
                onChange={(e) => setSelectedWindowId(e.target.value)}
                className="appearance-none rounded-lg border border-zinc-700 bg-zinc-800/80 pl-3 pr-8 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-primary-500 cursor-pointer"
              >
                {windows.map((w) => (
                  <option key={w.id} value={w.id}>{w.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                isMuted
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'border border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:bg-zinc-800'
              )}
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              {isMuted ? 'Muted' : 'Audio On'}
            </button>
          </div>
        </header>

        {/* Call area */}
        <div className="flex-1 overflow-hidden flex flex-col p-6 gap-5">

          {/* Primary call button */}
          {(mode === 'ticket' || mode === 'hybrid') && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Ticket Mode</p>
                  <p className="text-3xl font-display font-extrabold text-zinc-100">
                    {waiting.length > 0 ? waiting[0].displayNumber : '—'}
                  </p>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    {waiting.length > 0 ? `${waiting.length} waiting` : 'Queue empty'}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={callNext}
                    disabled={waiting.length === 0}
                    className="flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-30 disabled:cursor-not-allowed px-5 py-3 text-sm font-semibold text-white transition-colors"
                  >
                    <Bell className="w-4 h-4" />
                    Call Next
                  </button>

                  {called.length > 0 && (
                    <button
                      onClick={() => recallTicket(called[called.length - 1].id)}
                      className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 px-4 py-3 text-sm font-medium text-zinc-300 transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Recall
                    </button>
                  )}
                </div>
              </div>

              {/* Issue tickets per category */}
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => issueTicket(cat.id)}
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{ color: cat.color, borderColor: `${cat.color}33` }}
                  >
                    <Plus className="w-3 h-3" />
                    {cat.code} Ticket
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Card mode */}
          {(mode === 'card' || mode === 'hybrid') && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
                <CreditCard className="inline w-3.5 h-3.5 mr-1.5" />
                Card Calling — enter card text
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={cardInput}
                  onChange={(e) => setCardInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && callByCard()}
                  placeholder="e.g. OPD K 11 or PHR B 04"
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-sm font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent tracking-wide"
                />
                <button
                  onClick={callByCard}
                  disabled={!cardInput.trim()}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-30 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors"
                >
                  <Volume2 className="w-4 h-4" />
                  Announce
                </button>
              </div>
            </div>
          )}

          {/* Name call mode */}
          {(mode === 'name' || mode === 'hybrid') && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
                <Mic className="inline w-3.5 h-3.5 mr-1.5" />
                Live Name Call
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && callByName()}
                  placeholder="Type patient or passenger name..."
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                <button
                  onClick={callByName}
                  disabled={!nameInput.trim()}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors"
                >
                  <Mic className="w-4 h-4" />
                  Call
                </button>
              </div>
            </div>
          )}

          {/* Recent calls */}
          <div className="flex-1 overflow-y-auto">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Recent Calls</p>
            <div className="space-y-2">
              {called
                .slice()
                .reverse()
                .slice(0, 10)
                .map((t) => {
                  const win = windows.find((w) => w.id === t.windowId)
                  return (
                    <div
                      key={t.id}
                      className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-display font-bold text-lg text-zinc-100">{t.displayNumber}</span>
                        <span className="text-xs text-zinc-500">→ {win?.label ?? '—'}</span>
                        <span className="text-xs text-zinc-600">{t.calledAt ? minutesSince(t.calledAt) + 'm ago' : ''}</span>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => recallTicket(t.id)} title="Recall" className="rounded-lg p-1.5 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => markServed(t.id)} title="Mark served" className="rounded-lg p-1.5 hover:bg-emerald-900/50 text-zinc-500 hover:text-emerald-400 transition-colors">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => markSkipped(t.id)} title="Skip" className="rounded-lg p-1.5 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
                          <SkipForward className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              {called.length === 0 && (
                <p className="text-sm text-zinc-600 text-center py-8">No calls yet today</p>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* ── Right: Waiting queue ────────────────────────────────────────── */}
      <aside className="w-64 border-l border-zinc-800 bg-zinc-900/50 flex flex-col">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Waiting Queue</p>
          <span className="text-xs font-semibold text-amber-400">{waiting.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {waiting.map((t, idx) => {
            const cat = categories.find((c) => c.id === t.categoryId)
            return (
              <div
                key={t.id}
                className={cn(
                  'rounded-lg border px-3 py-2.5 transition-colors',
                  idx === 0 ? 'border-primary-500/40 bg-primary-600/10' : 'border-zinc-800 bg-zinc-900/40'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-display font-bold text-base text-zinc-100">{t.displayNumber}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-zinc-600">{minutesSince(t.createdAt)}m</span>
                    <button onClick={() => printTicket(t)} title="Reprint ticket"
                      className="p-1 rounded hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition-colors">
                      <Printer className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {cat && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cat.color }} />
                    <span className="text-xs text-zinc-500">{cat.label}</span>
                  </div>
                )}
              </div>
            )
          })}
          {waiting.length === 0 && (
            <p className="text-sm text-zinc-600 text-center py-8">Queue is empty</p>
          )}
        </div>
      </aside>
    </div>
  )
}
