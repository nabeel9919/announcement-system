'use client'
import useSWR from 'swr'
import Sidebar from '@/components/Sidebar'
import { apiFetch, formatTZS, formatDate } from '@/lib/utils'
import { Users, Key, CreditCard, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react'

const fetcher = (url: string) => apiFetch(url)

export default function DashboardPage() {
  const { data: clients } = useSWR('/api/billing/clients', fetcher)
  const { data: invoices } = useSWR('/api/billing/invoices', fetcher)

  const activeClients = clients?.filter((c: any) => c.subscriptions?.[0]?.status === 'ACTIVE').length ?? 0
  const trialClients = clients?.filter((c: any) => c.subscriptions?.[0]?.status === 'TRIALING').length ?? 0
  const overdueInvoices = invoices?.filter((i: any) => i.status === 'OPEN' && new Date(i.dueAt) < new Date()).length ?? 0
  const monthlyRevenue = invoices
    ?.filter((i: any) => i.status === 'PAID' && new Date(i.paidAt) > new Date(Date.now() - 30 * 86400000))
    .reduce((sum: number, i: any) => sum + i.amount, 0) ?? 0

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <Sidebar />
      <main className="flex-1 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-100">Dashboard</h1>
          <p className="text-zinc-500 text-sm mt-1">Overview of your announcement system business</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Active Clients', value: activeClients, icon: CheckCircle, color: 'text-emerald-400' },
            { label: 'On Trial', value: trialClients, icon: Users, color: 'text-amber-400' },
            { label: 'Overdue Invoices', value: overdueInvoices, icon: AlertCircle, color: 'text-red-400' },
            { label: 'Revenue (30d)', value: formatTZS(monthlyRevenue), icon: TrendingUp, color: 'text-primary-400' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-zinc-500">{stat.label}</p>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <p className="text-2xl font-display font-bold text-zinc-100">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Recent clients */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-100">Recent Clients</h2>
          </div>
          <div className="divide-y divide-zinc-800">
            {(clients ?? []).slice(0, 8).map((client: any) => {
              const sub = client.subscriptions?.[0]
              const statusColor: Record<string, string> = {
                ACTIVE: 'text-emerald-400 bg-emerald-400/10',
                TRIALING: 'text-amber-400 bg-amber-400/10',
                PAST_DUE: 'text-red-400 bg-red-400/10',
                CANCELED: 'text-zinc-500 bg-zinc-500/10',
              }
              return (
                <div key={client.id} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="text-sm font-medium text-zinc-100">{client.organizationName}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{client.contactEmail} · {client.city}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    {sub && (
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColor[sub.status] ?? 'text-zinc-500 bg-zinc-800'}`}>
                        {sub.status.replace('_', ' ')}
                      </span>
                    )}
                    <p className="text-xs text-zinc-600">{formatDate(client.createdAt)}</p>
                  </div>
                </div>
              )
            })}
            {!clients?.length && (
              <p className="text-sm text-zinc-600 text-center py-12">No clients yet</p>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
