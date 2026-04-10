'use client'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/app'
import { useQueueStore } from '../../store/queue'
import type { QueueCategory, ServiceWindow } from '@announcement/shared'
import { cn, generateId } from '../../lib/utils'
import {
  ArrowLeft, Plus, Pencil, Trash2, Save, X, Loader2,
  Building2, Monitor, Layers, Printer, Volume2, AlertTriangle, Globe, Music2,
  Film, GripVertical, FolderOpen, Users, Eye, EyeOff, ShieldCheck
} from 'lucide-react'
import { WebSpeechProvider, PiperProvider, buildAnnouncementText } from '@announcement/audio-engine'
import type { UserRole, SystemUser } from '@announcement/shared'

type Tab = 'org' | 'audio' | 'categories' | 'windows' | 'printer' | 'broadcast' | 'server' | 'media' | 'users'

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
  const { config, setConfig, setPage, settingsInitialTab, setSettingsInitialTab } = useAppStore()
  const { categories, windows, setCategories, setWindows } = useQueueStore()

  const [tab, setTab] = useState<Tab>((settingsInitialTab as Tab) ?? 'org')

  useEffect(() => {
    if (settingsInitialTab) setSettingsInitialTab(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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

  // ── Audio settings
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [audioVolume, setAudioVolume] = useState<number>(config?.volume ?? 1)
  const [audioRate, setAudioRate] = useState<number>(config?.rate ?? 0.9)
  const [audioPitch, setAudioPitch] = useState<number>(config?.pitch ?? 1)
  const [audioVoice, setAudioVoice] = useState<string>(config?.voiceName ?? '')
  const [audioSecondLang, setAudioSecondLang] = useState<string>(config?.secondLanguage ?? '')
  const [audioRecallSec, setAudioRecallSec] = useState<number>(config?.autoRecallAfterSeconds ?? 90)
  const [audioMaxRecalls, setAudioMaxRecalls] = useState<number>(config?.maxAutoRecalls ?? 2)
  const [audioProvider, setAudioProvider] = useState<string>((config as any)?.provider ?? 'web_speech')
  const [piperAvailable, setPiperAvailable] = useState<boolean | null>(null)
  const [audioSaving, setAudioSaving] = useState(false)
  const [audioSaved, setAudioSaved] = useState(false)
  const [testingAudio, setTestingAudio] = useState(false)

  // ── Printer
  const [printers, setPrinters] = useState<{ name: string; isDefault: boolean }[]>([])
  const [loadingPrinters, setLoadingPrinters] = useState(false)

  // ── Emergency broadcast
  const [broadcastText, setBroadcastText] = useState('')
  const [broadcasting, setBroadcasting] = useState(false)

  // ── Server URL
  const [serverUrl, setServerUrl] = useState('')
  const [serverUrlSaving, setServerUrlSaving] = useState(false)
  const [serverUrlSaved, setServerUrlSaved] = useState(false)
  const [serverTestResult, setServerTestResult] = useState<'ok' | 'fail' | null>(null)
  const [serverTesting, setServerTesting] = useState(false)

  // ── Media / Videos
  const [videos, setVideos] = useState<{ name: string; fileUrl: string; size: number }[]>([])
  const [videosDir, setVideosDir] = useState('')
  const [videoAdding, setVideoAdding] = useState(false)

  useEffect(() => {
    Promise.all([
      window.api.categories.list(),
      window.api.windows.list(),
      window.api.config.getServerUrl(),
    ]).then(([cats, wins, url]) => {
      setCategories(cats as QueueCategory[])
      setWindows(wins as ServiceWindow[])
      setServerUrl(url as string)
    })
    // Load voices for audio tab
    WebSpeechProvider.getVoices().then(setVoices)
    // Check Piper availability
    PiperProvider.isAvailable('sw').then(setPiperAvailable)
    // Load video playlist
    window.api.videos.list().then(setVideos)
    window.api.videos.getDir().then(setVideosDir)
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

  // ── Audio
  async function saveAudio() {
    setAudioSaving(true)
    const updated = {
      ...(config as any),
      provider: audioProvider,
      volume: audioVolume,
      rate: audioRate,
      pitch: audioPitch,
      voiceName: audioVoice || undefined,
      secondLanguage: audioSecondLang || undefined,
      autoRecallAfterSeconds: audioRecallSec,
      maxAutoRecalls: audioMaxRecalls,
    }
    await window.api.config.write({ isSetupComplete: true, installationConfig: updated })
    setConfig(updated)
    setAudioSaving(false)
    setAudioSaved(true)
    setTimeout(() => setAudioSaved(false), 2500)
  }

  function testAudio() {
    setTestingAudio(true)
    const text = buildAnnouncementText({
      displayNumber: 'A-001',
      windowLabel: 'Window 1',
      language: config?.language === 'sw' ? 'sw-TZ' : config?.language === 'ar' ? 'ar-SA' : config?.language === 'fr' ? 'fr-FR' : 'en-US',
    })
    const utt = new SpeechSynthesisUtterance(text)
    utt.volume = audioVolume
    utt.rate = audioRate
    utt.pitch = audioPitch
    if (audioVoice) {
      const v = window.speechSynthesis.getVoices().find((v) => v.name === audioVoice)
      if (v) utt.voice = v
    }
    utt.onend = () => setTestingAudio(false)
    utt.onerror = () => setTestingAudio(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utt)
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

  async function saveServerUrl() {
    setServerUrlSaving(true)
    await window.api.config.setServerUrl(serverUrl.trim())
    setServerUrlSaving(false)
    setServerUrlSaved(true)
    setTimeout(() => setServerUrlSaved(false), 2500)
  }

  async function testServerConnection() {
    setServerTesting(true)
    setServerTestResult(null)
    try {
      const url = serverUrl.trim() || 'http://localhost:3001'
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) })
      setServerTestResult(res.ok ? 'ok' : 'fail')
    } catch {
      setServerTestResult('fail')
    } finally {
      setServerTesting(false)
    }
  }

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'org', label: 'Organization', icon: Building2 },
    { id: 'audio', label: 'Audio', icon: Music2 },
    { id: 'media', label: 'Media', icon: Film },
    { id: 'categories', label: 'Categories', icon: Layers },
    { id: 'windows', label: 'Windows', icon: Monitor },
    { id: 'users', label: 'Staff & Roles', icon: Users },
    { id: 'printer', label: 'Printer', icon: Printer },
    { id: 'broadcast', label: 'Emergency', icon: AlertTriangle },
    { id: 'server', label: 'Server', icon: Globe },
  ]

  return (
    <div className="flex h-screen bg-[#0a0a0f] text-zinc-50">
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

        {/* ── Audio ─────────────────────────────────────────────────── */}
        {tab === 'audio' && (
          <div className="max-w-lg">
            <h1 className="text-xl font-bold text-zinc-100 mb-1">Audio &amp; Announcements</h1>
            <p className="text-sm text-zinc-500 mb-6">Controls voice, volume, speed, and auto-recall behaviour.</p>

            <div className="space-y-6">

              {/* TTS Provider */}
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">TTS Engine</label>
                <div className="grid grid-cols-2 gap-3">
                  {/* Web Speech */}
                  <button
                    onClick={() => setAudioProvider('web_speech')}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-all',
                      audioProvider === 'web_speech'
                        ? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500/40'
                        : 'border-zinc-700 bg-zinc-800/40 hover:border-zinc-600'
                    )}
                  >
                    <div className="text-sm font-semibold text-zinc-100 mb-0.5">Web Speech</div>
                    <div className="text-xs text-zinc-500">Uses OS voices. Install Windows Swahili language pack for Zuri voice.</div>
                    <div className="mt-2 text-xs font-medium text-green-400">Always available</div>
                  </button>

                  {/* Piper */}
                  <button
                    onClick={() => setAudioProvider('piper')}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-all',
                      audioProvider === 'piper'
                        ? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500/40'
                        : 'border-zinc-700 bg-zinc-800/40 hover:border-zinc-600'
                    )}
                  >
                    <div className="text-sm font-semibold text-zinc-100 mb-0.5">Piper TTS</div>
                    <div className="text-xs text-zinc-500">Bundled neural voice. Best Swahili quality, no setup for clients.</div>
                    <div className={cn('mt-2 text-xs font-medium', piperAvailable === null ? 'text-zinc-500' : piperAvailable ? 'text-green-400' : 'text-amber-400')}>
                      {piperAvailable === null ? 'Checking…' : piperAvailable ? 'Ready' : 'Model not yet downloaded'}
                    </div>
                  </button>
                </div>
                {audioProvider === 'piper' && !piperAvailable && (
                  <p className="text-xs text-amber-400/80 mt-2">
                    Run <code className="bg-zinc-800 px-1 py-0.5 rounded text-amber-300">node scripts/download-piper.mjs</code> from the project root to download the model (~75 MB).
                  </p>
                )}
              </div>

              {/* Voice picker — only shown for Web Speech */}
              {audioProvider === 'web_speech' && <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Voice</label>
                <select
                  value={audioVoice}
                  onChange={(e) => setAudioVoice(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">— System default for selected language —</option>
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
                {voices.length === 0 && (
                  <p className="text-xs text-zinc-600 mt-1">No voices detected — your OS may need TTS voices installed.</p>
                )}
              </div>}

              {/* Second language */}
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  Second Language <span className="text-zinc-500 font-normal">(repeat each announcement in)</span>
                </label>
                <select
                  value={audioSecondLang}
                  onChange={(e) => setAudioSecondLang(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">— None (single language) —</option>
                  <option value="en-US">English</option>
                  <option value="sw-TZ">Swahili</option>
                  <option value="ar-SA">Arabic</option>
                  <option value="fr-FR">French</option>
                </select>
              </div>

              {/* Volume */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-zinc-300">Volume</label>
                  <span className="text-xs text-zinc-400 tabular-nums">{Math.round(audioVolume * 100)}%</span>
                </div>
                <input type="range" min={0} max={1} step={0.05} value={audioVolume}
                  onChange={(e) => setAudioVolume(parseFloat(e.target.value))}
                  className="w-full accent-primary-500" />
              </div>

              {/* Rate */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-zinc-300">Speed</label>
                  <span className="text-xs text-zinc-400 tabular-nums">{audioRate.toFixed(2)}×</span>
                </div>
                <input type="range" min={0.5} max={1.5} step={0.05} value={audioRate}
                  onChange={(e) => setAudioRate(parseFloat(e.target.value))}
                  className="w-full accent-primary-500" />
                <div className="flex justify-between text-xs text-zinc-600 mt-1">
                  <span>Slower</span><span>Normal</span><span>Faster</span>
                </div>
              </div>

              {/* Pitch */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-zinc-300">Pitch</label>
                  <span className="text-xs text-zinc-400 tabular-nums">{audioPitch.toFixed(1)}</span>
                </div>
                <input type="range" min={0.5} max={1.5} step={0.1} value={audioPitch}
                  onChange={(e) => setAudioPitch(parseFloat(e.target.value))}
                  className="w-full accent-primary-500" />
                <div className="flex justify-between text-xs text-zinc-600 mt-1">
                  <span>Lower</span><span>Normal</span><span>Higher</span>
                </div>
              </div>

              {/* Auto-recall */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-4">
                <p className="text-sm font-semibold text-zinc-200">Auto-recall Settings</p>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm text-zinc-300">Recall after</label>
                    <span className="text-xs text-zinc-400 tabular-nums">
                      {audioRecallSec === 0 ? 'Disabled' : `${audioRecallSec}s`}
                    </span>
                  </div>
                  <input type="range" min={0} max={300} step={15} value={audioRecallSec}
                    onChange={(e) => setAudioRecallSec(parseInt(e.target.value))}
                    className="w-full accent-primary-500" />
                  <p className="text-xs text-zinc-600 mt-1">
                    {audioRecallSec === 0
                      ? 'Auto-recall disabled — operator must recall manually'
                      : `If patient hasn't responded after ${audioRecallSec}s, announcement repeats automatically`}
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm text-zinc-300">Max auto-recalls</label>
                    <span className="text-xs text-zinc-400 tabular-nums">{audioMaxRecalls}×</span>
                  </div>
                  <input type="range" min={1} max={5} step={1} value={audioMaxRecalls}
                    onChange={(e) => setAudioMaxRecalls(parseInt(e.target.value))}
                    className="w-full accent-primary-500" />
                  <p className="text-xs text-zinc-600 mt-1">
                    After {audioMaxRecalls} auto-recall{audioMaxRecalls !== 1 ? 's' : ''}, ticket is marked as skipped
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-1">
                <button onClick={saveAudio} disabled={audioSaving}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-5 py-2.5 text-sm font-semibold text-white transition-colors">
                  {audioSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {audioSaved ? 'Saved!' : 'Save Audio Settings'}
                </button>
                <button onClick={testAudio} disabled={testingAudio}
                  className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors">
                  {testingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                  Test Voice
                </button>
              </div>

            </div>
          </div>
        )}

        {/* ── Media ─────────────────────────────────────────────────── */}
        {tab === 'media' && (
          <div className="max-w-xl">
            <h1 className="text-xl font-bold text-zinc-100 mb-1">Media Playlist</h1>
            <p className="text-sm text-zinc-500 mb-6">
              Videos loop on display TVs. Ticket announcements appear as a lower-third overlay without interrupting playback.
            </p>

            {/* Add button */}
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={async () => {
                  setVideoAdding(true)
                  const result = await window.api.videos.add()
                  if (result) setVideos(result)
                  setVideoAdding(false)
                }}
                disabled={videoAdding}
                className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
              >
                {videoAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Add Video
              </button>
              {videosDir && (
                <button
                  onClick={() => window.api.openExternal(`file://${videosDir}`)}
                  className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors"
                >
                  <FolderOpen className="w-4 h-4" />
                  Open Folder
                </button>
              )}
            </div>

            {/* Playlist */}
            {videos.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/30 p-12 text-center">
                <Film className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
                <p className="text-zinc-500 text-sm font-medium mb-1">No videos yet</p>
                <p className="text-zinc-600 text-xs">Add .mp4, .webm, or .mov files. They will loop on your display TVs.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {videos.map((video, i) => (
                  <div key={video.name}
                    className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
                    <GripVertical className="w-4 h-4 text-zinc-600 flex-shrink-0" />
                    <div className="w-8 h-8 rounded-lg bg-primary-600/20 border border-primary-600/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-primary-400 text-xs font-bold">{i + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-200 truncate">{video.name}</p>
                      <p className="text-xs text-zinc-600">{(video.size / 1_048_576).toFixed(1)} MB</p>
                    </div>
                    <button
                      onClick={async () => {
                        if (!confirm(`Remove "${video.name}" from playlist?`)) return
                        const result = await window.api.videos.delete(video.name)
                        setVideos(result)
                      }}
                      className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-zinc-600 mt-4">
              Supported formats: MP4, WebM, MOV, MKV, AVI. Videos play in order and loop automatically.
            </p>
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

        {/* ── Server Connection ─────────────────────────────────────── */}
        {tab === 'server' && (
          <div className="max-w-lg">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                <Globe className="w-4 h-4 text-zinc-400" />
              </div>
              <h1 className="text-xl font-bold text-zinc-100">License Server</h1>
            </div>
            <p className="text-sm text-zinc-500 mb-8">
              Point the app to your production license server (e.g. on Railway or Render).
              The app uses this URL for license validation and TTS proxy.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  License Server URL
                </label>
                <input
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="https://your-app.up.railway.app"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-zinc-600 mt-1.5">
                  Leave blank or use http://localhost:3001 for local development.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button onClick={saveServerUrl} disabled={serverUrlSaving}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-5 py-2.5 text-sm font-semibold text-white transition-colors">
                  {serverUrlSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {serverUrlSaved ? 'Saved!' : 'Save URL'}
                </button>
                <button onClick={testServerConnection} disabled={serverTesting}
                  className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors">
                  {serverTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                  Test Connection
                </button>
                {serverTestResult === 'ok' && (
                  <span className="text-xs text-emerald-400 font-medium">Server reachable</span>
                )}
                {serverTestResult === 'fail' && (
                  <span className="text-xs text-red-400 font-medium">Cannot reach server</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Staff & Roles ─────────────────────────────────────────────────── */}
        {tab === 'users' && <UsersTab />}

      </div>
    </div>
  )
}

// ─── Users / RBAC Tab ────────────────────────────────────────────────────────

interface UserForm {
  id: string
  username: string
  displayName: string
  role: UserRole
  password: string
  windowId: string
}

function emptyUserForm(): UserForm {
  return { id: crypto.randomUUID(), username: '', displayName: '', role: 'operator', password: '', windowId: '' }
}

function UsersTab() {
  const [users, setUsers] = useState<SystemUser[]>([])
  const [form, setForm] = useState<UserForm | null>(null)
  const [error, setError] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [windows, setWindows] = useState<{ id: string; label: string }[]>([])

  useEffect(() => {
    window.api.users.list().then((u) => setUsers(u as unknown as SystemUser[]))
    window.api.windows.list().then((w) => setWindows(w as any[]))
  }, [])

  async function save() {
    if (!form) return
    if (!form.username.trim()) { setError('Username is required'); return }
    if (!form.displayName.trim()) { setError('Display name is required'); return }
    const isNew = !users.some((u) => u.id === form.id)
    if (isNew && !form.password) { setError('Password is required for new users'); return }
    setError('')
    await window.api.users.upsert({
      id: form.id,
      username: form.username.trim(),
      displayName: form.displayName.trim(),
      role: form.role,
      password: form.password || undefined,
      windowId: form.windowId || undefined,
      isActive: true,
    })
    const updated = await window.api.users.list()
    setUsers(updated as unknown as SystemUser[])
    setForm(null)
  }

  async function deactivate(userId: string) {
    if (!confirm('Deactivate this user? They will not be able to sign in.')) return
    await window.api.users.delete(userId)
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, isActive: false } : u))
  }

  const ROLE_COLORS: Record<UserRole, string> = {
    admin: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    supervisor: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
    operator: 'text-zinc-400 bg-zinc-700/30 border-zinc-700',
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Staff & Roles</h2>
          <p className="text-sm text-zinc-500 mt-1">Manage who can access the system and what they can do.</p>
        </div>
        <button
          onClick={() => { setError(''); setForm(emptyUserForm()) }}
          className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          <Plus className="w-4 h-4" />Add User
        </button>
      </div>

      {/* Role legend */}
      <div className="grid grid-cols-3 gap-3">
        {([
          { role: 'operator' as UserRole, desc: 'Call, serve, recall tickets' },
          { role: 'supervisor' as UserRole, desc: '+ Analytics, broadcast, end-of-day' },
          { role: 'admin' as UserRole, desc: '+ Settings, users, day reset' },
        ]).map(({ role, desc }) => (
          <div key={role} className={cn('rounded-xl border p-3', ROLE_COLORS[role])}>
            <div className="flex items-center gap-1.5 mb-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="text-xs font-semibold capitalize">{role}</span>
            </div>
            <p className="text-[11px] opacity-70">{desc}</p>
          </div>
        ))}
      </div>

      {/* User list */}
      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className={cn('flex items-center gap-4 rounded-xl border bg-zinc-900/40 px-4 py-3', u.isActive ? 'border-zinc-800' : 'border-zinc-800/50 opacity-50')}>
            <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0', ROLE_COLORS[u.role])}>
              {u.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-zinc-100">{u.displayName}</p>
                <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize', ROLE_COLORS[u.role])}>
                  {u.role}
                </span>
                {!u.isActive && <span className="text-[10px] text-zinc-600 border border-zinc-700 px-2 py-0.5 rounded-full">Inactive</span>}
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">@{u.username}</p>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  setError('')
                  setForm({ id: u.id, username: u.username, displayName: u.displayName, role: u.role, password: '', windowId: u.windowId ?? '' })
                }}
                className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
                title="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              {u.isActive && (
                <button
                  onClick={() => deactivate(u.id)}
                  className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                  title="Deactivate"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <p className="text-sm text-zinc-600 text-center py-8">No users yet — add your first staff member above.</p>
        )}
      </div>

      {/* User form modal */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl space-y-4 mx-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-zinc-100">
                {users.some((u) => u.id === form.id) ? 'Edit User' : 'New User'}
              </h3>
              <button onClick={() => setForm(null)} className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-500">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">Display Name</label>
                <input
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  placeholder="e.g. John Mwangi"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">Username</label>
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s/g, '') })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-primary-500"
                  placeholder="e.g. john"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">
                  Password {users.some((u) => u.id === form.id) && <span className="normal-case text-zinc-600">(leave blank to keep current)</span>}
                </label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 pl-3 pr-9 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    placeholder="••••••••"
                  />
                  <button type="button" onClick={() => setShowPass((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400" tabIndex={-1}>
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="operator">Operator — call & serve tickets</option>
                  <option value="supervisor">Supervisor — + analytics & broadcast</option>
                  <option value="admin">Admin — full access</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">Default Window <span className="normal-case text-zinc-600">(optional)</span></label>
                <select
                  value={form.windowId}
                  onChange={(e) => setForm({ ...form, windowId: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">— None —</option>
                  {windows.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                </select>
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={() => setForm(null)} className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors">
                Cancel
              </button>
              <button onClick={save} className="flex-1 rounded-lg bg-primary-600 hover:bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition-colors">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
