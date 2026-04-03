import { useEffect, useState, useRef } from 'react'
import { useAppStore } from '../../store/app'
import { cn, generateId, padNumber, formatTime } from '../../lib/utils'
import type { QueueCategory } from '@announcement/shared'

type KioskStep = 'select' | 'issuing' | 'done'

const RESET_SECONDS = 10

export default function KioskPage() {
  const { config } = useAppStore()
  const [categories, setCategories] = useState<QueueCategory[]>([])
  const [step, setStep] = useState<KioskStep>('select')
  const [ticketNumber, setTicketNumber] = useState('')
  const [categoryLabel, setCategoryLabel] = useState('')
  const [categoryColor, setCategoryColor] = useState('#4F46E5')
  const [countdown, setCountdown] = useState(RESET_SECONDS)
  const [time, setTime] = useState(new Date())
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const lang = config?.language ?? 'en'

  const t = {
    welcome: lang === 'sw' ? 'Karibu' : 'Welcome',
    subtitle: lang === 'sw' ? 'Chagua huduma unayohitaji' : 'Select the service you need',
    yourTicket: lang === 'sw' ? 'Nambari Yako' : 'Your Ticket',
    pleaseWait: lang === 'sw' ? 'Tafadhali subiri kuitwa' : 'Please wait to be called',
    resetting: lang === 'sw' ? 'Inarudi...' : 'Resetting in',
    seconds: lang === 'sw' ? 's' : 's',
    take: lang === 'sw' ? 'Chukua Tiketi' : 'Take a Ticket',
  }

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Load categories
  useEffect(() => {
    window.api.categories.list().then((cats) => setCategories(cats as QueueCategory[]))
  }, [])

  function startCountdown() {
    setCountdown(RESET_SECONDS)
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(countdownRef.current!)
          setStep('select')
          return RESET_SECONDS
        }
        return c - 1
      })
    }, 1000)
  }

  async function handleCategoryTap(cat: QueueCategory) {
    if (step !== 'select') return
    setStep('issuing')
    setCategoryLabel(cat.label)
    setCategoryColor(cat.color)

    try {
      const seq = await window.api.tickets.nextSequence(cat.id)
      const displayNumber = `${cat.prefix}${padNumber(seq)}`
      const ticket = {
        id: generateId(),
        displayNumber,
        sequenceNumber: seq,
        categoryId: cat.id,
        status: 'waiting' as const,
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

      // Auto-print
      window.api.print.ticket({
        displayNumber: ticket.displayNumber,
        categoryLabel: cat.label,
        organizationName: config?.organizationName ?? 'Announcement System',
        issuedAt: ticket.createdAt,
        windowCount: config?.windowCount ?? 1,
      }).catch(() => {/* no printer — ok */})

      setTicketNumber(displayNumber)
      setStep('done')
      startCountdown()
    } catch {
      setStep('select')
    }
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white overflow-hidden select-none cursor-default">

      {/* Header */}
      <header className="flex items-center justify-between px-10 py-5 border-b border-zinc-800/60 flex-shrink-0">
        <div>
          <p className="text-2xl font-bold text-zinc-100">{config?.organizationName ?? 'Announcement System'}</p>
          <p className="text-sm text-zinc-500 mt-0.5">{t.welcome}</p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-bold tabular-nums text-zinc-100">{formatTime(time)}</p>
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 flex flex-col items-center justify-center px-10 py-8">

        {/* STEP: Category selection */}
        {step === 'select' && (
          <div className="w-full max-w-4xl">
            <div className="text-center mb-10">
              <p className="text-4xl font-bold text-zinc-100 mb-2">{t.take}</p>
              <p className="text-zinc-500 text-lg">{t.subtitle}</p>
            </div>

            <div className={cn(
              'grid gap-5',
              categories.length <= 2 ? 'grid-cols-2' :
              categories.length <= 4 ? 'grid-cols-2' :
              categories.length <= 6 ? 'grid-cols-3' : 'grid-cols-3'
            )}>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => handleCategoryTap(cat)}
                  className="group relative rounded-3xl border-2 p-8 text-center transition-all duration-200 active:scale-95 hover:scale-[1.02]"
                  style={{
                    borderColor: `${cat.color}55`,
                    backgroundColor: `${cat.color}15`,
                  }}
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

        {/* STEP: Issuing */}
        {step === 'issuing' && (
          <div className="flex flex-col items-center gap-6 animate-pulse">
            <div className="w-24 h-24 rounded-full border-4 border-zinc-700 flex items-center justify-center">
              <div className="w-10 h-10 border-4 border-zinc-400 border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-2xl text-zinc-400">Issuing ticket...</p>
          </div>
        )}

        {/* STEP: Ticket issued */}
        {step === 'done' && (
          <div className="flex flex-col items-center text-center">
            <p className="text-zinc-500 text-xl uppercase tracking-widest mb-2">{categoryLabel}</p>
            <p className="text-zinc-400 text-lg mb-6">{t.yourTicket}</p>

            {/* Big ticket number */}
            <div
              className="rounded-3xl px-20 py-10 mb-8 shadow-2xl"
              style={{
                background: `linear-gradient(135deg, ${categoryColor}20, ${categoryColor}35)`,
                border: `3px solid ${categoryColor}66`,
                boxShadow: `0 0 80px ${categoryColor}30`,
              }}
            >
              <p
                className="font-black tracking-tight text-white leading-none"
                style={{ fontSize: 'clamp(5rem, 18vw, 13rem)', color: categoryColor }}
              >
                {ticketNumber}
              </p>
            </div>

            <p className="text-zinc-400 text-xl mb-8">{t.pleaseWait}</p>

            {/* Countdown bar */}
            <div className="flex flex-col items-center gap-3">
              <div className="w-48 h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-zinc-500 rounded-full transition-all duration-1000"
                  style={{ width: `${(countdown / RESET_SECONDS) * 100}%` }}
                />
              </div>
              <p className="text-xs text-zinc-600">
                {t.resetting} {countdown}{t.seconds}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
