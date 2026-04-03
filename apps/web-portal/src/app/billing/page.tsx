'use client'
import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import Sidebar from '@/components/Sidebar'
import { apiFetch, formatTZS } from '@/lib/utils'
import { Plus, Pencil, Trash2, Check, Star, Loader2 } from 'lucide-react'

const fetcher = (url: string) => apiFetch(url)

interface Plan {
  id: string
  name: string
  price: number
  currency: string
  interval: 'MONTHLY' | 'YEARLY'
  features: string[]
  maxWindows: number
  maxSites: number
  isActive: boolean
  isHighlighted: boolean
  yearlyDiscountPercent?: number
}

export default function BillingPage() {
  const { data: plans, isLoading } = useSWR<Plan[]>('/api/billing/plans/all', fetcher)
  const [editing, setEditing] = useState<Plan | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form state
  const [form, setForm] = useState({
    name: '', price: 30000, currency: 'TZS',
    interval: 'MONTHLY' as 'MONTHLY' | 'YEARLY',
    maxWindows: 4, maxSites: 1,
    features: 'Queue management\nTTS announcements\nDisplay screen\nEmail support',
    isHighlighted: false, yearlyDiscountPercent: 0,
  })

  function openEdit(plan: Plan) {
    setEditing(plan)
    setForm({
      name: plan.name,
      price: plan.price,
      currency: plan.currency,
      interval: plan.interval,
      maxWindows: plan.maxWindows,
      maxSites: plan.maxSites,
      features: plan.features.join('\n'),
      isHighlighted: plan.isHighlighted,
      yearlyDiscountPercent: plan.yearlyDiscountPercent ?? 0,
    })
    setShowNew(false)
  }

  async function handleSave() {
    setSaving(true)
    const payload = { ...form, features: form.features.split('\n').filter(Boolean) }
    try {
      if (editing) {
        await apiFetch(`/api/billing/plans/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await apiFetch('/api/billing/plans', { method: 'POST', body: JSON.stringify(payload) })
      }
      mutate('/api/billing/plans/all')
      setEditing(null)
      setShowNew(false)
    } catch (e: any) {
      alert(e?.message ?? 'Failed to save plan.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Deactivate this plan?')) return
    await apiFetch(`/api/billing/plans/${id}`, { method: 'DELETE' })
    mutate('/api/billing/plans/all')
  }

  const showForm = !!editing || showNew

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <Sidebar />
      <main className="flex-1 p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Billing & Plans</h1>
            <p className="text-zinc-500 text-sm mt-1">Edit pricing, features, and currency — changes apply immediately</p>
          </div>
          <button
            onClick={() => { setShowNew(true); setEditing(null) }}
            className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            <Plus className="w-4 h-4" /> New Plan
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {isLoading && <p className="text-zinc-500 col-span-3">Loading plans...</p>}
          {(plans ?? []).map((plan) => (
            <div
              key={plan.id}
              className={`relative rounded-2xl border p-6 ${
                plan.isHighlighted
                  ? 'border-primary-500 bg-primary-600/10'
                  : plan.isActive
                  ? 'border-zinc-800 bg-zinc-900/60'
                  : 'border-zinc-800/50 bg-zinc-900/30 opacity-50'
              }`}
            >
              {plan.isHighlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="flex items-center gap-1 bg-primary-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                    <Star className="w-3 h-3" /> Most Popular
                  </span>
                </div>
              )}

              <div className="mb-4">
                <p className="text-sm font-semibold text-zinc-100">{plan.name}</p>
                <p className="text-3xl font-display font-extrabold text-zinc-50 mt-2">
                  {plan.currency} {plan.price.toLocaleString()}
                </p>
                <p className="text-xs text-zinc-500">per {plan.interval === 'MONTHLY' ? 'month' : 'year'}</p>
              </div>

              <div className="space-y-1.5 mb-5">
                <p className="text-xs text-zinc-500">Up to {plan.maxWindows} windows · {plan.maxSites} site{plan.maxSites > 1 ? 's' : ''}</p>
                {plan.features.map((f) => (
                  <div key={f} className="flex items-center gap-2 text-xs text-zinc-400">
                    <Check className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                    {f}
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button onClick={() => openEdit(plan)} className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors">
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
                <button onClick={() => handleDelete(plan.id)} className="flex items-center justify-center rounded-lg border border-zinc-800 hover:border-red-500/50 hover:bg-red-500/10 px-3 py-2 text-zinc-500 hover:text-red-400 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Edit/Create form */}
        {showForm && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
            <h2 className="text-base font-semibold text-zinc-100 mb-5">{editing ? 'Edit Plan' : 'New Plan'}</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Plan Name</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Starter, Professional"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Price (TZS)</label>
                <input type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: +e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Billing Interval</label>
                <select value={form.interval} onChange={(e) => setForm((f) => ({ ...f, interval: e.target.value as any }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500">
                  <option value="MONTHLY">Monthly</option>
                  <option value="YEARLY">Yearly</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Currency</label>
                <select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500">
                  <option value="TZS">TZS — Tanzanian Shilling</option>
                  <option value="USD">USD — US Dollar</option>
                  <option value="KES">KES — Kenyan Shilling</option>
                  <option value="UGX">UGX — Ugandan Shilling</option>
                  <option value="EUR">EUR — Euro</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Max Windows</label>
                <input type="number" value={form.maxWindows} onChange={(e) => setForm((f) => ({ ...f, maxWindows: +e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Max Sites</label>
                <input type="number" value={form.maxSites} onChange={(e) => setForm((f) => ({ ...f, maxSites: +e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Features (one per line)</label>
              <textarea
                value={form.features}
                onChange={(e) => setForm((f) => ({ ...f, features: e.target.value }))}
                rows={5}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              />
            </div>

            <div className="flex items-center gap-4 mb-5">
              <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={form.isHighlighted} onChange={(e) => setForm((f) => ({ ...f, isHighlighted: e.target.checked }))} className="rounded" />
                Mark as "Most Popular"
              </label>
            </div>

            <div className="flex gap-3">
              <button onClick={() => { setEditing(null); setShowNew(false) }}
                className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Saving...' : 'Save Plan'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
