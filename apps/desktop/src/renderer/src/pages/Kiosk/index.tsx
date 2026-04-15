import { useEffect, useState, useRef } from 'react'
import { useAppStore } from '../../store/app'
import { cn, generateId, padNumber, formatTime } from '../../lib/utils'
import type { QueueCategory, KioskQuestion, KioskAnswer } from '@announcement/shared'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type KioskStep = 'select' | 'questions' | 'issuing' | 'done'

const RESET_SECONDS = 12

export default function KioskPage() {
  const { config } = useAppStore()
  const [categories, setCategories] = useState<QueueCategory[]>([])
  const [step, setStep] = useState<KioskStep>('select')

  // Selected category
  const [selectedCat, setSelectedCat] = useState<QueueCategory | null>(null)

  // Question flow
  const [questions, setQuestions] = useState<KioskQuestion[]>([])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<KioskAnswer[]>([])
  const [textInput, setTextInput] = useState('')

  // Ticket result
  const [ticketNumber, setTicketNumber] = useState('')
  const [estimatedWaitMinutes, setEstimatedWaitMinutes] = useState<number | null>(null)
  const [waitingAhead, setWaitingAhead] = useState<number>(0)

  // Countdown
  const [countdown, setCountdown] = useState(RESET_SECONDS)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clock
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Load categories
  useEffect(() => {
    window.api.categories.list().then((cats) => setCategories(cats as QueueCategory[]))
  }, [])

  const lang = config?.language ?? 'en'

  const T = {
    welcome:   lang === 'sw' ? 'Karibu' : 'Welcome',
    subtitle:  lang === 'sw' ? 'Chagua huduma unayohitaji' : 'Select the service you need',
    take:      lang === 'sw' ? 'Chukua Tiketi' : 'Take a Ticket',
    yourTicket: lang === 'sw' ? 'Nambari Yako' : 'Your Ticket',
    pleaseWait: lang === 'sw' ? 'Tafadhali subiri kuitwa' : 'Please wait to be called',
    resetting:  lang === 'sw' ? 'Inarudi katika' : 'Resetting in',
    back:       lang === 'sw' ? 'Rudi' : 'Back',
    next:       lang === 'sw' ? 'Endelea' : 'Next',
    confirm:    lang === 'sw' ? 'Thibitisha' : 'Confirm',
    aheadOf:    lang === 'sw' ? 'mbele yako' : 'ahead of you',
    estWait:    lang === 'sw' ? 'muda wa kusubiri' : 'est. wait',
    typeAnswer: lang === 'sw' ? 'Andika jibu lako...' : 'Type your answer...',
  }

  function resetToStart() {
    if (countdownRef.current) clearInterval(countdownRef.current)
    setStep('select')
    setSelectedCat(null)
    setQuestions([])
    setQuestionIndex(0)
    setAnswers([])
    setTextInput('')
    setTicketNumber('')
    setEstimatedWaitMinutes(null)
    setWaitingAhead(0)
    setCountdown(RESET_SECONDS)
  }

  function startCountdown() {
    setCountdown(RESET_SECONDS)
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(countdownRef.current!)
          resetToStart()
          return RESET_SECONDS
        }
        return c - 1
      })
    }, 1000)
  }

  // ── Category selected ───────────────────────────────────────────────────────
  async function handleCategoryTap(cat: QueueCategory) {
    if (step !== 'select') return
    setSelectedCat(cat)

    const qs = await window.api.kioskQuestions.list(cat.id) as KioskQuestion[]
    if (qs.length === 0) {
      // No questions — go straight to issuing
      await issueTicket(cat, [])
    } else {
      setQuestions(qs)
      setQuestionIndex(0)
      setAnswers([])
      setTextInput('')
      setStep('questions')
    }
  }

  // ── Filter visible questions based on answers so far ────────────────────────
  function visibleQuestions(allQs: KioskQuestion[], currentAnswers: KioskAnswer[]): KioskQuestion[] {
    return allQs.filter(q => {
      if (!q.dependsOnQuestionId) return true
      const dep = currentAnswers.find(a => a.questionId === q.dependsOnQuestionId)
      if (!dep) return false
      if (q.dependsOnOptionId && dep.optionId !== q.dependsOnOptionId) return false
      return true
    })
  }

  // ── Handle answer for current question ─────────────────────────────────────
  function handleOptionSelect(q: KioskQuestion, opt: { id: string; label: string; routesToWindowId?: string }) {
    const answer: KioskAnswer = {
      questionId: q.id,
      question: q.question,
      optionId: opt.id,
      value: opt.label,
      routesToWindowId: opt.routesToWindowId,
    }
    const newAnswers = [...answers.filter(a => a.questionId !== q.id), answer]
    advanceOrIssue(newAnswers)
  }

  function handleTextNext() {
    if (!selectedCat) return
    const q = visibleQuestions(questions, answers)[questionIndex]
    if (!q) return
    const answer: KioskAnswer = {
      questionId: q.id,
      question: q.question,
      value: textInput.trim() || '—',
    }
    const newAnswers = [...answers.filter(a => a.questionId !== q.id), answer]
    advanceOrIssue(newAnswers)
  }

  function advanceOrIssue(newAnswers: KioskAnswer[]) {
    if (!selectedCat) return
    setAnswers(newAnswers)
    const visible = visibleQuestions(questions, newAnswers)
    const nextIndex = questionIndex + 1
    if (nextIndex < visible.length) {
      setQuestionIndex(nextIndex)
      setTextInput('')
    } else {
      issueTicket(selectedCat, newAnswers)
    }
  }

  function handleBack() {
    if (questionIndex === 0) {
      resetToStart()
    } else {
      setQuestionIndex(questionIndex - 1)
      setTextInput('')
    }
  }

  // ── Issue ticket ────────────────────────────────────────────────────────────
  async function issueTicket(cat: QueueCategory, collectedAnswers: KioskAnswer[]) {
    setStep('issuing')
    try {
      const waitInfo = await window.api.stats.waitTime(cat.id).catch(() => null)
      const ahead = waitInfo?.waitingAhead ?? 0
      const waitMins = waitInfo ? Math.ceil((ahead * waitInfo.avgServiceSeconds) / 60) : null
      setWaitingAhead(ahead)
      setEstimatedWaitMinutes(waitMins)

      const seq = await window.api.tickets.nextSequence(cat.id)
      const displayNumber = `${cat.prefix}${padNumber(seq)}`
      const id = generateId()
      const createdAt = new Date().toISOString()

      await window.api.tickets.create({
        id,
        displayNumber,
        sequenceNumber: seq,
        categoryId: cat.id,
        createdAt,
        answers: collectedAnswers,
      })

      window.api.print.ticket({
        displayNumber,
        categoryLabel: cat.label,
        organizationName: config?.organizationName ?? 'Announcement System',
        issuedAt: createdAt,
        windowCount: config?.windowCount ?? 1,
        waitingAhead: ahead,
        estimatedWaitMinutes: waitMins ?? undefined,
        answers: collectedAnswers,
      }).catch((e) => console.error('[print]', e))

      setTicketNumber(displayNumber)
      setStep('done')
      startCountdown()
    } catch {
      resetToStart()
    }
  }

  // ── Derived: current visible question ───────────────────────────────────────
  const visibleQs = visibleQuestions(questions, answers)
  const currentQ = visibleQs[questionIndex] ?? null
  const progressPct = visibleQs.length > 0 ? ((questionIndex) / visibleQs.length) * 100 : 0

  // ─────────────────────────────────────────────────────────────────────────────

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

      {/* Body */}
      <main className="flex-1 flex flex-col items-center justify-center px-10 py-8 overflow-hidden">

        {/* ── STEP: Category selection ──────────────────────────────────────── */}
        {step === 'select' && (
          <div className="w-full max-w-4xl">
            <div className="text-center mb-10">
              <p className="text-4xl font-bold text-zinc-100 mb-2">{T.take}</p>
              <p className="text-zinc-500 text-lg">{T.subtitle}</p>
            </div>

            <div className={cn(
              'grid gap-5',
              categories.length <= 2 ? 'grid-cols-2' :
              categories.length <= 4 ? 'grid-cols-2' :
              'grid-cols-3'
            )}>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => handleCategoryTap(cat)}
                  className="group rounded-3xl border-2 p-8 text-center transition-all duration-200 active:scale-95 hover:scale-[1.02]"
                  style={{ borderColor: `${cat.color}55`, backgroundColor: `${cat.color}15` }}
                >
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-2xl font-black text-white"
                    style={{ backgroundColor: cat.color }}
                  >
                    {cat.code}
                  </div>
                  <p className="text-xl font-bold text-zinc-100">{cat.label}</p>
                  <p className="text-sm text-zinc-500 mt-1">{cat.prefix}001 ···</p>
                </button>
              ))}
            </div>

            {categories.length === 0 && (
              <p className="text-center text-zinc-600 text-xl mt-8">No services configured</p>
            )}
          </div>
        )}

        {/* ── STEP: Questions ───────────────────────────────────────────────── */}
        {step === 'questions' && currentQ && (
          <div className="w-full max-w-xl flex flex-col gap-6">

            {/* Progress bar */}
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progressPct}%`,
                  backgroundColor: selectedCat?.color ?? '#4F46E5',
                }}
              />
            </div>

            {/* Step indicator */}
            <p className="text-center text-xs text-zinc-500 -mt-2 uppercase tracking-widest">
              {lang === 'sw' ? 'Swali' : 'Question'} {questionIndex + 1} / {visibleQs.length}
            </p>

            {/* Category chip */}
            {selectedCat && (
              <div className="flex justify-center">
                <span
                  className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-1.5 rounded-full"
                  style={{ backgroundColor: `${selectedCat.color}20`, color: selectedCat.color, border: `1px solid ${selectedCat.color}40` }}
                >
                  {selectedCat.label}
                </span>
              </div>
            )}

            {/* Question text */}
            <h2 className="text-2xl font-bold text-zinc-100 text-center leading-snug">
              {currentQ.question}
            </h2>

            {/* Options — single choice */}
            {currentQ.type === 'single' && (
              <div className="grid gap-3">
                {currentQ.options.map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => handleOptionSelect(currentQ, opt)}
                    className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 hover:border-zinc-500 hover:bg-zinc-800/60 active:scale-[0.98] px-6 py-4 text-left text-base font-medium text-zinc-100 transition-all duration-150 flex items-center justify-between group"
                  >
                    <span>{opt.label}</span>
                    <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
                  </button>
                ))}
              </div>
            )}

            {/* Text input */}
            {currentQ.type === 'text' && (
              <div className="flex flex-col gap-3">
                <input
                  type="text"
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && textInput.trim()) handleTextNext() }}
                  placeholder={T.typeAnswer}
                  autoFocus
                  className="w-full rounded-2xl border border-zinc-700 bg-zinc-900/60 px-6 py-4 text-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                />
                <button
                  onClick={handleTextNext}
                  disabled={!textInput.trim()}
                  className="w-full rounded-2xl py-4 text-base font-semibold transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{
                    backgroundColor: selectedCat?.color ?? '#4F46E5',
                    opacity: textInput.trim() ? 1 : undefined,
                  }}
                >
                  {T.next} <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Back button */}
            <button
              onClick={handleBack}
              className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mx-auto mt-2"
            >
              <ChevronLeft className="w-4 h-4" /> {T.back}
            </button>
          </div>
        )}

        {/* ── STEP: Issuing ─────────────────────────────────────────────────── */}
        {step === 'issuing' && (
          <div className="flex flex-col items-center gap-6 animate-pulse">
            <div className="w-24 h-24 rounded-full border-4 border-zinc-700 flex items-center justify-center">
              <div className="w-10 h-10 border-4 border-zinc-400 border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-2xl text-zinc-400">
              {lang === 'sw' ? 'Inatoa tiketi...' : 'Issuing ticket...'}
            </p>
          </div>
        )}

        {/* ── STEP: Done ────────────────────────────────────────────────────── */}
        {step === 'done' && (
          <div className="flex flex-col items-center text-center w-full max-w-lg">
            <p className="text-zinc-500 text-xl uppercase tracking-widest mb-2">{selectedCat?.label}</p>
            <p className="text-zinc-400 text-lg mb-6">{T.yourTicket}</p>

            {/* Big ticket number */}
            <div
              className="rounded-3xl px-20 py-10 mb-6 shadow-2xl"
              style={{
                background: `linear-gradient(135deg, ${selectedCat?.color ?? '#4F46E5'}20, ${selectedCat?.color ?? '#4F46E5'}35)`,
                border: `3px solid ${selectedCat?.color ?? '#4F46E5'}66`,
                boxShadow: `0 0 80px ${selectedCat?.color ?? '#4F46E5'}30`,
              }}
            >
              <p
                className="font-black tracking-tight text-white leading-none"
                style={{ fontSize: 'clamp(5rem, 18vw, 11rem)', color: selectedCat?.color ?? '#4F46E5' }}
              >
                {ticketNumber}
              </p>
            </div>

            {/* Answers summary */}
            {answers.length > 0 && (
              <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/40 px-5 py-4 mb-6 text-left space-y-2">
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

            {/* Wait estimate */}
            {estimatedWaitMinutes !== null && (
              <div className="flex items-center gap-6 mb-6">
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

            <p className="text-zinc-400 text-xl mb-6">{T.pleaseWait}</p>

            {/* Countdown bar */}
            <div className="flex flex-col items-center gap-3">
              <div className="w-48 h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-zinc-500 rounded-full transition-all duration-1000"
                  style={{ width: `${(countdown / RESET_SECONDS) * 100}%` }}
                />
              </div>
              <p className="text-xs text-zinc-600">
                {T.resetting} {countdown}s
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
