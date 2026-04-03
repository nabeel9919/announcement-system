'use client'
import useSWR from 'swr'
import Sidebar from '@/components/Sidebar'
import { apiFetch, formatTZS, formatDate } from '@/lib/utils'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { TrendingUp, Users, Key, CreditCard, Activity } from 'lucide-react'

const fetcher = (url: string) => apiFetch(url)

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6']

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string
  icon: React.ElementType; color: string
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-zinc-500">{label}</p>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <p className="text-2xl font-display font-bold text-zinc-100">{value}</p>
      {sub && <p className="text-xs text-zinc-600 mt-1">{sub}</p>}
    </div>
  )
}

export default function AnalyticsPage() {
  const { data: clients } = useSWR('/api/billing/clients', fetcher)
  const { data: invoices } = useSWR('/api/billing/invoices', fetcher)
  const { data: plans } = useSWR('/api/billing/plans/all', fetcher)

  // ── Derived metrics ──────────────────────────────────────────────────────────
  const totalClients = clients?.length ?? 0
  const activeClients = clients?.filter((c: any) => c.subscriptions?.[0]?.status === 'ACTIVE').length ?? 0
  const trialClients = clients?.filter((c: any) => c.subscriptions?.[0]?.status === 'TRIALING').length ?? 0

  const totalRevenue = (invoices ?? [])
    .filter((i: any) => i.status === 'PAID')
    .reduce((s: number, i: any) => s + i.amount, 0)

  const revenue30d = (invoices ?? [])
    .filter((i: any) => i.status === 'PAID' && new Date(i.paidAt) > new Date(Date.now() - 30 * 86400000))
    .reduce((s: number, i: any) => s + i.amount, 0)

  const totalLicenses = (clients ?? []).flatMap((c: any) => c.licenses ?? []).length
  const activeLicenses = (clients ?? [])
    .flatMap((c: any) => c.licenses ?? [])
    .filter((l: any) => !l.isRevoked && new Date(l.expiresAt) > new Date()).length

  // ── Chart data ───────────────────────────────────────────────────────────────

  // Revenue by month (last 6 months)
  const revenueByMonth = (() => {
    const months: Record<string, number> = {}
    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      months[d.toLocaleString('en', { month: 'short' })] = 0
    }
    ;(invoices ?? [])
      .filter((inv: any) => inv.status === 'PAID')
      .forEach((inv: any) => {
        const m = new Date(inv.paidAt).toLocaleString('en', { month: 'short' })
        if (m in months) months[m] += inv.amount
      })
    return Object.entries(months).map(([month, revenue]) => ({ month, revenue }))
  })()

  // Clients by sector
  const bySector = (() => {
    const counts: Record<string, number> = {}
    ;(clients ?? []).forEach((c: any) => {
      const s = c.sector ?? 'other'
      counts[s] = (counts[s] ?? 0) + 1
    })
    return Object.entries(counts).map(([name, value]) => ({ name, value }))
  })()

  // Subscription status breakdown
  const subStatus = (() => {
    const counts: Record<string, number> = { ACTIVE: 0, TRIALING: 0, PAST_DUE: 0, CANCELED: 0 }
    ;(clients ?? []).forEach((c: any) => {
      const s = c.subscriptions?.[0]?.status
      if (s && s in counts) counts[s]++
    })
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name: name.replace('_', ' '), value }))
  })()

  // Clients growth (cumulative by month)
  const clientGrowth = (() => {
    const months: Record<string, number> = {}
    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      months[d.toLocaleString('en', { month: 'short' })] = 0
    }
    ;(clients ?? []).forEach((c: any) => {
      const m = new Date(c.createdAt).toLocaleString('en', { month: 'short' })
      if (m in months) months[m]++
    })
    let cum = 0
    return Object.entries(months).map(([month, count]) => {
      cum += count
      return { month, clients: cum }
    })
  })()

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <Sidebar />
      <main className="flex-1 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-100">Analytics</h1>
          <p className="text-zinc-500 text-sm mt-1">Business performance and usage overview</p>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Clients" value={totalClients} sub={`${activeClients} active`} icon={Users} color="text-primary-400" />
          <StatCard label="Revenue (30d)" value={formatTZS(revenue30d)} sub={`${formatTZS(totalRevenue)} all-time`} icon={TrendingUp} color="text-emerald-400" />
          <StatCard label="Active Licenses" value={activeLicenses} sub={`${totalLicenses} total issued`} icon={Key} color="text-amber-400" />
          <StatCard label="On Trial" value={trialClients} sub="awaiting conversion" icon={Activity} color="text-blue-400" />
        </div>

        {/* Charts row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Revenue by month */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
            <h2 className="text-sm font-semibold text-zinc-100 mb-5">Revenue — Last 6 Months</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={revenueByMonth} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="month" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => [formatTZS(v), 'Revenue']}
                />
                <Bar dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Client growth */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
            <h2 className="text-sm font-semibold text-zinc-100 mb-5">Client Growth</h2>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={clientGrowth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="month" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }}
                />
                <Line type="monotone" dataKey="clients" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Charts row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Clients by sector */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
            <h2 className="text-sm font-semibold text-zinc-100 mb-5">Clients by Sector</h2>
            {bySector.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={bySector} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={{ stroke: '#52525b' }}>
                    {bySector.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[220px] text-zinc-600 text-sm">No data yet</div>
            )}
          </div>

          {/* Subscription status */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
            <h2 className="text-sm font-semibold text-zinc-100 mb-5">Subscription Status</h2>
            {subStatus.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={subStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85}>
                    {subStatus.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#a1a1aa' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[220px] text-zinc-600 text-sm">No subscriptions yet</div>
            )}
          </div>
        </div>

        {/* Recent invoices */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-100">Recent Invoices</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  {['Invoice', 'Client', 'Amount', 'Due', 'Status'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {(invoices ?? []).slice(0, 10).map((inv: any) => (
                  <tr key={inv.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">{inv.id.slice(0, 8).toUpperCase()}</td>
                    <td className="px-4 py-3 text-xs text-zinc-300">{inv.subscription?.client?.organizationName ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-zinc-300">{formatTZS(inv.amount)}</td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{formatDate(inv.dueAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                        inv.status === 'PAID' ? 'text-emerald-400 bg-emerald-400/10' :
                        inv.status === 'OPEN' ? 'text-amber-400 bg-amber-400/10' :
                        'text-red-400 bg-red-400/10'
                      }`}>{inv.status}</span>
                    </td>
                  </tr>
                ))}
                {!(invoices?.length) && (
                  <tr><td colSpan={5} className="text-center py-10 text-zinc-600 text-sm">No invoices yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
