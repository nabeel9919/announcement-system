'use client'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/app'
import { cn, formatTime } from '../../lib/utils'
import { ArrowLeft, Printer, RotateCcw, TrendingUp, Clock, Users, CheckCircle } from 'lucide-react'

interface DayStats {
  waiting: number
  called: number
  served: number
  skipped: number
}

interface CategoryStat {
  code: string
  label: string
  color: string
  waiting: number
  served: number
  skipped: number
}

export default function DaySummaryPage() {
  const { setPage, config } = useAppStore()
  const [stats, setStats] = useState<DayStats>({ waiting: 0, called: 0, served: 0, skipped: 0 })
  const [catStats, setCatStats] = useState<CategoryStat[]>([])
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    async function load() {
      const [s, cats, tickets] = await Promise.all([
        window.api.stats.today(),
        window.api.categories.list(),
        window.api.tickets.list(),
      ])
      setStats(s as DayStats)

      const cs = (cats as any[]).map((cat) => {
        const catTickets = (tickets as any[]).filter((t) => t.categoryId === cat.id)
        return {
          code: cat.code,
          label: cat.label,
          color: cat.color,
          waiting: catTickets.filter((t) => t.status === 'waiting').length,
          served: catTickets.filter((t) => t.status === 'served').length,
          skipped: catTickets.filter((t) => t.status === 'skipped').length,
        }
      })
      setCatStats(cs)
    }
    load()
  }, [])

  const total = stats.served + stats.skipped
  const serveRate = total > 0 ? Math.round((stats.served / total) * 100) : 0

  async function handleReset() {
    if (!confirm('Reset today\'s queue? All tickets will be cleared. This cannot be undone.')) return
    setResetting(true)
    try {
      await window.api.tickets.resetDay()
      setPage('operator')
    } finally {
      setResetting(false)
    }
  }

  async function printSummary() {
    const html = buildSummaryHtml({ stats, catStats, config, date: new Date() })
    await window.api.print.ticket({
      displayNumber: '—',
      categoryLabel: 'Day Summary',
      organizationName: config?.organizationName ?? 'Announcement System',
      issuedAt: new Date().toISOString(),
      windowCount: 1,
      _rawHtml: html,
    })
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-50 p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <button onClick={() => setPage('operator')}
            className="p-2 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-zinc-100">End of Day Summary</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              {config?.organizationName} · {new Date().toLocaleDateString('en-TZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={printSummary}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={handleReset} disabled={resetting}
            className="flex items-center gap-2 rounded-lg bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 transition-colors">
            <RotateCcw className="w-4 h-4" /> Reset Day
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Served', value: stats.served, icon: CheckCircle, color: 'text-emerald-400' },
          { label: 'Still Waiting', value: stats.waiting, icon: Clock, color: 'text-amber-400' },
          { label: 'Skipped', value: stats.skipped, icon: Users, color: 'text-zinc-400' },
          { label: 'Service Rate', value: `${serveRate}%`, icon: TrendingUp, color: 'text-primary-400' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-zinc-500">{s.label}</p>
              <s.icon className={`w-4 h-4 ${s.color}`} />
            </div>
            <p className={`text-3xl font-display font-extrabold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Category breakdown */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">By Category</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              {['Category', 'Served', 'Skipped', 'Still Waiting', 'Rate'].map((h) => (
                <th key={h} className="text-left px-6 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {catStats.map((cat) => {
              const catTotal = cat.served + cat.skipped
              const rate = catTotal > 0 ? Math.round((cat.served / catTotal) * 100) : 0
              return (
                <tr key={cat.code} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                      <div>
                        <p className="text-zinc-100 text-sm font-medium">{cat.label}</p>
                        <p className="text-zinc-600 text-xs">{cat.code}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-emerald-400 font-semibold">{cat.served}</td>
                  <td className="px-6 py-4 text-zinc-500">{cat.skipped}</td>
                  <td className="px-6 py-4 text-amber-400">{cat.waiting}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full max-w-20">
                        <div className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${rate}%` }} />
                      </div>
                      <span className="text-xs text-zinc-400">{rate}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
            {catStats.length === 0 && (
              <tr><td colSpan={5} className="text-center py-10 text-zinc-600 text-sm">No data for today</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function buildSummaryHtml({ stats, catStats, config, date }: any): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { font-family: 'Courier New', monospace; width: 76mm; padding: 4mm; font-size: 9pt; }
  h1 { font-size: 11pt; text-align: center; border-bottom: 1px dashed #000; padding-bottom: 2mm; margin-bottom: 2mm; }
  .row { display: flex; justify-content: space-between; margin: 1mm 0; }
  .total { font-weight: bold; border-top: 1px dashed #000; margin-top: 2mm; padding-top: 2mm; }
</style></head><body>
<h1>${config?.organizationName ?? 'Announcement System'}</h1>
<div class="row"><span>Date:</span><span>${date.toLocaleDateString()}</span></div>
<div class="row"><span>Time:</span><span>${formatTime(date)}</span></div>
<br/>
<div class="row"><span>Served:</span><span>${stats.served}</span></div>
<div class="row"><span>Skipped:</span><span>${stats.skipped}</span></div>
<div class="row"><span>Waiting:</span><span>${stats.waiting}</span></div>
<br/>
${catStats.map((c: any) => `<div class="row"><span>${c.code}:</span><span>${c.served} served</span></div>`).join('')}
<div class="row total"><span>TOTAL:</span><span>${stats.served + stats.skipped}</span></div>
</body></html>`
}
