import { useEffect, useState, useRef, useCallback } from 'react'
import { useAppStore } from '../../store/app'
import { cn, generateId, padNumber, formatTime } from '../../lib/utils'
import type { QueueCategory, KioskQuestion, KioskAnswer, FeedbackQuestion, FeedbackAnswerItem, HelpItem } from '@announcement/shared'
import { ChevronLeft, ChevronRight, Ticket, Star, MessageSquare, HelpCircle, X } from 'lucide-react'

type KioskMode = 'home' | 'ticket' | 'feedback' | 'help'
type TicketStep = 'select' | 'questions' | 'issuing' | 'done'
type FeedbackStep = 'questions' | 'thankyou'

const RESET_SECONDS = 12

interface IdleStep { icon: string; title: string; subtitle: string }
interface IdleConfig {
  enabled: boolean
  timeoutSeconds: number
  welcomeMessage: string
  tagline: string
  steps: IdleStep[]
}

const EMOJI_OPTIONS = [
  { score: 1, emoji: '😞', label: 'Very Bad' },
  { score: 2, emoji: '😕', label: 'Bad' },
  { score: 3, emoji: '😐', label: 'Okay' },
  { score: 4, emoji: '😊', label: 'Good' },
  { score: 5, emoji: '😄', label: 'Excellent' },
]

