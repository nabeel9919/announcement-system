'use client'
import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import Sidebar from '@/components/Sidebar'
import { apiFetch, formatDate } from '@/lib/utils'
import { Plus, Copy, ShieldOff, Shuffle, Check, Loader2, Key } from 'lucide-react'

const fetcher = (url: string) => apiFetch(url)

export default function LicensesPage() {
  const { data: clients } = useSWR('/api/billing/clients', fetcher)
  const [generating, setGenerating] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [form, setForm] = useState({
    clientId: '', tier: 'starter', maxWindows: 4, maxSites: 1,
    features: ['ticket_mode', 'card_mode', 'name_mode'],
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  })

  async function generateKey() {
    if (!form.clientId) return
    setGenerating(true)
    try {
      const { formattedKey } = await apiFetch('/api/licenses/generate', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          expiresAt: new Date(form.expiresAt).toISOString(),
          organizationName: clients?.find((c: any) => c.id === form.clientId)?.organizationName ?? '',
        }),
      })
      setNewKey(formattedKey)
      mutate('/api/billing/clients')
    } finally {
      setGenerating(false)
    }
  }

  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function revokeKey(key: string) {
    if (!confirm(`Revoke license key ${key}? The client will lose access.`)) return
    await apiFetch(`/api/licenses/${key.replace(/-/g, '')}/revoke`, { method: 'POST', body: JSON.stringify({ reason: 'Admin revoked' }) })
    mutate('/api/billing/clients')
  }

  async function transferKey(key: string) {
    if (!confirm(`Clear machine binding for ${key}? Client can activate on a new machine.`)) return
    await apiFetch(`/api/licenses/${key.replace(/-/g, '')}/transfer`, { method: 'POST' })
    alert('Machine binding cleared. Client can now activate on a new machine.')
  }

  const allLicenses = (clients ?? []).flatMap((c: any) =>
    (c.licenses ?? []).map((l: any) => ({ ...l, clientName: c.organizationName, clientEmail: c.contactEmail }))
  )

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <Sidebar />
      <main className="flex-1 p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Licenses</h1>
            <p className="text-zinc-500 text-sm mt-1">Generate and manage license keys</p>
          </div>
        </div>

        {/* Generate new key */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 mb-8">
          <h2 className="text-sm font-semibold text-zinc-100 mb-4 flex items-center gap-2">
            <Key className="w-4 h-4 text-primary-400" />
            Generate New License Key
          </h2>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Client</label>
              <select value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500">
                <option value="">Select client...</option>
                {(clients ?? []).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.organizationName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Tier</label>
              <select value={form.tier} onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500">
                <option value="starter">Starter</option>
                <option value="professional">Professional</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Max Windows</label>
              <input type="number" value={form.maxWindows} onChange={(e) => setForm((f) => ({ ...f, maxWindows: +e.target.value }))} min={1} max={100}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Expires</label>
              <input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={generateKey} disabled={generating || !form.clientId}
              className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-40 px-4 py-2.5 text-sm font-semibold text-white transition-colors">
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {generating ? 'Generating...' : 'Generate Key'}
            </button>

            {newKey && (
              <div className="flex items-center gap-2 bg-zinc-800 rounded-lg px-4 py-2.5 flex-1">
                <span className="font-mono text-sm text-primary-300 tracking-widest flex-1">{newKey}</span>
                <button onClick={() => copyKey(newKey)} className="text-zinc-400 hover:text-zinc-200 transition-colors">
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* License table */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-100">All License Keys</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  {['Key', 'Client', 'Tier', 'Windows', 'Expires', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {allLicenses.map((l: any) => (
                  <tr key={l.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-primary-300 tracking-wider">{l.formattedKey}</td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-100 text-xs font-medium">{l.clientName}</p>
                      <p className="text-zinc-600 text-xs">{l.clientEmail}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-300 capitalize">{l.tier.toLowerCase()}</td>
                    <td className="px-4 py-3 text-xs text-zinc-300">{l.maxWindows}</td>
                    <td className="px-4 py-3 text-xs text-zinc-400">{formatDate(l.expiresAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                        l.isRevoked
                          ? 'text-red-400 bg-red-400/10'
                          : new Date(l.expiresAt) < new Date()
                          ? 'text-zinc-500 bg-zinc-500/10'
                          : 'text-emerald-400 bg-emerald-400/10'
                      }`}>
                        {l.isRevoked ? 'Revoked' : new Date(l.expiresAt) < new Date() ? 'Expired' : 'Active'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => copyKey(l.formattedKey)} title="Copy key" className="p-1.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200 transition-colors">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => transferKey(l.formattedKey)} title="Transfer to new machine" className="p-1.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200 transition-colors">
                          <Shuffle className="w-3.5 h-3.5" />
                        </button>
                        {!l.isRevoked && (
                          <button onClick={() => revokeKey(l.formattedKey)} title="Revoke" className="p-1.5 rounded hover:bg-red-900/50 text-zinc-500 hover:text-red-400 transition-colors">
                            <ShieldOff className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {allLicenses.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-12 text-zinc-600 text-sm">No licenses yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
