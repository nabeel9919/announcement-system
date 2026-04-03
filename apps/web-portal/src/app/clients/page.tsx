'use client'
import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import Sidebar from '@/components/Sidebar'
import { apiFetch, formatDate } from '@/lib/utils'
import { Plus, Pencil, Trash2, X, Loader2, Building2, Mail, Phone, MapPin, Globe } from 'lucide-react'

const fetcher = (url: string) => apiFetch(url)

interface Client {
  id: string
  organizationName: string
  contactEmail: string
  contactPhone?: string
  city?: string
  country?: string
  sector?: string
  createdAt: string
  subscriptions?: { status: string; plan?: { name: string } }[]
  licenses?: { id: string; isRevoked: boolean; expiresAt: string }[]
}

const emptyForm = {
  organizationName: '',
  contactEmail: '',
  contactPhone: '',
  city: '',
  country: 'Tanzania',
  sector: 'hospital',
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'text-emerald-400 bg-emerald-400/10',
  TRIALING: 'text-amber-400 bg-amber-400/10',
  PAST_DUE: 'text-red-400 bg-red-400/10',
  CANCELED: 'text-zinc-500 bg-zinc-500/10',
}

const SECTORS = ['hospital', 'airport', 'bank', 'pharmacy', 'court', 'government', 'immigration', 'telecom', 'university', 'other']

export default function ClientsPage() {
  const { data: clients, isLoading } = useSWR<Client[]>('/api/billing/clients', fetcher)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [search, setSearch] = useState('')

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  function openEdit(client: Client) {
    setEditing(client)
    setForm({
      organizationName: client.organizationName,
      contactEmail: client.contactEmail,
      contactPhone: client.contactPhone ?? '',
      city: client.city ?? '',
      country: client.country ?? 'Tanzania',
      sector: client.sector ?? 'hospital',
    })
    setShowForm(true)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    try {
      if (editing) {
        await apiFetch(`/api/billing/clients/${editing.id}`, { method: 'PATCH', body: JSON.stringify(form) })
      } else {
        await apiFetch('/api/billing/clients', { method: 'POST', body: JSON.stringify(form) })
      }
      mutate('/api/billing/clients')
      setShowForm(false)
    } catch (e: any) {
      setSaveError(e?.message?.includes('409') || e?.message?.includes('500')
        ? 'A client with this email already exists.'
        : (e?.message ?? 'Failed to save. Check the license server is running.'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove client "${name}"? This will not delete their licenses.`)) return
    await apiFetch(`/api/billing/clients/${id}`, { method: 'DELETE' })
    mutate('/api/billing/clients')
  }

  const filtered = (clients ?? []).filter((c) =>
    c.organizationName.toLowerCase().includes(search.toLowerCase()) ||
    c.contactEmail.toLowerCase().includes(search.toLowerCase()) ||
    (c.city ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <Sidebar />
      <main className="flex-1 p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Clients</h1>
            <p className="text-zinc-500 text-sm mt-1">Manage organizations using the announcement system</p>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            <Plus className="w-4 h-4" /> New Client
          </button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or city..."
            className="w-full max-w-sm rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {/* Slide-in form */}
        {showForm && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 mb-8">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-zinc-100">{editing ? 'Edit Client' : 'New Client'}</h2>
              <button onClick={() => setShowForm(false)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-5">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Organization Name *</label>
                <input value={form.organizationName} onChange={(e) => setForm((f) => ({ ...f, organizationName: e.target.value }))}
                  placeholder="e.g. Muhimbili National Hospital"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Contact Email *</label>
                <input type="email" value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
                  placeholder="admin@organization.com"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Phone</label>
                <input value={form.contactPhone} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
                  placeholder="+255 7XX XXX XXX"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">City</label>
                <input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  placeholder="Dar es Salaam"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Country</label>
                <select value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500">
                  {['Tanzania', 'Kenya', 'Uganda', 'Rwanda', 'Ethiopia', 'Other'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Sector</label>
                <select value={form.sector} onChange={(e) => setForm((f) => ({ ...f, sector: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500">
                  {SECTORS.map((s) => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>

            {saveError && (
              <p className="text-sm text-red-400 mb-4">{saveError}</p>
            )}

            <div className="flex gap-3">
              <button onClick={() => setShowForm(false)}
                className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving || !form.organizationName || !form.contactEmail}
                className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Client'}
              </button>
            </div>
          </div>
        )}

        {/* Clients table */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-100">
              All Clients <span className="text-zinc-600 font-normal">({filtered.length})</span>
            </h2>
          </div>
          {isLoading && <p className="text-zinc-500 text-sm text-center py-12">Loading...</p>}
          <div className="divide-y divide-zinc-800">
            {filtered.map((client) => {
              const sub = client.subscriptions?.[0]
              const activeLicenses = (client.licenses ?? []).filter((l) => !l.isRevoked && new Date(l.expiresAt) > new Date()).length
              return (
                <div key={client.id} className="flex items-center justify-between px-6 py-4 hover:bg-zinc-800/30 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-4 h-4 text-zinc-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-100">{client.organizationName}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="flex items-center gap-1 text-xs text-zinc-500">
                          <Mail className="w-3 h-3" />{client.contactEmail}
                        </span>
                        {client.city && (
                          <span className="flex items-center gap-1 text-xs text-zinc-600">
                            <MapPin className="w-3 h-3" />{client.city}
                          </span>
                        )}
                        {client.sector && (
                          <span className="text-xs text-zinc-600 capitalize">{client.sector}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-xs text-zinc-500">{activeLicenses} active license{activeLicenses !== 1 ? 's' : ''}</p>
                      <p className="text-xs text-zinc-600 mt-0.5">Since {formatDate(client.createdAt)}</p>
                    </div>
                    {sub && (
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLORS[sub.status] ?? 'text-zinc-500 bg-zinc-800'}`}>
                        {sub.status.replace('_', ' ')}
                      </span>
                    )}
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(client)} title="Edit"
                        className="p-1.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(client.id, client.organizationName)} title="Remove"
                        className="p-1.5 rounded hover:bg-red-900/50 text-zinc-500 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
            {!isLoading && filtered.length === 0 && (
              <p className="text-sm text-zinc-600 text-center py-12">
                {search ? 'No clients match your search' : 'No clients yet — create your first one'}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