// ── Idle attract screen ───────────────────────────────────────────────────────
function IdleScreen({ config, orgName, onDismiss }: { config: IdleConfig; orgName: string; onDismiss: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center cursor-pointer select-none"
      style={{
        background: 'linear-gradient(135deg, #0a0a0f 0%, #0f1a2e 50%, #0a0a0f 100%)',
      }}
      onClick={onDismiss}
      onTouchStart={onDismiss}
    >
      {/* Animated background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-10 animate-pulse"
          style={{ background: 'radial-gradient(circle, #4F46E5, transparent)', animationDuration: '3s' }} />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full opacity-10 animate-pulse"
          style={{ background: 'radial-gradient(circle, #7c3aed, transparent)', animationDuration: '4s', animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center px-8 max-w-2xl w-full">

        {/* Org name */}
        <p className="text-zinc-400 text-sm font-medium tracking-widest uppercase mb-3 animate-[fadeInDown_0.6s_ease_both]">
          {orgName}
        </p>

        {/* Welcome */}
        <h1
          className="font-black text-white mb-2 animate-[fadeInDown_0.6s_0.1s_ease_both]"
          style={{ fontSize: 'clamp(3rem, 8vw, 6rem)', lineHeight: 1 }}
        >
          {config.welcomeMessage}
        </h1>
        <p className="text-zinc-400 text-xl mb-12 animate-[fadeInDown_0.6s_0.2s_ease_both]">
          {config.tagline}
        </p>

        {/* Steps */}
        <div className="w-full space-y-3 mb-12">
          {config.steps.map((step, i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-2xl border border-zinc-800/80 bg-zinc-900/60 backdrop-blur-sm px-6 py-4 text-left"
              style={{
                animation: `fadeInUp 0.5s ${0.3 + i * 0.15}s ease both`,
              }}
            >
              <span className="text-3xl flex-shrink-0">{step.icon}</span>
              <div className="min-w-0">
                <p className="text-base font-bold text-zinc-100">{step.title}</p>
                <p className="text-sm text-zinc-500">{step.subtitle}</p>
              </div>
              <div className="ml-auto w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-zinc-500">{i + 1}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Touch to begin — pulsing */}
        <div
          className="flex flex-col items-center gap-3 animate-[fadeIn_0.6s_0.9s_ease_both]"
        >
          <div className="relative">
            {/* Rings */}
            <div className="absolute inset-0 rounded-full border-2 border-indigo-500/30 animate-ping" />
            <div className="absolute inset-0 rounded-full border border-indigo-500/20 scale-125 animate-ping" style={{ animationDelay: '0.3s' }} />
            <div className="w-16 h-16 rounded-full bg-indigo-600/20 border-2 border-indigo-500/60 flex items-center justify-center">
              <span className="text-2xl">👆</span>
            </div>
          </div>
          <p className="text-zinc-300 text-lg font-semibold mt-2">Gusa skrini kuanza</p>
          <p className="text-zinc-500 text-sm">Touch screen to begin</p>
        </div>
      </div>

      {/* Inline keyframe definitions */}
      <style>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function KioskPage() {
  const { config } = useAppStore()
  const orgName = config?.organizationName ?? 'Announcement System'
  const lang = config?.language ?? 'en'
  const sw = lang === 'sw'

  // ── Idle screen ──────────────────────────────────────────────────────────
  const [idleConfig, setIdleConfig] = useState<IdleConfig>({
    enabled: true, timeoutSeconds: 45,
    welcomeMessage: 'Karibu!',
    tagline: 'Ujihudumie Mwenyewe • Self Service',
    steps: [
      { icon: '📋', title: 'Chagua Huduma', subtitle: 'Select your service' },
      { icon: '🎫', title: 'Pokea Tiketi', subtitle: 'Get your ticket' },
      { icon: '⏳', title: 'Subiri Kuitwa', subtitle: 'Wait to be called' },
    ],
  })
  const [isIdle, setIsIdle] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetIdleTimer = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    if (!idleConfig.enabled) return
    idleTimer.current = setTimeout(() => setIsIdle(true), idleConfig.timeoutSeconds * 1000)
  }, [idleConfig.enabled, idleConfig.timeoutSeconds])

  useEffect(() => {
    window.api.kioskIdleConfig.get().then((cfg) => { if (cfg) setIdleConfig(cfg as IdleConfig) })
  }, [])

  // Restart timer when config changes
  useEffect(() => { resetIdleTimer() }, [resetIdleTimer])

  function handleUserActivity() {
    setIsIdle(false)
    resetIdleTimer()
  }

  // ── Mode ─────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<KioskMode>('home')

  // ── Ticket state ─────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<QueueCategory[]>([])
  const [ticketStep, setTicketStep] = useState<TicketStep>('select')
  const [selectedCat, setSelectedCat] = useState<QueueCategory | null>(null)
  const [kioskQuestions, setKioskQuestions] = useState<KioskQuestion[]>([])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<KioskAnswer[]>([])
  const [textInput, setTextInput] = useState('')
  const [ticketNumber, setTicketNumber] = useState('')
  const [estimatedWaitMinutes, setEstimatedWaitMinutes] = useState<number | null>(null)
  const [waitingAhead, setWaitingAhead] = useState(0)

  // ── Feedback state ───────────────────────────────────────────────────────
  const [feedbackQuestions, setFeedbackQuestions] = useState<FeedbackQuestion[]>([])
  const [feedbackStep, setFeedbackStep] = useState<FeedbackStep>('questions')
  const [feedbackIndex, setFeedbackIndex] = useState(0)
  const [feedbackAnswers, setFeedbackAnswers] = useState<FeedbackAnswerItem[]>([])
  const [feedbackText, setFeedbackText] = useState('')

  // ── Help state ───────────────────────────────────────────────────────────
  const [helpItems, setHelpItems] = useState<HelpItem[]>([])
  const [expandedHelpId, setExpandedHelpId] = useState<string | null>(null)

  // ── Countdown ────────────────────────────────────────────────────────────
  const [countdown, setCountdown] = useState(RESET_SECONDS)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [time, setTime] = useState(new Date())

  const T = {
    welcome:       sw ? 'Karibu' : 'Welcome',
    selfService:   sw ? 'Ujihudumie Mwenyewe' : 'Self Service',
    takeTicket:    sw ? 'Chukua Tiketi' : 'Take a Ticket',
    leaveFeedback: sw ? 'Toa Maoni' : 'Leave Feedback',
    ticketDesc:    sw ? 'Subiri huduma yako' : 'Get in queue for service',
    feedbackDesc:  sw ? 'Tuambie kuhusu huduma' : 'Rate your experience',
    selectService: sw ? 'Chagua huduma' : 'Select a service',
    yourTicket:    sw ? 'Nambari Yako' : 'Your Ticket',
    pleaseWait:    sw ? 'Tafadhali subiri kuitwa' : 'Please wait to be called',
    resetting:     sw ? 'Inarudi katika' : 'Resetting in',
    back:          sw ? 'Rudi' : 'Back',
    next:          sw ? 'Endelea' : 'Next',
    skip:          sw ? 'Ruka' : 'Skip',
    aheadOf:       sw ? 'mbele yako' : 'ahead of you',
    estWait:       sw ? 'muda wa kusubiri' : 'est. wait',
    question:      sw ? 'Swali' : 'Question',
    typeAnswer:    sw ? 'Andika jibu lako...' : 'Type your answer...',
    thankyou:      sw ? 'Asante!' : 'Thank you!',
    feedbackSent:  sw ? 'Maoni yako yamepokelewa.' : 'Your feedback has been received.',
    help:          sw ? 'Msaada' : 'Help',
    helpDesc:      sw ? 'Maswali ya kawaida' : 'Common questions & directions',
    helpTitle:     sw ? 'Tunaweza Kukusaidia?' : 'How Can We Help?',
    tapToSeeMore:  sw ? 'Gusa swali kuona jibu' : 'Tap a question to see the answer',
    noHelp:        sw ? 'Hakuna msaada uliowekwa.' : 'No help items configured yet.',
  }

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    window.api.categories.list().then((cats) => setCategories(cats as QueueCategory[]))
    window.api.feedback.listQuestions().then((qs) => setFeedbackQuestions(qs as FeedbackQuestion[]))
    window.api.help.list().then((items) => setHelpItems(items as HelpItem[]))
  }, [])

  function startCountdown(onDone?: () => void) {
    setCountdown(RESET_SECONDS)
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(countdownRef.current!)
          onDone ? onDone() : resetAll()
          return RESET_SECONDS
        }
        return c - 1
      })
    }, 1000)
  }

  function resetAll() {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
    setMode('home')
    setTicketStep('select')
    setSelectedCat(null)
    setKioskQuestions([])
    setQuestionIndex(0)
    setAnswers([])
    setTextInput('')
    setTicketNumber('')
    setEstimatedWaitMinutes(null)
    setWaitingAhead(0)
    setFeedbackStep('questions')
    setFeedbackIndex(0)
    setFeedbackAnswers([])
    setFeedbackText('')
    setExpandedHelpId(null)
    setCountdown(RESET_SECONDS)
    resetIdleTimer()
  }

  // ══ TICKET FLOW ══════════════════════════════════════════════════════════

  async function handleCategoryTap(cat: QueueCategory) {
    setSelectedCat(cat)
    const qs = await window.api.kioskQuestions.list(cat.id) as KioskQuestion[]
    if (qs.length === 0) {
      await issueTicket(cat, [])
    } else {
      setKioskQuestions(qs); setQuestionIndex(0); setAnswers([]); setTextInput('')
      setTicketStep('questions')
    }
  }

  function visibleKioskQs(allQs: KioskQuestion[], curAnswers: KioskAnswer[]) {
    return allQs.filter(q => {
      if (!q.dependsOnQuestionId) return true
      const dep = curAnswers.find(a => a.questionId === q.dependsOnQuestionId)
      if (!dep) return false
      return !q.dependsOnOptionId || dep.optionId === q.dependsOnOptionId
    })
  }

  function handleOptionSelect(q: KioskQuestion, opt: { id: string; label: string; routesToWindowId?: string }) {
    const answer: KioskAnswer = { questionId: q.id, question: q.question, optionId: opt.id, value: opt.label, routesToWindowId: opt.routesToWindowId }
    advanceKiosk([...answers.filter(a => a.questionId !== q.id), answer])
  }

  function advanceKiosk(newAnswers: KioskAnswer[]) {
    if (!selectedCat) return
    setAnswers(newAnswers)
    const visible = visibleKioskQs(kioskQuestions, newAnswers)
    if (questionIndex + 1 < visible.length) { setQuestionIndex(questionIndex + 1); setTextInput('') }
    else issueTicket(selectedCat, newAnswers)
  }

  function handleKioskTextNext() {
    if (!selectedCat) return
    const q = visibleKioskQs(kioskQuestions, answers)[questionIndex]
    if (!q) return
    advanceKiosk([...answers.filter(a => a.questionId !== q.id), { questionId: q.id, question: q.question, value: textInput.trim() || '—' }])
  }

  async function issueTicket(cat: QueueCategory, collectedAnswers: KioskAnswer[]) {
    setTicketStep('issuing')
    try {
      const waitInfo = await window.api.stats.waitTime(cat.id).catch(() => null)
      const ahead = waitInfo?.waitingAhead ?? 0
      const waitMins = waitInfo ? Math.ceil((ahead * (waitInfo as any).avgServiceSeconds) / 60) : null
      setWaitingAhead(ahead); setEstimatedWaitMinutes(waitMins)
      const seq = await window.api.tickets.nextSequence(cat.id)
      const displayNumber = `${cat.prefix}${padNumber(seq)}`
      const id = generateId(); const createdAt = new Date().toISOString()
      await window.api.tickets.create({ id, displayNumber, sequenceNumber: seq, categoryId: cat.id, createdAt, answers: collectedAnswers })
      window.api.print.ticket({
        displayNumber, categoryLabel: cat.label,
        organizationName: orgName, issuedAt: createdAt,
        windowCount: config?.windowCount ?? 1,
        waitingAhead: ahead, estimatedWaitMinutes: waitMins ?? undefined,
        answers: collectedAnswers,
      }).catch(console.error)
      setTicketNumber(displayNumber); setTicketStep('done'); startCountdown()
    } catch { resetAll() }
  }

  const currentKioskQs = visibleKioskQs(kioskQuestions, answers)
  const currentKioskQ = currentKioskQs[questionIndex] ?? null
  const kioskProgress = currentKioskQs.length > 0 ? (questionIndex / currentKioskQs.length) * 100 : 0

  // ══ FEEDBACK FLOW ════════════════════════════════════════════════════════

  /** Filter feedback questions based on prior answers (conditional branching) */
  function visibleFeedbackQs(allQs: FeedbackQuestion[], curAnswers: FeedbackAnswerItem[]) {
    return allQs.filter(q => {
      if (!q.dependsOnQuestionId) return true
      const dep = curAnswers.find(a => a.questionId === q.dependsOnQuestionId)
      if (!dep) return false
      if (!q.dependsOnAnswerValue) return true
      const v = q.dependsOnAnswerValue
      // Score-based (star/emoji): "lte:2", "gte:4", "eq:3"
      const scoreMatch = v.match(/^(lte|gte|eq):(\d+)$/)
      if (scoreMatch && dep.score !== undefined) {
        const threshold = parseInt(scoreMatch[2])
        if (scoreMatch[1] === 'lte') return dep.score <= threshold
        if (scoreMatch[1] === 'gte') return dep.score >= threshold
        if (scoreMatch[1] === 'eq') return dep.score === threshold
      }
      // Choice-based: exact option match
      return dep.value === v
    })
  }

  const visibleFbQs = visibleFeedbackQs(feedbackQuestions, feedbackAnswers)
  const currentFeedbackQ = visibleFbQs[feedbackIndex] ?? null
  const feedbackProgress = visibleFbQs.length > 0 ? (feedbackIndex / visibleFbQs.length) * 100 : 0

  function recordFeedbackAnswer(answer: FeedbackAnswerItem) {
    const newAnswers = [...feedbackAnswers.filter(a => a.questionId !== answer.questionId), answer]
    setFeedbackAnswers(newAnswers)
    // Re-compute visible questions with the updated answers so branching is applied immediately
    const nextVisible = visibleFeedbackQs(feedbackQuestions, newAnswers)
    if (feedbackIndex + 1 < nextVisible.length) { setFeedbackIndex(feedbackIndex + 1); setFeedbackText('') }
    else submitFeedback(newAnswers)
  }

  async function submitFeedback(collectedAnswers: FeedbackAnswerItem[]) {
    try { await window.api.feedback.submit({ answers: collectedAnswers }) } catch { /* best-effort */ }
    setFeedbackStep('thankyou'); startCountdown(resetAll)
  }

  function handleFeedbackSkip() {
    const nextVisible = visibleFeedbackQs(feedbackQuestions, feedbackAnswers)
    if (feedbackIndex + 1 < nextVisible.length) { setFeedbackIndex(feedbackIndex + 1); setFeedbackText('') }
    else submitFeedback(feedbackAnswers)
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-screen bg-[#0a0a0f] text-white overflow-hidden select-none cursor-default"
      onPointerDown={handleUserActivity}
      onKeyDown={handleUserActivity}
    >
      {/* Idle overlay */}
      {isIdle && idleConfig.enabled && (
        <IdleScreen config={idleConfig} orgName={orgName} onDismiss={handleUserActivity} />
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-10 py-5 border-b border-zinc-800/60 flex-shrink-0"
        style={{ background: 'linear-gradient(180deg, #0d0d14 0%, #0a0a0f 100%)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-0.5">
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            <p className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">{T.selfService}</p>
          </div>
          <p className="text-3xl font-black text-zinc-100 leading-tight">
            {T.welcome}, <span className="text-indigo-400">{orgName}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-bold tabular-nums text-zinc-100">{formatTime(time)}</p>
          <p className="text-xs text-zinc-500 mt-1">{new Date().toLocaleDateString(sw ? 'sw-TZ' : 'en-TZ', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-10 py-8 overflow-hidden">

        {/* ══ HOME ══════════════════════════════════════════════════════════ */}
        {mode === 'home' && (
          <div className="w-full max-w-2xl space-y-5">
            <p className="text-center text-zinc-400 text-lg mb-8">
              {sw ? 'Ungependa kufanya nini?' : 'What would you like to do?'}
            </p>
            <div className="grid grid-cols-2 gap-5">
              <button onClick={() => setMode('ticket')}
                className="group rounded-3xl border-2 border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 hover:border-indigo-500/70 active:scale-95 transition-all duration-200 p-8 text-center flex flex-col items-center gap-4">
                <div className="w-20 h-20 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30 group-hover:shadow-indigo-600/50 transition-shadow">
                  <Ticket className="w-10 h-10 text-white" />
                </div>
                <div>
                  <p className="text-xl font-bold text-zinc-100">{T.takeTicket}</p>
                  <p className="text-sm text-zinc-500 mt-1">{T.ticketDesc}</p>
                </div>
              </button>
              <button onClick={() => { setFeedbackStep('questions'); setFeedbackIndex(0); setFeedbackAnswers([]); setFeedbackText(''); setMode('feedback') }}
                className="group rounded-3xl border-2 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 hover:border-amber-500/70 active:scale-95 transition-all duration-200 p-8 text-center flex flex-col items-center gap-4">
                <div className="w-20 h-20 rounded-2xl bg-amber-600 flex items-center justify-center shadow-lg shadow-amber-600/30 group-hover:shadow-amber-600/50 transition-shadow">
                  <Star className="w-10 h-10 text-white" />
                </div>
                <div>
                  <p className="text-xl font-bold text-zinc-100">{T.leaveFeedback}</p>
                  <p className="text-sm text-zinc-500 mt-1">{T.feedbackDesc}</p>
                </div>
              </button>
            </div>
            {/* Help button — full width below */}
            <button onClick={() => { setExpandedHelpId(null); setMode('help') }}
              className="group w-full rounded-3xl border-2 border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 hover:border-emerald-500/70 active:scale-95 transition-all duration-200 px-8 py-5 flex items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-600/30 group-hover:shadow-emerald-600/50 transition-shadow flex-shrink-0">
                <HelpCircle className="w-7 h-7 text-white" />
              </div>
              <div className="text-left">
                <p className="text-lg font-bold text-zinc-100">{T.help}</p>
                <p className="text-sm text-zinc-500 mt-0.5">{T.helpDesc}</p>
              </div>
            </button>
          </div>
        )}

        {/* ══ TICKET: Category select ═══════════════════════════════════════ */}
        {mode === 'ticket' && ticketStep === 'select' && (
          <div className="w-full max-w-4xl">
            <div className="text-center mb-8">
              <p className="text-4xl font-bold text-zinc-100 mb-2">{T.takeTicket}</p>
              <p className="text-zinc-500 text-lg">{T.selectService}</p>
            </div>
            <div className={cn('grid gap-5', categories.length <= 2 ? 'grid-cols-2' : categories.length <= 4 ? 'grid-cols-2' : 'grid-cols-3')}>
              {categories.map((cat) => (
                <button key={cat.id} onClick={() => handleCategoryTap(cat)}
                  className="rounded-3xl border-2 p-8 text-center transition-all duration-200 active:scale-95 hover:scale-[1.02]"
                  style={{ borderColor: `${cat.color}55`, backgroundColor: `${cat.color}15` }}>
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-2xl font-black text-white" style={{ backgroundColor: cat.color }}>{cat.code}</div>
                  <p className="text-xl font-bold text-zinc-100">{cat.label}</p>
                  <p className="text-sm text-zinc-500 mt-1">{cat.prefix}001 ···</p>
                </button>
              ))}
              {categories.length === 0 && <p className="col-span-3 text-center text-zinc-600 text-xl">No services configured</p>}
            </div>
            <button onClick={() => setMode('home')} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mx-auto mt-8">
              <ChevronLeft className="w-4 h-4" /> {T.back}
            </button>
          </div>
        )}

        {/* ══ TICKET: Kiosk questions ═══════════════════════════════════════ */}
        {mode === 'ticket' && ticketStep === 'questions' && currentKioskQ && (
          <div className="w-full max-w-xl flex flex-col gap-6">
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${kioskProgress}%`, backgroundColor: selectedCat?.color ?? '#4F46E5' }} />
            </div>
            <p className="text-center text-xs text-zinc-500 -mt-2 uppercase tracking-widest">{T.question} {questionIndex + 1} / {currentKioskQs.length}</p>
            {selectedCat && (
              <div className="flex justify-center">
                <span className="inline-flex items-center text-sm font-semibold px-4 py-1.5 rounded-full"
                  style={{ backgroundColor: `${selectedCat.color}20`, color: selectedCat.color, border: `1px solid ${selectedCat.color}40` }}>
                  {selectedCat.label}
                </span>
              </div>
            )}
            <h2 className="text-2xl font-bold text-zinc-100 text-center leading-snug">{currentKioskQ.question}</h2>
            {currentKioskQ.type === 'single' && (
              <div className="grid gap-3">
                {currentKioskQ.options.map(opt => (
                  <button key={opt.id} onClick={() => handleOptionSelect(currentKioskQ, opt)}
                    className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 hover:border-zinc-500 hover:bg-zinc-800/60 active:scale-[0.98] px-6 py-4 text-left text-base font-medium text-zinc-100 transition-all flex items-center justify-between group">
                    <span>{opt.label}</span>
                    <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
                  </button>
                ))}
              </div>
            )}
            {currentKioskQ.type === 'text' && (
              <div className="flex flex-col gap-3">
                <input type="text" value={textInput} onChange={e => setTextInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && textInput.trim()) handleKioskTextNext() }}
                  placeholder={T.typeAnswer} autoFocus
                  className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 px-6 py-4 text-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors" />
                <button onClick={handleKioskTextNext} disabled={!textInput.trim()}
                  className="w-full rounded-2xl py-4 text-base font-semibold disabled:opacity-30 flex items-center justify-center gap-2 transition-colors"
                  style={{ backgroundColor: selectedCat?.color ?? '#4F46E5' }}>
                  {T.next} <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
            <button onClick={() => { questionIndex === 0 ? setTicketStep('select') : (setQuestionIndex(questionIndex - 1), setTextInput('')) }}
              className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mx-auto mt-2">
              <ChevronLeft className="w-4 h-4" /> {T.back}
            </button>
          </div>
        )}

        {/* ══ TICKET: Issuing ═══════════════════════════════════════════════ */}
        {mode === 'ticket' && ticketStep === 'issuing' && (
          <div className="flex flex-col items-center gap-6 animate-pulse">
            <div className="w-24 h-24 rounded-full border-4 border-zinc-700 flex items-center justify-center">
              <div className="w-10 h-10 border-4 border-zinc-400 border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-2xl text-zinc-400">{sw ? 'Inatoa tiketi...' : 'Issuing ticket...'}</p>
          </div>
        )}

        {/* ══ TICKET: Done ══════════════════════════════════════════════════ */}
        {mode === 'ticket' && ticketStep === 'done' && (
          <div className="flex flex-col items-center text-center w-full max-w-lg">
            <p className="text-zinc-500 text-xl uppercase tracking-widest mb-2">{selectedCat?.label}</p>
            <p className="text-zinc-400 text-lg mb-5">{T.yourTicket}</p>
            <div className="rounded-3xl px-20 py-10 mb-6 shadow-2xl"
              style={{
                background: `linear-gradient(135deg, ${selectedCat?.color ?? '#4F46E5'}20, ${selectedCat?.color ?? '#4F46E5'}35)`,
                border: `3px solid ${selectedCat?.color ?? '#4F46E5'}66`,
                boxShadow: `0 0 80px ${selectedCat?.color ?? '#4F46E5'}30`,
              }}>
              <p className="font-black tracking-tight leading-none" style={{ fontSize: 'clamp(5rem, 18vw, 11rem)', color: selectedCat?.color ?? '#4F46E5' }}>
                {ticketNumber}
              </p>
            </div>
            {answers.length > 0 && (
              <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/40 px-5 py-4 mb-5 text-left space-y-2">
                {answers.map((a) => (
                  <div key={a.questionId} className="flex items-start gap-3">
                    <span className="text-xs text-zinc-600 mt-0.5 flex-shrink-0">◆</span>
                    <div className="min-w-0">
                      <p className="text-xs text-zinc-500">{a.question}</p>
                      <p className="text-sm font-semibold text-zinc-200 mt-0.5">{a.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {estimatedWaitMinutes !== null && (
              <div className="flex items-center gap-6 mb-5">
                <div className="text-center">
                  <p className="text-4xl font-extrabold tabular-nums text-zinc-100">{waitingAhead}</p>
                  <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wide">{T.aheadOf}</p>
                </div>
                <div className="w-px h-10 bg-zinc-800" />
                <div className="text-center">
                  <p className="text-4xl font-extrabold tabular-nums text-amber-400">
                    ~{estimatedWaitMinutes < 1 ? '<1' : estimatedWaitMinutes}
                    <span className="text-xl font-normal text-zinc-500 ml-1">min</span>
                  </p>
                  <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wide">{T.estWait}</p>
                </div>
              </div>
            )}
            <p className="text-zinc-400 text-xl mb-5">{T.pleaseWait}</p>
            <div className="flex flex-col items-center gap-3">
              <div className="w-48 h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-zinc-500 rounded-full transition-all duration-1000" style={{ width: `${(countdown / RESET_SECONDS) * 100}%` }} />
              </div>
              <p className="text-xs text-zinc-600">{T.resetting} {countdown}s</p>
            </div>
          </div>
        )}

        {/* ══ FEEDBACK: No questions ════════════════════════════════════════ */}
        {mode === 'feedback' && visibleFbQs.length === 0 && (
          <div className="flex flex-col items-center gap-6 text-center">
            <MessageSquare className="w-16 h-16 text-zinc-700" />
            <p className="text-zinc-400 text-xl">{sw ? 'Maswali ya maoni hayajaundwa.' : 'No feedback questions configured yet.'}</p>
            <button onClick={resetAll} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
              <ChevronLeft className="w-4 h-4" /> {T.back}
            </button>
          </div>
        )}

        {/* ══ FEEDBACK: Questions ═══════════════════════════════════════════ */}
        {mode === 'feedback' && feedbackStep === 'questions' && currentFeedbackQ && (
          <div className="w-full max-w-xl flex flex-col gap-6">
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${feedbackProgress}%` }} />
            </div>
            <p className="text-center text-xs text-zinc-500 -mt-2 uppercase tracking-widest">{T.question} {feedbackIndex + 1} / {visibleFbQs.length}</p>
            <h2 className="text-2xl font-bold text-zinc-100 text-center leading-snug">{currentFeedbackQ.question}</h2>

            {currentFeedbackQ.type === 'star' && (
              <div className="flex justify-center gap-4">
                {[1, 2, 3, 4, 5].map(score => (
                  <button key={score} onClick={() => recordFeedbackAnswer({ questionId: currentFeedbackQ.id, question: currentFeedbackQ.question, type: 'star', score })}
                    className="text-6xl transition-transform active:scale-90 hover:scale-110 duration-150">⭐</button>
                ))}
              </div>
            )}

            {currentFeedbackQ.type === 'emoji' && (
              <div className="flex justify-center gap-3">
                {EMOJI_OPTIONS.map(opt => (
                  <button key={opt.score} onClick={() => recordFeedbackAnswer({ questionId: currentFeedbackQ.id, question: currentFeedbackQ.question, type: 'emoji', score: opt.score, value: opt.label })}
                    className="flex flex-col items-center gap-2 p-3 rounded-2xl border border-zinc-700 bg-zinc-900/60 hover:border-zinc-500 hover:bg-zinc-800/60 active:scale-95 transition-all min-w-[72px]">
                    <span className="text-5xl">{opt.emoji}</span>
                    <span className="text-xs text-zinc-500">{opt.label}</span>
                  </button>
                ))}
              </div>
            )}

            {currentFeedbackQ.type === 'choice' && (
              <div className="grid gap-3">
                {currentFeedbackQ.options.map((opt: string) => (
                  <button key={opt} onClick={() => recordFeedbackAnswer({ questionId: currentFeedbackQ.id, question: currentFeedbackQ.question, type: 'choice', value: opt })}
                    className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 hover:border-zinc-500 hover:bg-zinc-800/60 active:scale-[0.98] px-6 py-4 text-left text-base font-medium text-zinc-100 transition-all flex items-center justify-between group">
                    <span>{opt}</span>
                    <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
                  </button>
                ))}
              </div>
            )}

            {currentFeedbackQ.type === 'text' && (
              <div className="flex flex-col gap-3">
                <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)}
                  placeholder={T.typeAnswer} rows={3} autoFocus
                  className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 px-6 py-4 text-base text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-colors resize-none" />
                <button onClick={() => { if (feedbackText.trim()) recordFeedbackAnswer({ questionId: currentFeedbackQ.id, question: currentFeedbackQ.question, type: 'text', value: feedbackText.trim() }) }}
                  disabled={!feedbackText.trim()}
                  className="w-full rounded-2xl py-4 bg-amber-600 hover:bg-amber-500 disabled:opacity-30 text-base font-semibold flex items-center justify-center gap-2 transition-colors">
                  {T.next} <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}

            <div className="flex items-center justify-between">
              <button onClick={() => { feedbackIndex === 0 ? resetAll() : (setFeedbackIndex(feedbackIndex - 1), setFeedbackText('')) }}
                className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
                <ChevronLeft className="w-4 h-4" /> {T.back}
              </button>
              {!currentFeedbackQ.isRequired && (
                <button onClick={handleFeedbackSkip} className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
                  {T.skip} →
                </button>
              )}
            </div>
          </div>
        )}

        {/* ══ FEEDBACK: Thank you ═══════════════════════════════════════════ */}
        {mode === 'feedback' && feedbackStep === 'thankyou' && (
          <div className="flex flex-col items-center text-center gap-6">
            <div className="w-24 h-24 rounded-full bg-amber-500/20 border-2 border-amber-500/40 flex items-center justify-center">
              <span className="text-5xl">🙏</span>
            </div>
            <div>
              <p className="text-4xl font-bold text-zinc-100 mb-3">{T.thankyou}</p>
              <p className="text-zinc-400 text-lg max-w-sm">{T.feedbackSent}</p>
            </div>
            <div className="flex flex-col items-center gap-3 mt-4">
              <div className="w-48 h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full transition-all duration-1000" style={{ width: `${(countdown / RESET_SECONDS) * 100}%` }} />
              </div>
              <p className="text-xs text-zinc-600">{T.resetting} {countdown}s</p>
            </div>
          </div>
        )}

        {/* ══ HELP ══════════════════════════════════════════════════════════ */}
        {mode === 'help' && (
          <div className="w-full max-w-2xl flex flex-col h-full">
            <div className="text-center mb-6 flex-shrink-0">
              <p className="text-3xl font-bold text-zinc-100 mb-1">{T.helpTitle}</p>
              <p className="text-zinc-500 text-base">{T.tapToSeeMore}</p>
            </div>

            {helpItems.length === 0 && (
              <div className="flex flex-col items-center gap-4 text-center flex-1 justify-center">
                <HelpCircle className="w-16 h-16 text-zinc-700" />
                <p className="text-zinc-500 text-lg">{T.noHelp}</p>
              </div>
            )}

            {helpItems.length > 0 && (
              <div className="flex-1 overflow-y-auto space-y-3 pb-4 pr-1" style={{ scrollbarWidth: 'none' }}>
                {/* Group by category */}
                {Array.from(new Set(helpItems.map((it) => it.category))).map((cat) => (
                  <div key={cat}>
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 px-1">{cat}</p>
                    <div className="space-y-2">
                      {helpItems.filter((it) => it.category === cat).map((item) => (
                        <div key={item.id}>
                          <button
                            onClick={() => setExpandedHelpId(expandedHelpId === item.id ? null : item.id)}
                            className={cn(
                              'w-full rounded-2xl border-2 px-5 py-4 text-left flex items-center gap-4 transition-all duration-200 active:scale-[0.99]',
                              expandedHelpId === item.id
                                ? 'border-emerald-500/60 bg-emerald-500/10 rounded-b-none border-b-0'
                                : 'border-zinc-700/60 bg-zinc-800/30 hover:border-zinc-600 hover:bg-zinc-800/60'
                            )}>
                            <span className="text-2xl flex-shrink-0">{item.icon}</span>
                            <p className="flex-1 text-base font-semibold text-zinc-100">{item.question}</p>
                            <ChevronRight className={cn('w-5 h-5 flex-shrink-0 transition-transform duration-200',
                              expandedHelpId === item.id ? 'rotate-90 text-emerald-400' : 'text-zinc-600')} />
                          </button>
                          {expandedHelpId === item.id && (
                            <div className="rounded-b-2xl border-2 border-t-0 border-emerald-500/60 bg-emerald-500/5 px-5 py-4">
                              <p className="text-base text-zinc-200 leading-relaxed whitespace-pre-line">{item.answer}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button onClick={resetAll} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mx-auto mt-4 flex-shrink-0">
              <ChevronLeft className="w-4 h-4" /> {T.back}
            </button>
          </div>
        )}

      </main>
    </div>
  )
}
