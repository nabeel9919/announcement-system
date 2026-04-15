'use client'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/app'
import { useQueueStore } from '../../store/queue'
import type { QueueCategory, ServiceWindow } from '@announcement/shared'
import { cn, generateId } from '../../lib/utils'
import {
  ArrowLeft, Plus, Pencil, Trash2, Save, X, Loader2,
  Building2, Monitor, Layers, Printer, Volume2, AlertTriangle, Globe, Music2,
  Film, GripVertical, FolderOpen, Users, Eye, EyeOff, ShieldCheck,
  HelpCircle, ChevronUp, ChevronDown, ToggleLeft, ToggleRight, GitBranch,
  Star, MessageSquare
} from 'lucide-react'
import { WebSpeechProvider, PiperProvider, buildAnnouncementText } from '@announcement/audio-engine'
import type { UserRole, SystemUser, KioskQuestion, FeedbackQuestion } from '@announcement/shared'

type Tab = 'org' | 'audio' | 'categories' | 'windows' | 'printer' | 'broadcast' | 'server' | 'media' | 'users' | 'kiosk' | 'feedback'

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
  const [lanUrl, setLanUrl] = useState<string | null>(null)
  const [lanToken, setLanToken] = useState('')
  const [lanTokenCopied, setLanTokenCopied] = useState(false)

  // ── Media / Videos
  const [videos, setVideos] = useState<{ name: string; fileUrl: string; size: number }[]>([])
  const [videosDir, setVideosDir] = useState('')
  const [videoAdding, setVideoAdding] = useState(false)

  useEffect(() => {
    Promise.all([
      window.api.categories.list(),
      window.api.windows.list(),
      window.api.config.getServerUrl(),
      window.api.lan.getUrl(),
      window.api.lan.getToken(),
    ]).then(([cats, wins, url, lUrl, lToken]) => {
      setCategories(cats as QueueCategory[])
      setWindows(wins as ServiceWindow[])
      setServerUrl(url as string)
      setLanUrl(lUrl as string | null)
      setLanToken(lToken as string)
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
    { id: 'kiosk', label: 'Kiosk Flow', icon: HelpCircle },
    { id: 'feedback', label: 'Feedback', icon: Star },
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

            {/* ── LAN Panel Token ── */}
            <div className="mt-10 pt-8 border-t border-zinc-800">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4 text-zinc-400" />
                </div>
                <h2 className="text-base font-semibold text-zinc-100">LAN Operator Panel</h2>
              </div>
              <p className="text-sm text-zinc-500 mb-5">
                Staff open the panel at{' '}
                <span className="font-mono text-zinc-300">{lanUrl ?? 'http://&lt;your-ip&gt;:4000'}</span>{' '}
                in their browser. The token below authenticates their requests — share it only with authorised staff.
              </p>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">API Token</label>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={lanToken}
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-sm font-mono text-zinc-400 focus:outline-none select-all"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(lanToken)
                      setLanTokenCopied(true)
                      setTimeout(() => setLanTokenCopied(false), 2000)
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 px-3.5 py-2.5 text-sm font-medium text-zinc-300 transition-colors whitespace-nowrap"
                  >
                    {lanTokenCopied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-zinc-600 mt-1.5">
                  The token is generated once and stored locally. Restart the app to regenerate it.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Kiosk Flow ────────────────────────────────────────────────────── */}
        {tab === 'kiosk' && <KioskFlowTab />}

        {/* ── Feedback ──────────────────────────────────────────────────────── */}
        {tab === 'feedback' && <FeedbackTab />}

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

// ─── Kiosk Flow Tab ──────────────────────────────────────────────────────────

function emptyQuestion(orderIndex: number): KioskQuestion {
  return {
    id: crypto.randomUUID(),
    categoryId: null,
    question: '',
    type: 'single',
    options: [{ id: crypto.randomUUID(), label: '' }],
    orderIndex,
    isEnabled: true,
    dependsOnQuestionId: null,
    dependsOnOptionId: null,
    createdAt: new Date().toISOString(),
  }
}

interface IdleStep { icon: string; title: string; subtitle: string }
interface IdleConfig {
  enabled: boolean
  timeoutSeconds: number
  welcomeMessage: string
  tagline: string
  steps: IdleStep[]
}

const IDLE_TIMEOUTS = [15, 30, 45, 60, 120]

function KioskFlowTab() {
  const [questions, setQuestions] = useState<KioskQuestion[]>([])
  const [categories, setCategories] = useState<{ id: string; label: string; code: string }[]>([])
  const [editing, setEditing] = useState<KioskQuestion | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Idle screen config
  const [idleCfg, setIdleCfg] = useState<IdleConfig>({
    enabled: true, timeoutSeconds: 45,
    welcomeMessage: 'Karibu!',
    tagline: 'Ujihudumie Mwenyewe • Self Service',
    steps: [
      { icon: '📋', title: 'Chagua Huduma', subtitle: 'Select your service' },
      { icon: '🎫', title: 'Pokea Tiketi', subtitle: 'Get your ticket' },
      { icon: '⏳', title: 'Subiri Kuitwa', subtitle: 'Wait to be called' },
    ],
  })
  const [idleSaving, setIdleSaving] = useState(false)
  const [idleSaved, setIdleSaved] = useState(false)

  useEffect(() => {
    window.api.kioskQuestions.listAll().then((qs) => setQuestions(qs as KioskQuestion[]))
    window.api.categories.list().then((cs: any) => setCategories(cs))
    window.api.kioskIdleConfig.get().then((cfg) => { if (cfg) setIdleCfg(cfg as IdleConfig) })
  }, [])

  async function saveIdleConfig() {
    setIdleSaving(true)
    await window.api.kioskIdleConfig.set(idleCfg)
    setIdleSaving(false)
    setIdleSaved(true)
    setTimeout(() => setIdleSaved(false), 2000)
  }

  function updateStep(i: number, field: keyof IdleStep, val: string) {
    const steps = idleCfg.steps.map((s, j) => j === i ? { ...s, [field]: val } : s)
    setIdleCfg({ ...idleCfg, steps })
  }

  async function saveQuestion() {
    if (!editing) return
    if (!editing.question.trim()) { setError('Question text is required'); return }
    if (editing.type === 'single' && editing.options.filter(o => o.label.trim()).length === 0) {
      setError('Add at least one option'); return
    }
    setError('')
    setSaving(true)
    try {
      const cleaned: KioskQuestion = {
        ...editing,
        options: editing.type === 'single'
          ? editing.options.filter(o => o.label.trim())
          : [],
      }
      const saved = await window.api.kioskQuestions.upsert(cleaned) as KioskQuestion
      setQuestions(prev => {
        const idx = prev.findIndex(q => q.id === saved.id)
        return idx >= 0 ? prev.map(q => q.id === saved.id ? saved : q) : [...prev, saved]
      })
      setEditing(null)
    } finally {
      setSaving(false)
    }
  }

  async function deleteQuestion(id: string) {
    if (!confirm('Delete this question?')) return
    await window.api.kioskQuestions.delete(id)
    setQuestions(prev => prev.filter(q => q.id !== id))
  }

  async function toggleEnabled(q: KioskQuestion) {
    const updated = { ...q, isEnabled: !q.isEnabled }
    await window.api.kioskQuestions.upsert(updated)
    setQuestions(prev => prev.map(x => x.id === q.id ? updated : x))
  }

  async function move(id: string, dir: 'up' | 'down') {
    const idx = questions.findIndex(q => q.id === id)
    if (dir === 'up' && idx === 0) return
    if (dir === 'down' && idx === questions.length - 1) return
    const next = [...questions]
    const swap = dir === 'up' ? idx - 1 : idx + 1
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    const reindexed = next.map((q, i) => ({ ...q, orderIndex: i }))
    setQuestions(reindexed)
    await window.api.kioskQuestions.reorder(reindexed.map(q => q.id))
  }

  function addOption() {
    if (!editing) return
    setEditing({ ...editing, options: [...editing.options, { id: crypto.randomUUID(), label: '' }] })
  }

  function updateOption(optId: string, label: string) {
    if (!editing) return
    setEditing({ ...editing, options: editing.options.map(o => o.id === optId ? { ...o, label } : o) })
  }

  function updateOptionWindow(optId: string, windowId: string) {
    if (!editing) return
    setEditing({ ...editing, options: editing.options.map(o => o.id === optId ? { ...o, routesToWindowId: windowId || undefined } : o) })
  }

  function removeOption(optId: string) {
    if (!editing) return
    setEditing({ ...editing, options: editing.options.filter(o => o.id !== optId) })
  }

  const categoryLabel = (id: string | null) =>
    id ? (categories.find(c => c.id === id)?.label ?? id) : 'All categories'

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Kiosk Flow</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Configure the questions asked before a ticket is issued. Answers print on the receipt.
          </p>
        </div>
        <button
          onClick={() => { setError(''); setEditing(emptyQuestion(questions.length)) }}
          className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Question
        </button>
      </div>

      {/* Question list */}
      {questions.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-700 py-16 text-center">
          <HelpCircle className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">No questions yet.</p>
          <p className="text-zinc-600 text-xs mt-1">Add a question to start building the kiosk flow.</p>
        </div>
      )}

      <div className="space-y-3">
        {questions.map((q, idx) => (
          <div
            key={q.id}
            className={cn(
              'rounded-xl border p-4 transition-colors',
              q.isEnabled ? 'border-zinc-700 bg-zinc-900/40' : 'border-zinc-800 bg-zinc-900/20 opacity-60'
            )}
          >
            <div className="flex items-start gap-3">
              {/* Order controls */}
              <div className="flex flex-col gap-0.5 mt-0.5">
                <button onClick={() => move(q.id, 'up')} disabled={idx === 0}
                  className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 transition-colors">
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => move(q.id, 'down')} disabled={idx === questions.length - 1}
                  className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 transition-colors">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-medium text-zinc-100 truncate">{q.question}</span>
                  <span className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded font-medium border',
                    q.type === 'single' ? 'text-blue-400 bg-blue-500/10 border-blue-500/30' : 'text-purple-400 bg-purple-500/10 border-purple-500/30'
                  )}>
                    {q.type === 'single' ? 'Choice' : 'Text'}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium border text-zinc-500 bg-zinc-800 border-zinc-700">
                    {categoryLabel(q.categoryId)}
                  </span>
                  {q.dependsOnQuestionId && (
                    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium border text-amber-400 bg-amber-500/10 border-amber-500/30">
                      <GitBranch className="w-2.5 h-2.5" /> Conditional
                    </span>
                  )}
                </div>
                {q.type === 'single' && q.options.length > 0 && (
                  <p className="text-xs text-zinc-500 truncate">
                    {q.options.map(o => o.label).join(' · ')}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => toggleEnabled(q)} className="text-zinc-500 hover:text-zinc-200 transition-colors" title={q.isEnabled ? 'Disable' : 'Enable'}>
                  {q.isEnabled ? <ToggleRight className="w-4 h-4 text-emerald-400" /> : <ToggleLeft className="w-4 h-4" />}
                </button>
                <button onClick={() => { setError(''); setEditing({ ...q }) }}
                  className="text-zinc-500 hover:text-zinc-200 transition-colors">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => deleteQuestion(q.id)}
                  className="text-zinc-500 hover:text-red-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Idle / Attract Screen Config ──────────────────────────────────── */}
      <div className="mt-10 pt-8 border-t border-zinc-800 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-zinc-100">Idle / Attract Screen</h3>
            <p className="text-sm text-zinc-500 mt-1">
              Shown when the kiosk is untouched. Guides customers on how to use it.
            </p>
          </div>
          {/* Enable toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div onClick={() => setIdleCfg({ ...idleCfg, enabled: !idleCfg.enabled })}
              className={cn('w-10 h-5 rounded-full flex items-center px-0.5 cursor-pointer transition-colors', idleCfg.enabled ? 'bg-primary-600' : 'bg-zinc-700')}>
              <div className={cn('w-4 h-4 rounded-full bg-white transition-transform', idleCfg.enabled ? 'translate-x-5' : 'translate-x-0')} />
            </div>
            <span className="text-sm text-zinc-400">{idleCfg.enabled ? 'On' : 'Off'}</span>
          </label>
        </div>

        {idleCfg.enabled && (
          <div className="space-y-4">
            {/* Timeout */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Show after</label>
              <div className="flex gap-2 flex-wrap">
                {IDLE_TIMEOUTS.map(s => (
                  <button key={s} onClick={() => setIdleCfg({ ...idleCfg, timeoutSeconds: s })}
                    className={cn('px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors',
                      idleCfg.timeoutSeconds === s
                        ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                        : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600'
                    )}>
                    {s < 60 ? `${s}s` : `${s / 60}min`}
                  </button>
                ))}
              </div>
            </div>

            {/* Welcome message */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Welcome Message</label>
                <input value={idleCfg.welcomeMessage} onChange={e => setIdleCfg({ ...idleCfg, welcomeMessage: e.target.value })}
                  placeholder="Karibu!"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Tagline</label>
                <input value={idleCfg.tagline} onChange={e => setIdleCfg({ ...idleCfg, tagline: e.target.value })}
                  placeholder="Ujihudumie Mwenyewe"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-primary-500" />
              </div>
            </div>

            {/* Steps */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Guide Steps</label>
              <div className="space-y-2">
                {idleCfg.steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={step.icon} onChange={e => updateStep(i, 'icon', e.target.value)}
                      className="w-12 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2 py-2 text-center text-lg focus:outline-none focus:ring-1 focus:ring-primary-500" />
                    <input value={step.title} onChange={e => updateStep(i, 'title', e.target.value)}
                      placeholder="Step title"
                      className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-primary-500" />
                    <input value={step.subtitle} onChange={e => updateStep(i, 'subtitle', e.target.value)}
                      placeholder="Subtitle / translation"
                      className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-400 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-primary-500" />
                    <button onClick={() => setIdleCfg({ ...idleCfg, steps: idleCfg.steps.filter((_, j) => j !== i) })}
                      className="text-zinc-600 hover:text-red-400 transition-colors flex-shrink-0"><X className="w-4 h-4" /></button>
                  </div>
                ))}
                {idleCfg.steps.length < 4 && (
                  <button onClick={() => setIdleCfg({ ...idleCfg, steps: [...idleCfg.steps, { icon: '✅', title: '', subtitle: '' }] })}
                    className="flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300 transition-colors">
                    <Plus className="w-3.5 h-3.5" /> Add step
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <button onClick={saveIdleConfig} disabled={idleSaving}
          className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-5 py-2.5 text-sm font-semibold text-white transition-colors">
          {idleSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {idleSaved ? 'Saved!' : 'Save Idle Settings'}
        </button>
      </div>

      {/* Edit / Create drawer */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-zinc-100">
                {questions.some(q => q.id === editing.id) ? 'Edit Question' : 'New Question'}
              </h3>
              <button onClick={() => setEditing(null)} className="text-zinc-500 hover:text-zinc-200"><X className="w-4 h-4" /></button>
            </div>

            {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

            {/* Question text */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Question</label>
              <input
                value={editing.question}
                onChange={e => setEditing({ ...editing, question: e.target.value })}
                placeholder="e.g. Which service would you like today?"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Answer Type</label>
              <div className="grid grid-cols-2 gap-3">
                {(['single', 'text'] as const).map(t => (
                  <button key={t} onClick={() => setEditing({ ...editing, type: t })}
                    className={cn(
                      'rounded-lg border py-2.5 text-sm font-medium transition-colors',
                      editing.type === t
                        ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                        : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600'
                    )}>
                    {t === 'single' ? '◉ Single Choice' : '⌨ Free Text'}
                  </button>
                ))}
              </div>
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Show For</label>
              <select
                value={editing.categoryId ?? ''}
                onChange={e => setEditing({ ...editing, categoryId: e.target.value || null })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="">All categories</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>

            {/* Conditional dependency */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">
                Show Only When (optional)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={editing.dependsOnQuestionId ?? ''}
                  onChange={e => setEditing({ ...editing, dependsOnQuestionId: e.target.value || null, dependsOnOptionId: null })}
                  className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">— Any —</option>
                  {questions.filter(q => q.id !== editing.id && q.type === 'single').map(q => (
                    <option key={q.id} value={q.id}>{q.question.slice(0, 40)}</option>
                  ))}
                </select>
                <select
                  value={editing.dependsOnOptionId ?? ''}
                  onChange={e => setEditing({ ...editing, dependsOnOptionId: e.target.value || null })}
                  disabled={!editing.dependsOnQuestionId}
                  className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-40"
                >
                  <option value="">— Any answer —</option>
                  {(questions.find(q => q.id === editing.dependsOnQuestionId)?.options ?? []).map(o => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-zinc-600 mt-1">Only show this question if a previous question was answered with a specific choice.</p>
            </div>

            {/* Options (for single choice) */}
            {editing.type === 'single' && (
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Options</label>
                <div className="space-y-2">
                  {editing.options.map((opt) => (
                    <div key={opt.id} className="flex gap-2 items-center">
                      <input
                        value={opt.label}
                        onChange={e => updateOption(opt.id, e.target.value)}
                        placeholder="Option label"
                        className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      />
                      <select
                        value={opt.routesToWindowId ?? ''}
                        onChange={e => updateOptionWindow(opt.id, e.target.value)}
                        title="Route to window (optional)"
                        className="w-32 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2 py-2 text-xs text-zinc-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      >
                        <option value="">No routing</option>
                        {/* Windows are not loaded here — user selects in the kiosk settings; this is a placeholder */}
                      </select>
                      <button onClick={() => removeOption(opt.id)} className="text-zinc-600 hover:text-red-400 transition-colors flex-shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button onClick={addOption}
                    className="flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300 transition-colors mt-1">
                    <Plus className="w-3.5 h-3.5" /> Add option
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setEditing(null)}
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button onClick={saveQuestion} disabled={saving}
                className="flex-1 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 py-2.5 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Feedback Tab ─────────────────────────────────────────────────────────────

const FEEDBACK_TYPES: { value: FeedbackQuestion['type']; label: string; desc: string }[] = [
  { value: 'star',   label: '★ Star Rating',  desc: '1–5 stars' },
  { value: 'emoji',  label: '😊 Emoji Rating', desc: '5 faces' },
  { value: 'choice', label: '◉ Choice',        desc: 'Tap an option' },
  { value: 'text',   label: '⌨ Free Text',     desc: 'Keyboard input' },
]

function emptyFeedbackQuestion(orderIndex: number): FeedbackQuestion {
  return {
    id: crypto.randomUUID(),
    question: '',
    type: 'star',
    options: [],
    orderIndex,
    isEnabled: true,
    isRequired: false,
    createdAt: new Date().toISOString(),
  }
}

function FeedbackTab() {
  const [questions, setQuestions] = useState<FeedbackQuestion[]>([])
  const [editing, setEditing] = useState<FeedbackQuestion | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.feedback.listAllQuestions().then((qs) => setQuestions(qs as FeedbackQuestion[]))
  }, [])

  async function saveQuestion() {
    if (!editing) return
    if (!editing.question.trim()) { setError('Question text is required'); return }
    if (editing.type === 'choice' && editing.options.filter((o: string) => o.trim()).length < 2) {
      setError('Add at least 2 options for a choice question'); return
    }
    setError('')
    setSaving(true)
    try {
      const cleaned = { ...editing, options: editing.options.filter((o: string) => o.trim()) }
      const saved = await window.api.feedback.upsertQuestion(cleaned) as FeedbackQuestion
      setQuestions(prev => {
        const idx = prev.findIndex(q => q.id === saved.id)
        return idx >= 0 ? prev.map(q => q.id === saved.id ? saved : q) : [...prev, saved]
      })
      setEditing(null)
    } finally {
      setSaving(false)
    }
  }

  async function deleteQ(id: string) {
    if (!confirm('Delete this feedback question?')) return
    await window.api.feedback.deleteQuestion(id)
    setQuestions(prev => prev.filter(q => q.id !== id))
  }

  async function toggleEnabled(q: FeedbackQuestion) {
    const updated = { ...q, isEnabled: !q.isEnabled }
    await window.api.feedback.upsertQuestion(updated)
    setQuestions(prev => prev.map(x => x.id === q.id ? updated : x))
  }

  async function move(id: string, dir: 'up' | 'down') {
    const idx = questions.findIndex(q => q.id === id)
    if (dir === 'up' && idx === 0) return
    if (dir === 'down' && idx === questions.length - 1) return
    const next = [...questions]
    const swap = dir === 'up' ? idx - 1 : idx + 1
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    const reindexed = next.map((q, i) => ({ ...q, orderIndex: i }))
    setQuestions(reindexed)
    await window.api.feedback.reorderQuestions(reindexed.map(q => q.id))
  }

  const typeInfo = (t: FeedbackQuestion['type']) => FEEDBACK_TYPES.find(x => x.value === t)

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Feedback / Maoni</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Configure customer satisfaction questions shown on the kiosk feedback screen.
          </p>
        </div>
        <button
          onClick={() => { setError(''); setEditing(emptyFeedbackQuestion(questions.length)) }}
          className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Question
        </button>
      </div>

      {questions.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-700 py-14 text-center">
          <Star className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">No feedback questions yet.</p>
          <p className="text-zinc-600 text-xs mt-1">Add questions like "How was your experience?" with star or emoji rating.</p>
        </div>
      )}

      <div className="space-y-3">
        {questions.map((q, idx) => (
          <div key={q.id} className={cn(
            'rounded-xl border p-4 transition-colors',
            q.isEnabled ? 'border-zinc-700 bg-zinc-900/40' : 'border-zinc-800 bg-zinc-900/20 opacity-60'
          )}>
            <div className="flex items-start gap-3">
              <div className="flex flex-col gap-0.5 mt-0.5">
                <button onClick={() => move(q.id, 'up')} disabled={idx === 0} className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 transition-colors">
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => move(q.id, 'down')} disabled={idx === questions.length - 1} className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 transition-colors">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-medium text-zinc-100 truncate">{q.question}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium border text-amber-400 bg-amber-500/10 border-amber-500/30">
                    {typeInfo(q.type)?.label}
                  </span>
                  {q.isRequired && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium border text-red-400 bg-red-500/10 border-red-500/20">Required</span>
                  )}
                </div>
                {q.type === 'choice' && q.options.length > 0 && (
                  <p className="text-xs text-zinc-500 truncate">{q.options.join(' · ')}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => toggleEnabled(q)} className="text-zinc-500 hover:text-zinc-200 transition-colors">
                  {q.isEnabled ? <ToggleRight className="w-4 h-4 text-emerald-400" /> : <ToggleLeft className="w-4 h-4" />}
                </button>
                <button onClick={() => { setError(''); setEditing({ ...q }) }} className="text-zinc-500 hover:text-zinc-200 transition-colors">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => deleteQ(q.id)} className="text-zinc-500 hover:text-red-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-zinc-100">
                {questions.some(q => q.id === editing.id) ? 'Edit Question' : 'New Feedback Question'}
              </h3>
              <button onClick={() => setEditing(null)} className="text-zinc-500 hover:text-zinc-200"><X className="w-4 h-4" /></button>
            </div>

            {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Question</label>
              <input
                value={editing.question}
                onChange={e => setEditing({ ...editing, question: e.target.value })}
                placeholder="e.g. How was your experience today?"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Answer Type</label>
              <div className="grid grid-cols-2 gap-2">
                {FEEDBACK_TYPES.map(t => (
                  <button key={t.value} onClick={() => setEditing({ ...editing, type: t.value, options: [] })}
                    className={cn(
                      'rounded-lg border py-2.5 px-3 text-left transition-colors',
                      editing.type === t.value
                        ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                        : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600'
                    )}>
                    <p className="text-sm font-medium">{t.label}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{t.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {editing.type === 'choice' && (
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Options</label>
                <div className="space-y-2">
                  {editing.options.map((opt: string, i: number) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={opt}
                        onChange={e => {
                          const opts = [...editing.options]
                          opts[i] = e.target.value
                          setEditing({ ...editing, options: opts })
                        }}
                        placeholder={`Option ${i + 1}`}
                        className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      />
                      <button onClick={() => setEditing({ ...editing, options: editing.options.filter((_: string, j: number) => j !== i) })}
                        className="text-zinc-600 hover:text-red-400 transition-colors"><X className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <button onClick={() => setEditing({ ...editing, options: [...editing.options, ''] })}
                    className="flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300 transition-colors">
                    <Plus className="w-3.5 h-3.5" /> Add option
                  </button>
                </div>
              </div>
            )}

            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div onClick={() => setEditing({ ...editing, isRequired: !editing.isRequired })}
                className={cn('w-10 h-5 rounded-full transition-colors flex items-center px-0.5 cursor-pointer',
                  editing.isRequired ? 'bg-primary-600' : 'bg-zinc-700'
                )}>
                <div className={cn('w-4 h-4 rounded-full bg-white transition-transform',
                  editing.isRequired ? 'translate-x-5' : 'translate-x-0'
                )} />
              </div>
              <span className="text-sm text-zinc-300">Required (cannot skip)</span>
            </label>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setEditing(null)}
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button onClick={saveQuestion} disabled={saving}
                className="flex-1 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 py-2.5 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
