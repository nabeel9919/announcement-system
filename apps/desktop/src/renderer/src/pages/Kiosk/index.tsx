import { useEffect, useState, useRef } from 'react'
import { useAppStore } from '../../store/app'
import { cn, generateId, padNumber, formatTime } from '../../lib/utils'
import type { QueueCategory, KioskQuestion, KioskAnswer, FeedbackQuestion, FeedbackAnswerItem } from '@announcement/shared'
import { ChevronLeft, ChevronRight, Ticket, Star, MessageSquare } from 'lucide-react'

// ── Mode ─────────────────────────────────────────────────────────────────────
type KioskMode = 'home' | 'ticket' | 'feedback'

// ── Ticket sub-steps ─────────────────────────────────────────────────────────
type TicketStep = 'select' | 'questions' | 'issuing' | 'done'

// ── Feedback sub-steps ───────────────────────────────────────────────────────
type FeedbackStep = 'questions' | 'thankyou'

const RESET_SECONDS = 12

// ── Emoji sets for feedback ──────────────────────────────────────────────────
const EMOJI_OPTIONS = [
  { score: 1, emoji: '😞', label: 'Very Bad' },
  { score: 2, emoji: '😕', label: 'Bad' },
  { score: 3, emoji: '😐', label: 'Okay' },
  { score: 4, emoji: '😊', label: 'Good' },
  { score: 5, emoji: '😄', label: 'Excellent' },
]

