'use client'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/app'
import { useQueueStore } from '../../store/queue'
import type { QueueCategory, ServiceWindow } from '@announcement/shared'
import { cn, generateId } from '../../lib/utils'
import {
  ArrowLeft, Plus, Pencil, Trash2, Save, X, Loader2,
  Building2, Monitor, Layers, Printer, Volume2, AlertTriangle
} from 'lucide-react'

type Tab = 'org' | 'categories' | 'windows' | 'printer' | 'broadcast'

const COLORS = [
  '#4F46E5', '#0EA5E9', '#10B981', '#F59E0B',
  '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6',
  '#F97316', '#6366F1',
]

// ─── Category form ──────────────────────────────────────────────────────────

interface CatForm { id: string; code: string; label: string; color: string; prefix: string }
const emptyCat = (): CatForm => ({ id: generateId(), code: '', label: '', color: '#4F46E5', prefix: '' })

// ─── Window form ────────────────────────────────────────────────────────────

interface WinForm { id: string; number: number; label: string; operatorName: string }
const emptyWin = (number: number): WinForm => ({ id: generateId(), number, label: `Window ${number}`, operatorName: '' })

// ─── Main component ─────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { config, setConfig, setPage } = useAppStore()
  const { categories, windows, setCategories, setWindows } = useQueueStore()

  const [tab, setTab] = useState<Tab>('org')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // ── Org settings
  const [orgName, setOrgName] = useState(config?.organizationName ?? '')
  const [language, setLanguage] = useState(config?.language ?? 'en')

  // ── Category editing
  const [catForm, setCatForm] = useState<CatForm | null>(null)
  const [catError, setCatError] = useState('')

  // ── Window editing
  const [winForm, setWinForm] = useState<WinForm | null>(null)
  const [winError, setWinError] = useState('')

  // ── Printer
  const [printers, setPrinters] = useState<{ name: string; isDefault: boolean }[]>([])
  const [loadingPrinters, setLoadingPrinters] = useState(false)

  // ── Emergency broadcast
  const [broadcastText, setBroadcastText] = useState('')
  const [broadcasting, setBroadcasting] = useState(false)

  useEffect(() => {
    // Load fresh data
    Promise.all([window.api.categories.list(), window.api.windows.list()]).then(([cats, wins]) => {
      setCategories(cats as QueueCategory[])
      setWindows(wins as ServiceWindow[])
    })
  }, [])

  // ── Save org settings
  async function saveOrg() {
    if (!orgName.trim()) return
    setSaving(true)
    const updated = { ...(config as any), organizationName: orgName.trim(), language }
    await window.api.config.write({ isSetupComplete: true, installationConfig: updated })
    setConfig(updated)
    flashSaved()
  }

  function flashSaved() {
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // ── Category CRUD
  function openNewCat() { setCatError(''); setCatForm(emptyCat()) }
  function openEditCat(cat: QueueCategory) {
    setCatError('')
    setCatForm({ id: cat.id, code: cat.code, label: cat.label, color: cat.color, prefix: cat.prefix })
  }

  async function saveCat() {
    if (!catForm) return
    if (!catForm.code.trim()) { setCatError('Code is required'); return }
    if (!catForm.label.trim()) { setCatError('Label is required'); return }
    const isDupCode = categories.some((c) => c.code === catForm.code.trim().toUpperCase() && c.id !== catForm.id)
    if (isDupCode) { setCatError('Category code already exists'); return }

    const data: QueueCategory = {
      id: catForm.id,
      code: catForm.code.trim().toUpperCase(),
      label: catForm.label.trim(),
      color: catForm.color,
      prefix: catForm.prefix.trim(),
      windowIds: windows.map((w) => w.id),
    }
    await window.api.categories.upsert(data)
    const updated = categories.some((c) => c.id === data.id)
      ? categories.map((c) => c.id === data.id ? data : c)
      : [...categories, data]
    setCategories(updated)
    setCatForm(null)
  }

  async function deleteCat(id: string) {
    if (!confirm('Delete this category? Existing tickets will remain but no new ones can be issued.')) return
    // Soft delete: we don't have a delete API yet, so just remove from UI + overwrite with empty
    // For now filter from store — TODO: add categories:delete IPC
    setCategories(categories.filter((c) => c.id !== id))
  }

  // ── Window CRUD
  function openNewWin() { setWinError(''); setWinForm(emptyWin(windows.length + 1)) }
  function openEditWin(win: ServiceWindow) {
    setWinError('')
    setWinForm({ id: win.id, number: win.number, label: win.label, operatorName: win.operatorName ?? '' })
  }

  async function saveWin() {
    if (!winForm) return
    if (!winForm.label.trim()) { setWinError('Label is required'); return }

    const data = {
      id: winForm.id,
      number: winForm.number,
      label: winForm.label.trim(),
      operatorName: winForm.operatorName.trim() || undefined,
      isActive: true,
    }
    await window.api.windows.upsert(data)
    const updated = windows.some((w) => w.id === data.id)
      ? windows.map((w) => w.id === data.id ? data : w)
      : [...windows, data]
    setWindows(updated as ServiceWindow[])
    setWinForm(null)
  }

  // ── Printer
  async function loadPrinters() {
    setLoadingPrinters(true)
    const list = await window.api.print.listPrinters()
    setPrinters(list as { name: string; isDefault: boolean }[])
    setLoadingPrinters(false)
  }

  // ── Emergency broadcast
  async function sendBroadcast() {
    if (!broadcastText.trim()) return
    setBroadcasting(true)

    // Send to display window
    await window.api.display.send({
      type: 'broadcast',
      text: broadcastText.trim(),
      timestamp: new Date().toISOString(),
    })

    // Announce via TTS
    if ('speechSynthesis' in window) {
      const utt = new SpeechSynthesisUtterance(broadcastText.trim())
      utt.rate = 0.85
      speechSynthesis.cancel()
      speechSynthesis.speak(utt)
    }

    setBroadcasting(false)
    setBroadcastText('')
  }

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'org', label: 'Organization', icon: Building2 },
    { id: 'categories', label: 'Categories', icon: Layers },
    { id: 'windows', label: 'Windows', icon: Monitor },
    { id: 'printer', label: 'Printer', icon: Printer },
    { id: 'broadcast', label: 'Emergency', icon: AlertTriangle },
  ]

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-50">
      {/* Sidebar */}
      <aside className="w-56 border-r border-zinc-800 bg-zinc-900/50 flex flex-col">
        <div className="p-4 border-b border-zinc-800 flex items-center gap-2">
          <button onClick={() => setPage('operator')}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-zinc-100">Settings</span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={cn(
                'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors text-left',
                tab === id
                  ? 'bg-primary-600/20 text-primary-300'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              )}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">

        {/* ── Organization ──────────────────────────────────────────── */}
        {tab === 'org' && (
          <div className="max-w-lg">
            <h1 className="text-xl font-bold text-zinc-100 mb-6">Organization</h1>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Organization Name</label>
                <input value={orgName} onChange={(e) => setOrgName(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Language</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['en', 'sw', 'ar', 'fr'] as const).map((l) => (
                    <button key={l} onClick={() => setLanguage(l)}
                      className={cn(
                        'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                        language === l
                          ? 'border-primary-500 bg-primary-600/20 text-primary-300'
                          : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600'
                      )}>
                      {{ en: 'English', sw: 'Swahili', ar: 'Arabic', fr: 'French' }[l]}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={saveOrg} disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-5 py-2.5 text-sm font-semibold text-white transition-colors mt-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saved ? 'Saved!' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}

        {/* ── Categories ────────────────────────────────────────────── */}
        {tab === 'categories' && (
          <div className="max-w-2xl">
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-xl font-bold text-zinc-100">Categories / Departments</h1>
              <button onClick={openNewCat}
                className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition-colors">
                <Plus className="w-4 h-4" /> Add Category
              </button>
            </div>

            <div className="space-y-2">
              {categories.map((cat) => (
                <div key={cat.id} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black text-white"
                      style={{ backgroundColor: cat.color }}>
                      {cat.code.slice(0, 3)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-100">{cat.label}</p>
                      <p className="text-xs text-zinc-500">Code: {cat.code} · Prefix: "{cat.prefix || '—'}"</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => openEditCat(cat)}
                      className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteCat(cat.id)}
                      className="p-1.5 rounded-lg hover:bg-red-900/40 text-zinc-500 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {categories.length === 0 && (
                <p className="text-center text-zinc-600 py-10">No categories yet</p>
              )}
            </div>

            {/* Category form modal */}
            {catForm && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md">
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-base font-semibold text-zinc-100">
                      {categories.some((c) => c.id === catForm.id) ? 'Edit Category' : 'New Category'}
                    </h2>
                    <button onClick={() => setCatForm(null)} className="p-1 rounded hover:bg-zinc-800 text-zinc-500">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1">Code <span className="text-zinc-600">(e.g. OPD)</span></label>
                        <input value={catForm.code} onChange={(e) => setCatForm({ ...catForm, code: e.target.value.toUpperCase() })}
                          maxLength={6} placeholder="OPD"
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1">Prefix <span className="text-zinc-600">(on ticket)</span></label>
                        <input value={catForm.prefix} onChange={(e) => setCatForm({ ...catForm, prefix: e.target.value })}
                          maxLength={8} placeholder="OPD-"
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Label <span className="text-zinc-600">(full name)</span></label>
                      <input value={catForm.label} onChange={(e) => setCatForm({ ...catForm, label: e.target.value })}
                        placeholder="Outpatient Department"
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-2">Color</label>
                      <div className="flex flex-wrap gap-2">
                        {COLORS.map((c) => (
                          <button key={c} onClick={() => setCatForm({ ...catForm, color: c })}
                            className={cn('w-7 h-7 rounded-full transition-transform', catForm.color === c ? 'scale-125 ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : 'hover:scale-110')}
                            style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    </div>

                    {catError && <p className="text-xs text-red-400">{catError}</p>}

                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setCatForm(null)}
                        className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors">
                        Cancel
                      </button>
                      <button onClick={saveCat}
                        className="flex-1 rounded-lg bg-primary-600 hover:bg-primary-500 py-2 text-sm font-semibold text-white transition-colors">
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Windows ───────────────────────────────────────────────── */}
        {tab === 'windows' && (
          <div className="max-w-2xl">
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-xl font-bold text-zinc-100">Service Windows / Counters</h1>
              <button onClick={openNewWin}
                className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition-colors">
                <Plus className="w-4 h-4" /> Add Window
              </button>
            </div>

            <div className="space-y-2">
              {windows.map((win) => (
                <div key={win.id} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-200">
                      {win.number}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-100">{win.label}</p>
                      <p className="text-xs text-zinc-500">{win.operatorName ? `Operator: ${win.operatorName}` : 'No operator assigned'}</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => openEditWin(win)}
                      className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {windows.length === 0 && (
                <p className="text-center text-zinc-600 py-10">No windows configured</p>
              )}
            </div>

            {/* Window form modal */}
            {winForm && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm">
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-base font-semibold text-zinc-100">
                      {windows.some((w) => w.id === winForm.id) ? 'Edit Window' : 'New Window'}
                    </h2>
                    <button onClick={() => setWinForm(null)} className="p-1 rounded hover:bg-zinc-800 text-zinc-500">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Window Number</label>
                      <input type="number" min={1} value={winForm.number}
                        onChange={(e) => setWinForm({ ...winForm, number: parseInt(e.target.value) || 1 })}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Label</label>
                      <input value={winForm.label} onChange={(e) => setWinForm({ ...winForm, label: e.target.value })}
                        placeholder="Window 1 / Counter A / Room 3"
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Operator Name <span className="text-zinc-600">(optional)</span></label>
                      <input value={winForm.operatorName} onChange={(e) => setWinForm({ ...winForm, operatorName: e.target.value })}
                        placeholder="e.g. Dr. Amina"
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>

                    {winError && <p className="text-xs text-red-400">{winError}</p>}

                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setWinForm(null)}
                        className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors">
                        Cancel
                      </button>
                      <button onClick={saveWin}
                        className="flex-1 rounded-lg bg-primary-600 hover:bg-primary-500 py-2 text-sm font-semibold text-white transition-colors">
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Printer ───────────────────────────────────────────────── */}
        {tab === 'printer' && (
          <div className="max-w-lg">
            <h1 className="text-xl font-bold text-zinc-100 mb-2">Thermal Printer</h1>
            <p className="text-sm text-zinc-500 mb-6">
              Ticket slips print automatically when a ticket is issued. The system uses your Windows default printer.
              To change the printer, set it as default in Windows Settings → Printers.
            </p>

            <button onClick={loadPrinters} disabled={loadingPrinters}
              className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors mb-6">
              {loadingPrinters ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              Detect Printers
            </button>

            {printers.length > 0 && (
              <div className="space-y-2">
                {printers.map((p) => (
                  <div key={p.name}
                    className={cn(
                      'flex items-center justify-between rounded-xl border px-4 py-3',
                      p.isDefault ? 'border-emerald-500/40 bg-emerald-600/10' : 'border-zinc-800 bg-zinc-900/40'
                    )}>
                    <p className="text-sm text-zinc-100">{p.name}</p>
                    {p.isDefault && (
                      <span className="text-xs font-medium text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                        Default
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Emergency Broadcast ───────────────────────────────────── */}
        {tab === 'broadcast' && (
          <div className="max-w-lg">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-red-600/20 border border-red-500/30 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-red-400" />
              </div>
              <h1 className="text-xl font-bold text-zinc-100">Emergency Broadcast</h1>
            </div>
            <p className="text-sm text-zinc-500 mb-8">
              Message appears full-screen on the public display and is announced via speakers.
              Use for emergencies, evacuations, or important announcements.
            </p>

            <div className="rounded-xl border border-red-500/20 bg-red-600/5 p-5">
              <label className="block text-sm font-medium text-zinc-300 mb-2">Announcement Message</label>
              <textarea
                value={broadcastText}
                onChange={(e) => setBroadcastText(e.target.value)}
                placeholder="e.g. All patients please proceed to the main hall immediately."
                rows={4}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              />
              <button
                onClick={sendBroadcast}
                disabled={!broadcastText.trim() || broadcasting}
                className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-3 text-sm font-bold text-white transition-colors"
              >
                {broadcasting
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
                  : <><Volume2 className="w-4 h-4" /> Broadcast Now</>
                }
              </button>
            </div>

            <p className="text-xs text-zinc-600 mt-4">
              The display window must be open for the message to appear on screen.
            </p>
          </div>
        )}

      </div>
    </div>
  )
}
