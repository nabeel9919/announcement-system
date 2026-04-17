import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/app'
import { useQueueStore } from '../../store/queue'
import { cn, minutesSince } from '../../lib/utils'
import { ArrowLeft, TrendingUp, Clock, CheckCircle, Users, BarChart2, RefreshCw, Star, MessageSquare, ChevronRight, UserCheck } from 'lucide-react'

interface HourBucket { hour: number; issued: number; served: number }
interface CatPerf { code: string; label: string; color: string; served: number; skipped: number; waiting: number; avgWaitMin: number }
interface FeedbackRating { questionId: string; question: string; average: number; count: number }
interface OpPerf { operatorName: string; windowId: string; totalCalled: number; served: number; skipped: number; noShow: number; avgServiceSeconds: number | null }

export default function AnalyticsPage() {
  const { setPage } = useAppStore()
  const { categories } = useQueueStore()
  const [stats, setStats] = useState({ waiting: 0, called: 0, served: 0, skipped: 0 })
  const [hourly, setHourly] = useState<HourBucket[]>([])
  const [catPerf, setCatPerf] = useState<CatPerf[]>([])
  const [feedbackTotal, setFeedbackTotal] = useState(0)
  const [feedbackRatings, setFeedbackRatings] = useState<FeedbackRating[]>([])
  const [opPerf, setOpPerf] = useState<OpPerf[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshedAt, setRefreshedAt] = useState(new Date())

  async function load() {
    setLoading(true)
    const [s, tickets, fbSummary] = await Promise.all([
      window.api.stats.today(),
      window.api.tickets.list(),
      window.api.feedback.summary(30).catch(() => ({ total: 0, ratings: [], choices: [] })),
    ])
    setStats(s as any)

    const tix = tickets as any[]
    const today = new Date().toISOString().slice(0, 10)
    const todayTix = tix.filter((t) => t.createdAt?.startsWith(today))

    // Hourly buckets 0–23
    const buckets: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({ hour: h, issued: 0, served: 0 }))
    for (const t of todayTix) {
      const h = new Date(t.createdAt).getHours()
      buckets[h].issued++
      if (t.status === 'served') buckets[h].served++
    }
    setHourly(buckets)

    // Category performance
    const cp: CatPerf[] = categories.map((cat) => {
      const catTix = todayTix.filter((t) => t.categoryId === cat.id)
      const served = catTix.filter((t) => t.status === 'served')
      const waitMins = served
        .filter((t) => t.calledAt)
        .map((t) => Math.round((new Date(t.calledAt).getTime() - new Date(t.createdAt).getTime()) / 60_000))
      const avgWait = waitMins.length > 0 ? Math.round(waitMins.reduce((a, b) => a + b, 0) / waitMins.length) : 0
      return {
        code: cat.code,
        label: cat.label,
        color: cat.color,
        served: served.length,
        skipped: catTix.filter((t) => t.status === 'skipped').length,
        waiting: catTix.filter((t) => t.status === 'waiting').length,
        avgWaitMin: avgWait,
      }
    })
    setCatPerf(cp)
    setFeedbackTotal((fbSummary as any).total ?? 0)
    setFeedbackRatings(((fbSummary as any).ratings ?? []) as FeedbackRating[])
    const ops = await window.api.stats.operatorPerformance(1).catch(() => [])
    setOpPerf(ops as OpPerf[])
    setRefreshedAt(new Date())
    setLoading(false)
  }

  useEffect(() => { load() }, [categories])

  const total = stats.served + stats.skipped
  const serveRate = total > 0 ? Math.round((stats.served / total) * 100) : 0
  const maxHourly = Math.max(...hourly.map((b) => b.issued), 1)

  // Only show hours 06:00–22:00 for cleaner chart
  const chartHours = hourly.filter((b) => b.hour >= 6 && b.hour <= 22)
  const currentHour = new Date().getHours()

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0f] text-zinc-50 overflow-hidden">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => setPage('operator')}
            className="p-2 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-base font-bold text-zinc-100">Analytics</h1>
            <p className="text-xs text-zinc-500">
              Today · refreshed {minutesSince(refreshedAt.toISOString())}m ago
            </p>
          </div>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Served', value: stats.served, icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
            { label: 'Waiting', value: stats.waiting, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-400/10' },
            { label: 'Skipped', value: stats.skipped, icon: Users, color: 'text-zinc-400', bg: 'bg-zinc-400/10' },
            { label: 'Service Rate', value: `${serveRate}%`, icon: TrendingUp, color: 'text-primary-400', bg: 'bg-primary-400/10' },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-zinc-500">{kpi.label}</p>
                <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', kpi.bg)}>
                  <kpi.icon className={cn('w-3.5 h-3.5', kpi.color)} />
                </div>
              </div>
              <p className={cn('text-3xl font-extrabold', kpi.color)}>{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Hourly chart */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="flex items-center gap-2 mb-5">
            <BarChart2 className="w-4 h-4 text-zinc-500" />
            <h2 className="text-sm font-semibold text-zinc-100">Tickets Issued — Hourly</h2>
            <div className="ml-auto flex items-center gap-4 text-xs text-zinc-500">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary-500 inline-block" /> Issued</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Served</span>
            </div>
          </div>

          <div className="flex items-end gap-1 h-32">
            {chartHours.map((b) => {
              const isNow = b.hour === currentHour
              const issueH = Math.round((b.issued / maxHourly) * 100)
              const serveH = Math.round((b.served / maxHourly) * 100)
              return (
                <div key={b.hour} className="flex-1 flex flex-col items-center gap-1 group relative">
                  {/* Tooltip */}
                  {b.issued > 0 && (
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:flex bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 whitespace-nowrap z-10">
                      {b.issued} issued · {b.served} served
                    </div>
                  )}
                  <div className="w-full flex items-end gap-px" style={{ height: '100px' }}>
                    <div className={cn('flex-1 rounded-t-sm transition-all', isNow ? 'bg-primary-400' : 'bg-primary-600/60')}
                      style={{ height: `${issueH}%`, minHeight: b.issued > 0 ? '2px' : '0' }} />
                    <div className="flex-1 rounded-t-sm bg-emerald-600/70 transition-all"
                      style={{ height: `${serveH}%`, minHeight: b.served > 0 ? '2px' : '0' }} />
                  </div>
                  <p className={cn('text-[9px] tabular-nums', isNow ? 'text-primary-400 font-bold' : 'text-zinc-600')}>
                    {b.hour.toString().padStart(2, '0')}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Category performance */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-100">Performance by Category</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                {['Category', 'Served', 'Skipped', 'Waiting', 'Avg Wait', 'Rate'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {catPerf.map((cat) => {
                const catTotal = cat.served + cat.skipped
                const rate = catTotal > 0 ? Math.round((cat.served / catTotal) * 100) : 0
                return (
                  <tr key={cat.code} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                        <div>
                          <p className="text-zinc-100 font-medium text-xs">{cat.label}</p>
                          <p className="text-zinc-600 text-xs">{cat.code}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-emerald-400 font-semibold">{cat.served}</td>
                    <td className="px-5 py-3.5 text-zinc-500">{cat.skipped}</td>
                    <td className="px-5 py-3.5 text-amber-400">{cat.waiting}</td>
                    <td className="px-5 py-3.5 text-zinc-300">
                      {cat.avgWaitMin > 0 ? `${cat.avgWaitMin}m` : '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${rate}%` }} />
                        </div>
                        <span className="text-xs text-zinc-400 w-8">{rate}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {catPerf.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-zinc-600 text-sm">
                    {loading ? 'Loading...' : 'No data yet today'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Operator Performance */}
        {opPerf.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-zinc-500" />
              <h2 className="text-sm font-semibold text-zinc-100">Operator Performance — Today</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  {['Operator', 'Served', 'Skipped', 'No-show', 'Avg Service', 'Rate'].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {opPerf.map((op) => {
                  const rate = op.served + op.skipped > 0 ? Math.round((op.served / (op.served + op.skipped)) * 100) : 0
                  const avgMin = op.avgServiceSeconds ? Math.round(op.avgServiceSeconds / 60) : null
                  const avgSec = op.avgServiceSeconds ? op.avgServiceSeconds % 60 : null
                  return (
                    <tr key={op.operatorName + op.windowId} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="text-zinc-100 font-medium text-xs">{op.operatorName}</p>
                        <p className="text-zinc-600 text-xs">{op.windowId}</p>
                      </td>
                      <td className="px-5 py-3.5 text-emerald-400 font-semibold">{op.served}</td>
                      <td className="px-5 py-3.5 text-zinc-500">{op.skipped}</td>
                      <td className="px-5 py-3.5 text-zinc-600">{op.noShow}</td>
                      <td className="px-5 py-3.5 text-zinc-300 text-xs">
                        {avgMin !== null && avgSec !== null
                          ? `${avgMin}m ${String(avgSec).padStart(2, '0')}s`
                          : '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-14 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${rate}%` }} />
                          </div>
                          <span className="text-xs text-zinc-400 w-8">{rate}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Feedback / Maoni summary */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="flex items-center gap-2 mb-5">
            <Star className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Customer Feedback — Last 30 Days</h2>
            <span className="flex items-center gap-1.5 text-xs text-zinc-500 ml-4">
              <MessageSquare className="w-3.5 h-3.5" />
              {feedbackTotal} {feedbackTotal === 1 ? 'response' : 'responses'}
            </span>
            <button
              onClick={() => setPage('feedback-report')}
              className="ml-auto flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 transition-colors font-medium"
            >
              Full Report <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {feedbackTotal === 0 ? (
            <p className="text-center text-zinc-600 text-sm py-6">
              {loading ? 'Loading...' : 'No feedback responses yet. Configure questions in Settings → Feedback.'}
            </p>
          ) : (
            <div className="space-y-5">
              {feedbackRatings.map((r) => {
                const pct = ((r.average - 1) / 4) * 100  // 1–5 scale → 0–100%
                const color = r.average >= 4 ? 'bg-emerald-500' : r.average >= 3 ? 'bg-amber-500' : 'bg-red-500'
                return (
                  <div key={r.questionId}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm text-zinc-300 truncate flex-1 mr-4">{r.question}</p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-lg font-bold text-zinc-100">{r.average.toFixed(1)}</span>
                        <span className="text-xs text-zinc-500">/ 5</span>
                        <span className="text-xs text-zinc-600 ml-1">({r.count})</span>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
                    </div>
                    {/* Star display */}
                    <div className="flex items-center gap-0.5 mt-1">
                      {[1, 2, 3, 4, 5].map(s => (
                        <span key={s} className={cn('text-xs', s <= Math.round(r.average) ? 'text-amber-400' : 'text-zinc-700')}>★</span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