export default function KioskPage() {
  const { config } = useAppStore()

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
  const [submittingFeedback, setSubmittingFeedback] = useState(false)

  // ── Shared ───────────────────────────────────────────────────────────────
  const [countdown, setCountdown] = useState(RESET_SECONDS)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [time, setTime] = useState(new Date())

  const lang = config?.language ?? 'en'
  const sw = lang === 'sw'

  const T = {
    welcome:      sw ? 'Karibu' : 'Welcome',
    takeTicket:   sw ? 'Chukua Tiketi' : 'Take a Ticket',
    leaveFeedback: sw ? 'Toa Maoni' : 'Leave Feedback',
    ticketDesc:   sw ? 'Subiri huduma yako' : 'Get in queue for your service',
    feedbackDesc: sw ? 'Tuambie kuhusu huduma uliyopata' : 'Tell us about your experience',
    selectService: sw ? 'Chagua huduma' : 'Select a service',
    yourTicket:   sw ? 'Nambari Yako' : 'Your Ticket',
    pleaseWait:   sw ? 'Tafadhali subiri kuitwa' : 'Please wait to be called',
    resetting:    sw ? 'Inarudi katika' : 'Resetting in',
    back:         sw ? 'Rudi' : 'Back',
    next:         sw ? 'Endelea' : 'Next',
    skip:         sw ? 'Ruka' : 'Skip',
    aheadOf:      sw ? 'mbele yako' : 'ahead of you',
    estWait:      sw ? 'muda wa kusubiri' : 'est. wait',
    question:     sw ? 'Swali' : 'Question',
    typeAnswer:   sw ? 'Andika jibu lako...' : 'Type your answer...',
    thankyou:     sw ? 'Asante!' : 'Thank you!',
    feedbackSent: sw ? 'Maoni yako yamepokelewa. Tutajaribu kuboresha huduma zetu.' : 'Your feedback has been received. We\'ll work to improve our service.',
    howWasExp:    sw ? 'Je, ulikuwa na uzoefu gani leo?' : 'How was your experience today?',
  }

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Load categories + feedback questions
  useEffect(() => {
    window.api.categories.list().then((cats) => setCategories(cats as QueueCategory[]))
    window.api.feedback.listQuestions().then((qs) => setFeedbackQuestions(qs as FeedbackQuestion[]))
  }, [])

  // ── Countdown ────────────────────────────────────────────────────────────
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

  function stopCountdown() {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
  }

  function resetAll() {
    stopCountdown()
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
    setCountdown(RESET_SECONDS)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TICKET FLOW
  // ══════════════════════════════════════════════════════════════════════════

  async function handleCategoryTap(cat: QueueCategory) {
    setSelectedCat(cat)
    const qs = await window.api.kioskQuestions.list(cat.id) as KioskQuestion[]
    if (qs.length === 0) {
      await issueTicket(cat, [])
    } else {
      setKioskQuestions(qs)
      setQuestionIndex(0)
      setAnswers([])
      setTextInput('')
      setTicketStep('questions')
    }
  }

  function visibleKioskQuestions(allQs: KioskQuestion[], currentAnswers: KioskAnswer[]) {
    return allQs.filter(q => {
      if (!q.dependsOnQuestionId) return true
      const dep = currentAnswers.find(a => a.questionId === q.dependsOnQuestionId)
      if (!dep) return false
      return !q.dependsOnOptionId || dep.optionId === q.dependsOnOptionId
    })
  }

  function handleOptionSelect(q: KioskQuestion, opt: { id: string; label: string; routesToWindowId?: string }) {
    const answer: KioskAnswer = { questionId: q.id, question: q.question, optionId: opt.id, value: opt.label, routesToWindowId: opt.routesToWindowId }
    advanceKiosk([...answers.filter(a => a.questionId !== q.id), answer])
  }

  function handleKioskTextNext() {
    if (!selectedCat) return
    const q = visibleKioskQuestions(kioskQuestions, answers)[questionIndex]
    if (!q) return
    const answer: KioskAnswer = { questionId: q.id, question: q.question, value: textInput.trim() || '—' }
    advanceKiosk([...answers.filter(a => a.questionId !== q.id), answer])
  }

  function advanceKiosk(newAnswers: KioskAnswer[]) {
    if (!selectedCat) return
    setAnswers(newAnswers)
    const visible = visibleKioskQuestions(kioskQuestions, newAnswers)
    if (questionIndex + 1 < visible.length) {
      setQuestionIndex(questionIndex + 1)
      setTextInput('')
    } else {
      issueTicket(selectedCat, newAnswers)
    }
  }

  function handleKioskBack() {
    if (questionIndex === 0) {
      setTicketStep('select')
    } else {
      setQuestionIndex(questionIndex - 1)
      setTextInput('')
    }
  }

  async function issueTicket(cat: QueueCategory, collectedAnswers: KioskAnswer[]) {
    setTicketStep('issuing')
    try {
      const waitInfo = await window.api.stats.waitTime(cat.id).catch(() => null)
      const ahead = waitInfo?.waitingAhead ?? 0
      const waitMins = waitInfo ? Math.ceil((ahead * (waitInfo as any).avgServiceSeconds) / 60) : null
      setWaitingAhead(ahead)
      setEstimatedWaitMinutes(waitMins)

      const seq = await window.api.tickets.nextSequence(cat.id)
      const displayNumber = `${cat.prefix}${padNumber(seq)}`
      const id = generateId()
      const createdAt = new Date().toISOString()

      await window.api.tickets.create({ id, displayNumber, sequenceNumber: seq, categoryId: cat.id, createdAt, answers: collectedAnswers })

      window.api.print.ticket({
        displayNumber, categoryLabel: cat.label,
        organizationName: config?.organizationName ?? 'Announcement System',
        issuedAt: createdAt, windowCount: config?.windowCount ?? 1,
        waitingAhead: ahead, estimatedWaitMinutes: waitMins ?? undefined,
        answers: collectedAnswers,
      }).catch((e) => console.error('[print]', e))

      setTicketNumber(displayNumber)
      setTicketStep('done')
      startCountdown()
    } catch { resetAll() }
  }

  const visibleKioskQs = visibleKioskQuestions(kioskQuestions, answers)
  const currentKioskQ = visibleKioskQs[questionIndex] ?? null
  const kioskProgress = visibleKioskQs.length > 0 ? (questionIndex / visibleKioskQs.length) * 100 : 0

  // ══════════════════════════════════════════════════════════════════════════
  // FEEDBACK FLOW
  // ══════════════════════════════════════════════════════════════════════════

  function enterFeedback() {
    setFeedbackStep('questions')
    setFeedbackIndex(0)
    setFeedbackAnswers([])
    setFeedbackText('')
    setMode('feedback')
  }

  const currentFeedbackQ = feedbackQuestions[feedbackIndex] ?? null
  const feedbackProgress = feedbackQuestions.length > 0 ? (feedbackIndex / feedbackQuestions.length) * 100 : 0

  function recordFeedbackAnswer(answer: FeedbackAnswerItem) {
    const newAnswers = [...feedbackAnswers.filter(a => a.questionId !== answer.questionId), answer]
    setFeedbackAnswers(newAnswers)
    if (feedbackIndex + 1 < feedbackQuestions.length) {
      setFeedbackIndex(feedbackIndex + 1)
      setFeedbackText('')
    } else {
      submitFeedback(newAnswers)
    }
  }

  function handleFeedbackSkip() {
    if (feedbackIndex + 1 < feedbackQuestions.length) {
      setFeedbackIndex(feedbackIndex + 1)
      setFeedbackText('')
    } else {
      submitFeedback(feedbackAnswers)
    }
  }

  function handleFeedbackBack() {
    if (feedbackIndex === 0) {
      resetAll()
    } else {
      setFeedbackIndex(feedbackIndex - 1)
      setFeedbackText('')
    }
  }

  async function submitFeedback(collectedAnswers: FeedbackAnswerItem[]) {
    setSubmittingFeedback(true)
    try {
      await window.api.feedback.submit({ answers: collectedAnswers })
    } catch { /* best-effort */ }
    setSubmittingFeedback(false)
    setFeedbackStep('thankyou')
    startCountdown(resetAll)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0f] text-white overflow-hidden select-none cursor-default">

      {/* Header */}
      <header className="flex items-center justify-between px-10 py-5 border-b border-zinc-800/60 flex-shrink-0">
        <div>
          <p className="text-2xl font-bold text-zinc-100">{config?.organizationName ?? 'Announcement System'}</p>
          <p className="text-sm text-zinc-500 mt-0.5">{T.welcome}</p>
        </div>
        <p className="text-4xl font-bold tabular-nums text-zinc-100">{formatTime(time)}</p>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-10 py-8 overflow-hidden">

        {/* ══ HOME ══════════════════════════════════════════════════════════ */}
        {mode === 'home' && (
          <div className="w-full max-w-2xl space-y-5">
            <p className="text-center text-zinc-400 text-lg mb-8">
              {sw ? 'Ungependa kufanya nini?' : 'What would you like to do?'}
            </p>
            <div className="grid grid-cols-2 gap-5">
              {/* Take a Ticket */}
              <button
                onClick={() => setMode('ticket')}
                className="group rounded-3xl border-2 border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 hover:border-indigo-500/70 active:scale-95 transition-all duration-200 p-8 text-center flex flex-col items-center gap-4"
              >
                <div className="w-20 h-20 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
                  <Ticket className="w-10 h-10 text-white" />
                </div>
                <div>
                  <p className="text-xl font-bold text-zinc-100">{T.takeTicket}</p>
                  <p className="text-sm text-zinc-500 mt-1">{T.ticketDesc}</p>
                </div>
              </button>

              {/* Leave Feedback */}
              <button
                onClick={enterFeedback}
                className="group rounded-3xl border-2 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 hover:border-amber-500/70 active:scale-95 transition-all duration-200 p-8 text-center flex flex-col items-center gap-4"
              >
                <div className="w-20 h-20 rounded-2xl bg-amber-600 flex items-center justify-center shadow-lg shadow-amber-600/30">
                  <Star className="w-10 h-10 text-white" />
                </div>
                <div>
                  <p className="text-xl font-bold text-zinc-100">{T.leaveFeedback}</p>
                  <p className="text-sm text-zinc-500 mt-1">{T.feedbackDesc}</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ══ TICKET FLOW ══════════════════════════════════════════════════ */}

        {/* Category selection */}
        {mode === 'ticket' && ticketStep === 'select' && (
          <div className="w-full max-w-4xl">
            <div className="text-center mb-8">
              <p className="text-4xl font-bold text-zinc-100 mb-2">{T.takeTicket}</p>
              <p className="text-zinc-500 text-lg">{T.selectService}</p>
            </div>
            <div className={cn('grid gap-5',
              categories.length <= 2 ? 'grid-cols-2' :
              categories.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'
            )}>
              {categories.map((cat) => (
                <button key={cat.id} onClick={() => handleCategoryTap(cat)}
                  className="rounded-3xl border-2 p-8 text-center transition-all duration-200 active:scale-95 hover:scale-[1.02]"
                  style={{ borderColor: `${cat.color}55`, backgroundColor: `${cat.color}15` }}>
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-2xl font-black text-white" style={{ backgroundColor: cat.color }}>
                    {cat.code}
                  </div>
                  <p className="text-xl font-bold text-zinc-100">{cat.label}</p>
                  <p className="text-sm text-zinc-500 mt-1">{cat.prefix}001 ···</p>
                </button>
              ))}
              {categories.length === 0 && <p className="col-span-3 text-center text-zinc-600 text-xl mt-8">No services configured</p>}
            </div>
            <button onClick={() => setMode('home')} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mx-auto mt-8">
              <ChevronLeft className="w-4 h-4" /> {T.back}
            </button>
          </div>
        )}

        {/* Kiosk questions */}
        {mode === 'ticket' && ticketStep === 'questions' && currentKioskQ && (
          <div className="w-full max-w-xl flex flex-col gap-6">
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${kioskProgress}%`, backgroundColor: selectedCat?.color ?? '#4F46E5' }} />
            </div>
            <p className="text-center text-xs text-zinc-500 -mt-2 uppercase tracking-widest">
              {T.question} {questionIndex + 1} / {visibleKioskQs.length}
            </p>
            {selectedCat && (
              <div className="flex justify-center">
                <span className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-1.5 rounded-full"
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
                    className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 hover:border-zinc-500 hover:bg-zinc-800/60 active:scale-[0.98] px-6 py-4 text-left text-base font-medium text-zinc-100 transition-all duration-150 flex items-center justify-between group">
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
                  className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 px-6 py-4 text-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors" />
                <button onClick={handleKioskTextNext} disabled={!textInput.trim()}
                  className="w-full rounded-2xl py-4 text-base font-semibold disabled:opacity-30 flex items-center justify-center gap-2"
                  style={{ backgroundColor: selectedCat?.color ?? '#4F46E5' }}>
                  {T.next} <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
            <button onClick={handleKioskBack} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mx-auto mt-2">
              <ChevronLeft className="w-4 h-4" /> {T.back}
            </button>
          </div>
        )}

        {/* Issuing */}
        {mode === 'ticket' && ticketStep === 'issuing' && (
          <div className="flex flex-col items-center gap-6 animate-pulse">
            <div className="w-24 h-24 rounded-full border-4 border-zinc-700 flex items-center justify-center">
              <div className="w-10 h-10 border-4 border-zinc-400 border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-2xl text-zinc-400">{sw ? 'Inatoa tiketi...' : 'Issuing ticket...'}</p>
          </div>
        )}

        {/* Done — ticket issued */}
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
              <p className="font-black tracking-tight leading-none"
                style={{ fontSize: 'clamp(5rem, 18vw, 11rem)', color: selectedCat?.color ?? '#4F46E5' }}>
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

        {/* ══ FEEDBACK FLOW ════════════════════════════════════════════════ */}

        {/* No questions configured */}
        {mode === 'feedback' && feedbackQuestions.length === 0 && (
          <div className="flex flex-col items-center gap-6 text-center">
            <MessageSquare className="w-16 h-16 text-zinc-700" />
            <p className="text-zinc-400 text-xl">{sw ? 'Maswali ya maoni hayajaundwa.' : 'No feedback questions configured yet.'}</p>
            <button onClick={resetAll} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
              <ChevronLeft className="w-4 h-4" /> {T.back}
            </button>
          </div>
        )}

        {/* Feedback questions */}
        {mode === 'feedback' && feedbackStep === 'questions' && currentFeedbackQ && (
          <div className="w-full max-w-xl flex flex-col gap-6">
            {/* Progress */}
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${feedbackProgress}%` }} />
            </div>
            <p className="text-center text-xs text-zinc-500 -mt-2 uppercase tracking-widest">
              {T.question} {feedbackIndex + 1} / {feedbackQuestions.length}
            </p>

            <h2 className="text-2xl font-bold text-zinc-100 text-center leading-snug">{currentFeedbackQ.question}</h2>

            {/* Star rating */}
            {currentFeedbackQ.type === 'star' && (
              <div className="flex justify-center gap-4">
                {[1, 2, 3, 4, 5].map(score => (
                  <button key={score} onClick={() => recordFeedbackAnswer({ questionId: currentFeedbackQ.id, question: currentFeedbackQ.question, type: 'star', score })}
                    className="text-6xl transition-transform active:scale-90 hover:scale-110 duration-150 hover:drop-shadow-lg">
                    ⭐
                  </button>
                ))}
              </div>
            )}

            {/* Emoji rating */}
            {currentFeedbackQ.type === 'emoji' && (
              <div className="flex justify-center gap-3">
                {EMOJI_OPTIONS.map(opt => (
                  <button key={opt.score} onClick={() => recordFeedbackAnswer({ questionId: currentFeedbackQ.id, question: currentFeedbackQ.question, type: 'emoji', score: opt.score, value: opt.label })}
                    className="flex flex-col items-center gap-2 p-3 rounded-2xl border border-zinc-700 bg-zinc-900/60 hover:border-zinc-500 hover:bg-zinc-800/60 active:scale-95 transition-all duration-150 min-w-[72px]">
                    <span className="text-5xl">{opt.emoji}</span>
                    <span className="text-xs text-zinc-500">{opt.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Choice */}
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

            {/* Free text */}
            {currentFeedbackQ.type === 'text' && (
              <div className="flex flex-col gap-3">
                <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)}
                  placeholder={T.typeAnswer} rows={3} autoFocus
                  className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 px-6 py-4 text-base text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors resize-none" />
                <button onClick={() => {
                  if (feedbackText.trim()) {
                    recordFeedbackAnswer({ questionId: currentFeedbackQ.id, question: currentFeedbackQ.question, type: 'text', value: feedbackText.trim() })
                  }
                }} disabled={!feedbackText.trim()}
                  className="w-full rounded-2xl py-4 bg-amber-600 hover:bg-amber-500 disabled:opacity-30 text-base font-semibold flex items-center justify-center gap-2 transition-colors">
                  {T.next} <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Skip + back */}
            <div className="flex items-center justify-between">
              <button onClick={handleFeedbackBack} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
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

        {/* Thank you screen */}
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

      </main>
    </div>
  )
}
