'use client'
import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import Sidebar from '@/components/Sidebar'
import { apiFetch, formatTZS, formatDate } from '@/lib/utils'
import {
  Plus, Loader2, CheckCircle, Clock, AlertCircle, XCircle,
  RefreshCw, Receipt, ChevronDown, ChevronUp
} from 'lucide-react'

const fetcher = (url: string) => apiFetch(url)

const STATUS_STYLE: Record<string, string> = {
  ACTIVE:   'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  TRIALING: 'text-amber-400  bg-amber-400/10  border-amber-400/20',
  PAST_DUE: 'text-red-400    bg-red-400/10    border-red-400/20',
  CANCELED: 'text-zinc-500   bg-zinc-500/10   border-zinc-500/20',
  UNPAID:   'text-red-400    bg-red-400/10    border-red-400/20',
  PAUSED:   'text-zinc-400   bg-zinc-400/10   border-zinc-400/20',
}
const STATUS_ICON: Record<string, React.ElementType> = {
  ACTIVE: CheckCircle, TRIALING: Clock, PAST_DUE: AlertCircle,
  CANCELED: XCircle, UNPAID: AlertCircle, PAUSED: Clock,
}

export default function SubscriptionsPage() {
  const { data: clients } = useSWR('/api/billing/clients', fetcher)
  const { data: plans }   = useSWR('/api/billing/plans/all', fetcher)

  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const [form, setForm] = useState({
    clientId: '',
    planId: '',
    status: 'TRIALING',
    currentPeriodStart: new Date().toISOString().slice(0, 10),
    currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    trialEndsAt: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
  })

  // Collect all subscriptions across clients
  const allSubs = (clients ?? []).flatMap((c: any) =>
    (c.subscriptions ?? []).map((s: any) => ({
      ...s,
      clientName: c.organizationName,
      clientEmail: c.contactEmail,
      clientId: c.id,
    }))
  ).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  async function handleCreate() {
    if (!form.clientId || !form.planId) { setError('Select a client and plan'); return }
    setSaving(true); setError('')
    try {
      await apiFetch('/api/billing/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          currentPeriodStart: new Date(form.currentPeriodStart).toISOString(),
          currentPeriodEnd:   new Date(form.currentPeriodEnd).toISOString(),
          trialEndsAt: form.status === 'TRIALING' ? new Date(form.trialEndsAt).toISOString() : undefined,
        }),
      })
      mutate('/api/billing/clients')
      setShowForm(false)
      setForm({
        clientId: '', planId: '', status: 'TRIALING',
        currentPeriodStart: new Date().toISOString().slice(0, 10),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        trialEndsAt: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      })
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create subscription')
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(subId: string, status: string) {
    await apiFetch(`/api/billing/subscriptions/${subId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
    mutate('/api/billing/clients')
  }

  async function createInvoice(sub: any) {
    const plan = (plans ?? []).find((p: any) => p.id === sub.planId)
    if (!plan) return
    await apiFetch('/api/billing/invoices', {
      method: 'POST',
      body: JSON.stringify({
        clientId: sub.clientId,
        subscriptionId: sub.id,
        amount: plan.price,
        currency: plan.currency,
        description: `${plan.name} — ${new Date().toLocaleDateString('en-TZ', { month: 'long', year: 'numeric' })}`,
        dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      }),
    })
    mutate('/api/billing/clients')
    alert('Invoice created successfully')
  }

  async function markInvoicePaid(invoiceId: string) {
    await apiFetch(`/api/billing/invoices/${invoiceId}/pay`, { method: 'POST' })
    mutate('/api/billing/clients')
  }

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <Sidebar />
      <main className="flex-1 p-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Subscriptions</h1>
            <p className="text-zinc-500 text-sm mt-1">
              {allSubs.length} subscription{allSubs.length !== 1 ? 's' : ''} ·{' '}
              {allSubs.filter((s: any) => s.status === 'ACTIVE').length} active
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            <Plus className="w-4 h-4" /> New Subscription
          </button>
        </div>

        {/* New subscription form */}
        {showForm && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 mb-6">
            <h2 className="text-sm font-semibold text-zinc-100 mb-4">Create Subscription</h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Client</label>
                <select value={form.clientId} onChange={(e) => setForm(f => ({ ...f, clientId: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500">
                  <option value="">Select client...</option>
                  {(clients ?? []).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.organizationName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Plan</label>
                <select value={form.planId} onChange={(e) => setForm(f => ({ ...f, planId: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500">
                  <option value="">Select plan...</option>
                  {(plans ?? []).filter((p: any) => p.isActive).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name} — {formatTZS(p.price)}/{p.interval === 'MONTHLY' ? 'mo' : 'yr'}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Status</label>
                <select value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500">
                  <option value="TRIALING">Trialing</option>
                  <option value="ACTIVE">Active</option>
                  <option value="PAUSED">Paused</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Period Start</label>
                <input type="date" value={form.currentPeriodStart} onChange={(e) => setForm(f => ({ ...f, currentPeriodStart: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Period End</label>
                <input type="date" value={form.currentPeriodEnd} onChange={(e) => setForm(f => ({ ...f, currentPeriodEnd: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              {form.status === 'TRIALING' && (
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Trial Ends</label>
                  <input type="date" value={form.trialEndsAt} onChange={(e) => setForm(f => ({ ...f, trialEndsAt: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
              )}
            </div>
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => setShowForm(false)}
                className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button onClick={handleCreate} disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white transition-colors">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Subscription
              </button>
            </div>
          </div>
        )}

        {/* Subscriptions list */}
        <div className="space-y-3">
          {allSubs.map((sub: any) => {
            const plan = (plans ?? []).find((p: any) => p.id === sub.planId)
            const StatusIcon = STATUS_ICON[sub.status] ?? Clock
            const isExpanded = expanded === sub.id
            const subInvoices = (clients ?? [])
              .find((c: any) => c.id === sub.clientId)
              ?.invoices?.filter((inv: any) => inv.subscriptionId === sub.id) ?? []

            return (
              <div key={sub.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
                {/* Row */}
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${STATUS_STYLE[sub.status] ?? STATUS_STYLE.CANCELED}`}>
                      <StatusIcon className="w-3 h-3" />
                      {sub.status.replace('_', ' ')}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-100 truncate">{sub.clientName}</p>
                      <p className="text-xs text-zinc-500 truncate">
                        {plan?.name ?? 'Unknown plan'} · {formatDate(sub.currentPeriodStart)} → {formatDate(sub.currentPeriodEnd)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    {plan && <p className="text-sm font-semibold text-zinc-300">{formatTZS(plan.price)}</p>}

                    {/* Quick status change */}
                    <select
                      value={sub.status}
                      onChange={(e) => updateStatus(sub.id, e.target.value)}
                      className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-2 py-1.5 text-xs text-zinc-300 focus:outline-none"
                    >
                      {['TRIALING','ACTIVE','PAST_DUE','PAUSED','CANCELED'].map(s => (
                        <option key={s} value={s}>{s.replace('_',' ')}</option>
                      ))}
                    </select>

                    <button onClick={() => createInvoice(sub)} title="Issue invoice"
                      className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors">
                      <Receipt className="w-3.5 h-3.5" />
                    </button>

                    <button onClick={() => setExpanded(isExpanded ? null : sub.id)}
                      className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Expanded: invoices */}
                {isExpanded && (
                  <div className="border-t border-zinc-800 px-5 py-4 bg-zinc-900/30">
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Invoices</p>
                    {subInvoices.length === 0 ? (
                      <p className="text-xs text-zinc-600 py-2">No invoices yet. Click the receipt icon to issue one.</p>
                    ) : (
                      <div className="space-y-2">
                        {subInvoices.map((inv: any) => (
                          <div key={inv.id} className="flex items-center justify-between rounded-lg border border-zinc-800 px-4 py-2.5">
                            <div>
                              <p className="text-xs font-medium text-zinc-200">{inv.description}</p>
                              <p className="text-xs text-zinc-600 mt-0.5">
                                Issued {formatDate(inv.issuedAt)} · Due {formatDate(inv.dueAt)}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <p className="text-sm font-semibold text-zinc-300">{formatTZS(inv.amount)}</p>
                              {inv.status === 'OPEN' ? (
                                <button
                                  onClick={() => markInvoicePaid(inv.id)}
                                  className="flex items-center gap-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 px-2.5 py-1 text-xs font-medium text-emerald-400 transition-colors"
                                >
                                  <RefreshCw className="w-3 h-3" /> Mark Paid
                                </button>
                              ) : (
                                <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                                  inv.status === 'PAID' ? 'text-emerald-400 bg-emerald-400/10' : 'text-zinc-500 bg-zinc-800'
                                }`}>
                                  {inv.status}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {allSubs.length === 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 py-16 text-center">
              <p className="text-zinc-600 text-sm">No subscriptions yet</p>
              <p className="text-zinc-700 text-xs mt-1">Create a subscription to assign a plan to a client</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
