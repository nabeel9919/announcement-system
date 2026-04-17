import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/app'
import { cn } from '../../lib/utils'
import {
  ArrowLeft, RefreshCw, Star, MessageSquare, TrendingUp, TrendingDown,
  Users, BarChart2, AlignLeft, CheckSquare, Smile, Calendar, Award,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface DayBucket { date: string; count: number; avgScore: number | null }
interface QuestionReport {
  questionId: string; question: string; type: string
  average: number | null; count: number
  distribution: Record<string, number>
  options: { value: string; count: number; pct: number }[]
  textSamples: string[]
}
interface CategoryRow { categoryId: string | null; categoryLabel: string; count: number; avgScore: number | null }
interface AnswerRow { question: string; type: string; value: string | null; score: number | null }
interface ResponseRow { id: string; submittedAt: string; categoryLabel: string | null; answers: AnswerRow[] }
interface Report {
  total: number; overallScore: number | null
  peakDay: { date: string; count: number } | null
  dailyTrend: DayBucket[]
  questions: QuestionReport[]
  byCategory: CategoryRow[]
  recent: ResponseRow[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreColor(score: number | null) {
  if (score === null) return 'text-zinc-400'
  if (score >= 4.2) return 'text-emerald-400'
  if (score >= 3) return 'text-amber-400'
  return 'text-red-400'
}

function scoreBarColor(score: number | null) {
  if (score === null) return 'bg-zinc-600'
  if (score >= 4.2) return 'bg-emerald-500'
  if (score >= 3) return 'bg-amber-500'
  return 'bg-red-500'
}

function scoreBadge(score: number | null) {
  if (score === null) return 'bg-zinc-800 text-zinc-400'
  if (score >= 4.2) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
  if (score >= 3) return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
  return 'bg-red-500/15 text-red-400 border-red-500/30'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function Stars({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="flex items-center gap-px">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={cn('text-sm', i < Math.round(value) ? 'text-amber-400' : 'text-zinc-700')}>★</span>
      ))}
    </span>
  )
}

const PERIOD_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
]

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FeedbackReportPage() {
  const { setPage } = useAppStore()
  const [days, setDays] = useState(30)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedResponse, setExpandedResponse] = useState<string | null>(null)

  async function load(d = days) {
    setLoading(true)
    try {
      const r = await (window.api.feedback.report as (days: number) => Promise<Report>)(d)
      setReport(r)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(days) }, [days])

  // ── Derived stats ──────────────────────────────────────────────────────────

  const prevPeriodTrend = (() => {
    if (!report || report.dailyTrend.length < 2) return null
    const half = Math.floor(report.dailyTrend.length / 2)
    const recent = report.dailyTrend.slice(-half)
    const older = report.dailyTrend.slice(0, half)
    const recentAvg = recent.reduce((s, d) => s + d.count, 0) / half
    const olderAvg = older.reduce((s, d) => s + d.count, 0) / half
    if (olderAvg === 0) return null
    return Math.round(((recentAvg - olderAvg) / olderAvg) * 100)
  })()

  const maxDailyCount = Math.max(...(report?.dailyTrend.map((d) => d.count) ?? [1]), 1)

  // Show at most 30 bars to avoid overcrowding; for 90 days use weekly buckets
  const chartBuckets = (() => {
    if (!report) return []
    if (days <= 30) return report.dailyTrend
    // Fold into weekly buckets for 90-day view
    const weeks: DayBucket[] = []
    for (let i = 0; i < report.dailyTrend.length; i += 7) {
      const chunk = report.dailyTrend.slice(i, i + 7)
      const count = chunk.reduce((s, d) => s + d.count, 0)
      const scored = chunk.filter((d) => d.avgScore !== null)
      const avgScore = scored.length > 0
        ? Math.round((scored.reduce((s, d) => s + (d.avgScore ?? 0), 0) / scored.length) * 10) / 10
        : null
      weeks.push({ date: chunk[0].date, count, avgScore })
    }
    return weeks
  })()
  const maxBucket = Math.max(...chartBuckets.map((b) => b.count), 1)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0f] text-zinc-50 overflow-hidden">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPage('analytics')}
            className="p-2 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-base font-bold text-zinc-100">Feedback Report</h1>
            <p className="text-xs text-zinc-500">Customer satisfaction — detailed analysis</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 p-1">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={cn(
                  'px-3 py-1 rounded text-xs font-medium transition-colors',
                  days === opt.value
                    ? 'bg-primary-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => load(days)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {loading && !report && (
          <div className="flex items-center justify-center py-20 text-zinc-500 text-sm">
            Loading report…
          </div>
        )}

        {report && (
          <>
            {/* ── KPI Row ── */}
            <div className="grid grid-cols-4 gap-4">

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-zinc-500">Total Responses</p>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-primary-400/10">
                    <MessageSquare className="w-3.5 h-3.5 text-primary-400" />
                  </div>
                </div>
                <p className="text-3xl font-extrabold text-primary-400">{report.total}</p>
                {prevPeriodTrend !== null && (
                  <p className={cn('text-xs mt-1 flex items-center gap-1', prevPeriodTrend >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {prevPeriodTrend >= 0
                      ? <TrendingUp className="w-3 h-3" />
                      : <TrendingDown className="w-3 h-3" />}
                    {Math.abs(prevPeriodTrend)}% vs prior half
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-zinc-500">Overall Score</p>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-amber-400/10">
                    <Star className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                </div>
                {report.overallScore !== null ? (
                  <>
                    <p className={cn('text-3xl font-extrabold', scoreColor(report.overallScore))}>
                      {report.overallScore.toFixed(1)}
                      <span className="text-base font-medium text-zinc-600 ml-1">/ 5</span>
                    </p>
                    <Stars value={report.overallScore} />
                  </>
                ) : (
                  <p className="text-zinc-600 text-sm mt-2">No ratings yet</p>
                )}
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-zinc-500">Busiest Day</p>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-400/10">
                    <Calendar className="w-3.5 h-3.5 text-blue-400" />
                  </div>
                </div>
                {report.peakDay ? (
                  <>
                    <p className="text-2xl font-extrabold text-blue-400">{report.peakDay.count}</p>
                    <p className="text-xs text-zinc-500 mt-1">{formatDate(report.peakDay.date)}</p>
                  </>
                ) : (
                  <p className="text-zinc-600 text-sm mt-2">—</p>
                )}
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-zinc-500">Top Category</p>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-400/10">
                    <Award className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                </div>
                {report.byCategory.length > 0 ? (
                  <>
                    <p className="text-sm font-bold text-zinc-100 leading-tight truncate">
                      {report.byCategory[0].categoryLabel}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">{report.byCategory[0].count} responses</p>
                  </>
                ) : (
                  <p className="text-zinc-600 text-sm mt-2">—</p>
                )}
              </div>
            </div>

            {/* ── Daily Trend Chart ── */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
              <div className="flex items-center gap-2 mb-5">
                <BarChart2 className="w-4 h-4 text-zinc-500" />
                <h2 className="text-sm font-semibold text-zinc-100">
                  Response Volume {days === 90 ? '(weekly)' : '(daily)'} — Last {days} days
                </h2>
                <div className="ml-auto flex items-center gap-4 text-xs text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary-500 inline-block" /> Responses
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Avg Score
                  </span>
                </div>
              </div>

              {chartBuckets.every((b) => b.count === 0) ? (
                <p className="text-center text-zinc-600 text-sm py-8">No responses in this period</p>
              ) : (
                <div className="flex items-end gap-1 h-36">
                  {chartBuckets.map((b, i) => {
                    const barH = Math.round((b.count / maxBucket) * 100)
                    const scoreBarH = b.avgScore !== null
                      ? Math.round(((b.avgScore - 1) / 4) * 60)
                      : 0
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                        {b.count > 0 && (
                          <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:flex bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 whitespace-nowrap z-10 flex-col items-center gap-0.5">
                            <span>{b.count} responses</span>
                            {b.avgScore !== null && <span className="text-amber-400">★ {b.avgScore.toFixed(1)}</span>}
                          </div>
                        )}
                        <div className="w-full flex items-end gap-px" style={{ height: '120px' }}>
                          <div
                            className="flex-1 rounded-t-sm bg-primary-600/60 transition-all"
                            style={{ height: `${barH}%`, minHeight: b.count > 0 ? '2px' : '0' }}
                          />
                          {b.avgScore !== null && (
                            <div
                              className={cn('w-1 rounded-t-sm transition-all', scoreBarColor(b.avgScore))}
                              style={{ height: `${scoreBarH}%`, minHeight: '2px' }}
                            />
                          )}
                        </div>
                        {(chartBuckets.length <= 14 || i % Math.ceil(chartBuckets.length / 10) === 0) && (
                          <p className="text-[8px] text-zinc-600 tabular-nums">
                            {days <= 30
                              ? new Date(b.date).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
                              : `W${Math.floor(i + 1)}`}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Per-Question Breakdown ── */}
            {report.questions.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider px-1">
                  Question-by-Question Breakdown
                </h2>

                {report.questions.map((q) => (
                  <div key={q.questionId} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">

                    {/* Question header */}
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {q.type === 'star' && <Star className="w-4 h-4 text-amber-400 flex-shrink-0" />}
                        {q.type === 'emoji' && <Smile className="w-4 h-4 text-blue-400 flex-shrink-0" />}
                        {q.type === 'choice' && <CheckSquare className="w-4 h-4 text-primary-400 flex-shrink-0" />}
                        {q.type === 'text' && <AlignLeft className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
                        <p className="text-sm font-semibold text-zinc-100 truncate">{q.question}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {q.average !== null && (
                          <span className={cn('text-sm font-bold border rounded-lg px-2.5 py-1', scoreBadge(q.average))}>
                            ★ {q.average.toFixed(1)}
                          </span>
                        )}
                        <span className="text-xs text-zinc-500 bg-zinc-800 rounded px-2 py-1">
                          {q.count} {q.count === 1 ? 'response' : 'responses'}
                        </span>
                      </div>
                    </div>

                    {/* Star / emoji: distribution bars */}
                    {(q.type === 'star' || q.type === 'emoji') && q.count > 0 && (
                      <div className="space-y-2">
                        {[5, 4, 3, 2, 1].map((star) => {
                          const cnt = q.distribution[star] ?? 0
                          const pct = q.count > 0 ? Math.round((cnt / q.count) * 100) : 0
                          return (
                            <div key={star} className="flex items-center gap-3">
                              <div className="flex items-center gap-0.5 w-14 flex-shrink-0">
                                {Array.from({ length: star }, (_, i) => (
                                  <span key={i} className="text-xs text-amber-400">★</span>
                                ))}
                              </div>
                              <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                  className={cn('h-full rounded-full transition-all', scoreBarColor(star))}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <div className="flex items-center gap-2 w-20 text-right">
                                <span className="text-xs text-zinc-400 flex-1">{pct}%</span>
                                <span className="text-xs text-zinc-600">({cnt})</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Choice: horizontal bar chart */}
                    {q.type === 'choice' && q.options.length > 0 && (
                      <div className="space-y-2.5">
                        {q.options.map((opt) => (
                          <div key={opt.value}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-zinc-300 font-medium">{opt.value}</span>
                              <span className="text-xs text-zinc-500">{opt.count} · {opt.pct}%</span>
                            </div>
                            <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-primary-500 transition-all"
                                style={{ width: `${opt.pct}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Text: samples */}
                    {q.type === 'text' && q.textSamples.length > 0 && (
                      <div className="space-y-2">
                        {q.textSamples.map((s, i) => (
                          <div key={i} className="flex items-start gap-2 bg-zinc-800/50 rounded-lg px-3 py-2.5">
                            <span className="text-zinc-600 text-xs mt-0.5 flex-shrink-0">"</span>
                            <p className="text-xs text-zinc-300 leading-relaxed">{s}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {q.count === 0 && (
                      <p className="text-xs text-zinc-600 italic">No responses yet</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── Category Breakdown ── */}
            {report.byCategory.length > 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
                <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-2">
                  <Users className="w-4 h-4 text-zinc-500" />
                  <h2 className="text-sm font-semibold text-zinc-100">Feedback by Service Category</h2>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      {['Category', 'Responses', 'Avg Score', 'Satisfaction'].map((h) => (
                        <th key={h} className="text-left px-5 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {report.byCategory.map((cat) => {
                      const pct = cat.avgScore !== null ? Math.round(((cat.avgScore - 1) / 4) * 100) : 0
                      return (
                        <tr key={cat.categoryLabel} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="px-5 py-3.5">
                            <p className="text-zinc-100 font-medium text-xs">{cat.categoryLabel}</p>
                          </td>
                          <td className="px-5 py-3.5 text-primary-400 font-semibold">{cat.count}</td>
                          <td className="px-5 py-3.5">
                            {cat.avgScore !== null ? (
                              <div className="flex items-center gap-2">
                                <span className={cn('text-sm font-bold', scoreColor(cat.avgScore))}>
                                  {cat.avgScore.toFixed(1)}
                                </span>
                                <Stars value={cat.avgScore} />
                              </div>
                            ) : (
                              <span className="text-zinc-600 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3.5">
                            {cat.avgScore !== null ? (
                              <div className="flex items-center gap-2">
                                <div className="w-24 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                  <div
                                    className={cn('h-full rounded-full transition-all', scoreBarColor(cat.avgScore))}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-xs text-zinc-400">{pct}%</span>
                              </div>
                            ) : (
                              <span className="text-zinc-600 text-xs">No ratings</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Recent Individual Responses ── */}
            {report.recent.length > 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
                <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-zinc-500" />
                  <h2 className="text-sm font-semibold text-zinc-100">Recent Responses</h2>
                  <span className="ml-auto text-xs text-zinc-500">Last {report.recent.length}</span>
                </div>
                <div className="divide-y divide-zinc-800">
                  {report.recent.map((r) => {
                    const ratingAnswer = r.answers.find((a) => a.score !== null)
                    const isExpanded = expandedResponse === r.id
                    return (
                      <div key={r.id} className="hover:bg-zinc-800/20 transition-colors">
                        <button
                          className="w-full flex items-center gap-4 px-5 py-3.5 text-left"
                          onClick={() => setExpandedResponse(isExpanded ? null : r.id)}
                        >
                          {/* Score badge */}
                          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
                            {ratingAnswer?.score !== null && ratingAnswer?.score !== undefined ? (
                              <span className={cn('text-sm font-bold', scoreColor(ratingAnswer.score))}>
                                {ratingAnswer.score}
                              </span>
                            ) : (
                              <MessageSquare className="w-4 h-4 text-zinc-500" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-zinc-300">
                              {r.categoryLabel ?? 'General'}
                            </p>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              {r.answers.map((a) => {
                                if (a.score !== null) return `★${a.score}`
                                if (a.value) return a.value.toString().slice(0, 30)
                                return null
                              }).filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <p className="text-xs text-zinc-600">{formatDateTime(r.submittedAt)}</p>
                            <span className={cn('text-xs text-zinc-600 transition-transform inline-block', isExpanded && 'rotate-180')}>▾</span>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-5 pb-4 space-y-2">
                            {r.answers.map((a, i) => (
                              <div key={i} className="flex items-start gap-3 bg-zinc-800/40 rounded-lg px-3 py-2.5">
                                <div className="flex-1">
                                  <p className="text-xs text-zinc-500 mb-1">{a.question}</p>
                                  {a.score !== null ? (
                                    <div className="flex items-center gap-2">
                                      <Stars value={a.score} />
                                      <span className={cn('text-sm font-bold', scoreColor(a.score))}>{a.score}/5</span>
                                    </div>
                                  ) : a.value ? (
                                    <p className="text-sm text-zinc-200">{a.value}</p>
                                  ) : (
                                    <p className="text-xs text-zinc-600 italic">No answer</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Empty state */}
            {report.total === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <MessageSquare className="w-12 h-12 text-zinc-700 mb-4" />
                <p className="text-zinc-400 font-semibold">No feedback in the last {days} days</p>
                <p className="text-zinc-600 text-sm mt-2">
                  Responses collected from kiosk tablets will appear here.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
