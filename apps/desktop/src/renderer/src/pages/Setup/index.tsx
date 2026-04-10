import { useState } from 'react'
import { useAppStore } from '../../store/app'
import type { Sector, CallingMode, SupportedLanguage } from '@announcement/shared'
import { SECTOR_PRESETS, CALLING_MODES } from '@announcement/shared'
import { cn, generateId } from '../../lib/utils'
import { Check, ChevronRight, Building2, Mic, KeyRound, MonitorPlay, Loader2, Sparkles } from 'lucide-react'

type Step = 'license' | 'sector' | 'mode' | 'windows' | 'complete'

const STEPS: { id: Step; label: string; icon: React.ElementType }[] = [
  { id: 'license', label: 'Activation', icon: KeyRound },
  { id: 'sector', label: 'Sector', icon: Building2 },
  { id: 'mode', label: 'Calling Mode', icon: Mic },
  { id: 'windows', label: 'Windows', icon: MonitorPlay },
  { id: 'complete', label: 'Done', icon: Check },
]

export default function SetupPage() {
  const { setPage, setConfig, setSetupComplete } = useAppStore()

  const [step, setStep] = useState<Step>('license')
  const [licenseKey, setLicenseKey] = useState('')
  const [orgName, setOrgName] = useState('')
  const [serverUrl, setServerUrl] = useState('https://announcement-system-production.up.railway.app')
  const [licenseError, setLicenseError] = useState('')
  const [validating, setValidating] = useState(false)

  const [sector, setSector] = useState<Sector>('hospital')
  const [callingMode, setCallingMode] = useState<CallingMode>('hybrid')
  const [windowCount, setWindowCount] = useState(4)
  const [language, setLanguage] = useState<SupportedLanguage>('en')

  const currentStepIdx = STEPS.findIndex((s) => s.id === step)

  async function handleValidateLicense() {
    const normalized = licenseKey.replace(/[\s-]/g, '')
    if (normalized.length < 20) {
      setLicenseError('Please enter a valid 20-character license key')
      return
    }
    if (!orgName.trim()) {
      setLicenseError('Please enter your organization name')
      return
    }
    setValidating(true)
    setLicenseError('')

    try {
      await window.api.config.setServerUrl(serverUrl.trim())
      const result = await window.api.license.validate(licenseKey.trim())

      if (!result.valid) {
        setLicenseError(result.error ?? 'Invalid license key. Please check and try again.')
        setValidating(false)
        return
      }

      if (result.license?.organizationName) {
        setOrgName(result.license.organizationName)
      }

      setValidating(false)
      setStep('sector')
    } catch {
      setLicenseError('Cannot reach license server. Make sure it is running on port 3001.')
      setValidating(false)
    }
  }

  async function handleFinish() {
    const preset = SECTOR_PRESETS[sector]
    const categories = preset.defaultCategories.map((c) => ({ ...c, id: generateId() }))
    const windows = Array.from({ length: windowCount }, (_, i) => ({
      id: generateId(),
      number: i + 1,
      label: preset.defaultWindowLabels[i] ?? `Window ${i + 1}`,
      isActive: true,
    }))

    const installationConfig = {
      licenseKey: licenseKey.replace(/\s/g, '').toUpperCase(),
      organizationName: orgName,
      sector,
      callingMode,
      windowCount,
      language,
      displayScreenIndex: 1,
      categories,
    }

    await window.api.config.write({ isSetupComplete: true, installationConfig })

    for (const cat of categories) {
      await window.api.categories.upsert({
        id: cat.id,
        code: cat.code,
        label: cat.label,
        windowIds: windows.map((w) => w.id),
        color: cat.color,
        prefix: cat.prefix,
      })
    }
    for (const win of windows) {
      await window.api.windows.upsert(win)
    }

    setConfig(installationConfig)
    setSetupComplete(true)
    setStep('complete')
  }

  return (
    <div className="flex h-screen text-zinc-50" style={{ background: '#0a0a0f' }}>

      {/* Sidebar */}
      <div
        className="w-60 flex flex-col border-r border-zinc-800/60 flex-shrink-0"
        style={{ background: 'rgba(255,255,255,0.02)' }}
      >
        {/* Brand */}
        <div className="px-5 py-6 border-b border-zinc-800/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <MonitorPlay className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-zinc-100 leading-tight">Announcement</p>
              <p className="text-xs text-zinc-500 mt-0.5">System Setup</p>
            </div>
          </div>
        </div>

        {/* Steps nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {STEPS.map((s, idx) => {
            const isDone = idx < currentStepIdx
            const isCurrent = s.id === step
            return (
              <div
                key={s.id}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm',
                  isCurrent && 'bg-indigo-600/15 text-indigo-300',
                  isDone && 'text-zinc-400',
                  !isCurrent && !isDone && 'text-zinc-600'
                )}
              >
                <div
                  className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold',
                    isDone && 'bg-indigo-600 text-white',
                    isCurrent && 'ring-2 ring-indigo-500 text-indigo-400',
                    !isCurrent && !isDone && 'ring-1 ring-zinc-700 text-zinc-600'
                  )}
                >
                  {isDone ? <Check className="w-2.5 h-2.5" /> : idx + 1}
                </div>
                <span className={cn('font-medium', isCurrent && 'text-zinc-100', isDone && 'text-zinc-400')}>
                  {s.label}
                </span>
                {isCurrent && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-500" />
                )}
              </div>
            )
          })}
        </nav>

        <div className="px-5 py-4 border-t border-zinc-800/60">
          <p className="text-[11px] text-zinc-600">v1.0.0 — First-time setup</p>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-12 overflow-y-auto">
        <div className="w-full max-w-md">

          {/* Progress bar */}
          <div className="mb-8">
            <div className="flex justify-between text-xs text-zinc-600 mb-1.5">
              <span>Step {currentStepIdx + 1} of {STEPS.length}</span>
              <span>{Math.round(((currentStepIdx) / (STEPS.length - 1)) * 100)}%</span>
            </div>
            <div className="h-0.5 bg-zinc-800 rounded-full">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${(currentStepIdx / (STEPS.length - 1)) * 100}%` }}
              />
            </div>
          </div>

          {/* ── STEP: License ── */}
          {step === 'license' && (
            <div>
              <div className="mb-7">
                <h1 className="text-2xl font-bold text-zinc-50 mb-1.5">Activate Your License</h1>
                <p className="text-sm text-zinc-500">Enter your 20-character license key to get started.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
                    Organization Name
                  </label>
                  <input
                    type="text"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g. City Hospital, Julius Nyerere Airport"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
                    License Server URL
                  </label>
                  <input
                    type="text"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="https://your-server.up.railway.app"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
                    License Key
                  </label>
                  <input
                    type="text"
                    value={licenseKey}
                    onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                    placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                    maxLength={23}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5 text-sm font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 tracking-widest transition-colors"
                  />
                  {licenseError && (
                    <p className="mt-2 text-xs text-red-400 flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-red-400 flex-shrink-0" />
                      {licenseError}
                    </p>
                  )}
                </div>

                <button
                  onClick={handleValidateLicense}
                  disabled={validating}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors mt-2"
                >
                  {validating ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Validating...</>
                  ) : (
                    <>Activate License<ChevronRight className="w-4 h-4" /></>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: Sector ── */}
          {step === 'sector' && (
            <div>
              <div className="mb-7">
                <h1 className="text-2xl font-bold text-zinc-50 mb-1.5">Select Your Sector</h1>
                <p className="text-sm text-zinc-500">
                  Configures department names, window labels, and announcement templates.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2.5 mb-8">
                {Object.values(SECTOR_PRESETS).map((preset) => (
                  <button
                    key={preset.sector}
                    onClick={() => setSector(preset.sector)}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all',
                      sector === preset.sector
                        ? 'border-indigo-500 bg-indigo-600/15 text-indigo-300'
                        : 'border-zinc-800 bg-zinc-900/40 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300 hover:bg-zinc-900/60'
                    )}
                  >
                    <span className="text-2xl">{preset.icon}</span>
                    <span className={cn('text-xs font-semibold leading-tight', sector === preset.sector ? 'text-indigo-200' : 'text-zinc-400')}>
                      {preset.label}
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('license')}
                  className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2.5 text-sm font-medium text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-300 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('mode')}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
                >
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: Calling Mode ── */}
          {step === 'mode' && (
            <div>
              <div className="mb-7">
                <h1 className="text-2xl font-bold text-zinc-50 mb-1.5">Calling Mode</h1>
                <p className="text-sm text-zinc-500">How will customers be summoned to service?</p>
              </div>

              <div className="space-y-2.5 mb-8">
                {Object.values(CALLING_MODES).map((mode) => (
                  <button
                    key={mode.mode}
                    onClick={() => setCallingMode(mode.mode)}
                    className={cn(
                      'w-full text-left rounded-xl border p-4 transition-all',
                      callingMode === mode.mode
                        ? 'border-indigo-500 bg-indigo-600/10'
                        : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900/60'
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className={cn(
                          'text-sm font-semibold mb-1',
                          callingMode === mode.mode ? 'text-indigo-200' : 'text-zinc-200'
                        )}>
                          {mode.label}
                        </p>
                        <p className="text-xs text-zinc-500 leading-relaxed">{mode.description}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {mode.features.map((f) => (
                            <span key={f} className="text-[10px] text-zinc-600 bg-zinc-800/80 rounded px-1.5 py-0.5 font-medium">
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className={cn(
                        'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-all',
                        callingMode === mode.mode
                          ? 'bg-indigo-600 ring-2 ring-indigo-500/30'
                          : 'ring-1 ring-zinc-700'
                      )}>
                        {callingMode === mode.mode && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('sector')}
                  className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2.5 text-sm font-medium text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-300 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('windows')}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
                >
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: Windows + Language ── */}
          {step === 'windows' && (
            <div>
              <div className="mb-7">
                <h1 className="text-2xl font-bold text-zinc-50 mb-1.5">Service Windows</h1>
                <p className="text-sm text-zinc-500">How many windows or counters will be active?</p>
              </div>

              {/* Window count picker */}
              <div
                className="flex items-center gap-6 mb-6 p-5 rounded-xl border border-zinc-800 bg-zinc-900/40"
              >
                <button
                  onClick={() => setWindowCount(Math.max(1, windowCount - 1))}
                  className="w-10 h-10 rounded-lg border border-zinc-700 bg-zinc-800/80 flex items-center justify-center text-zinc-300 hover:bg-zinc-700 text-lg font-bold transition-colors flex-shrink-0"
                >
                  −
                </button>
                <div className="flex-1 text-center">
                  <p className="text-5xl font-extrabold text-indigo-400 tabular-nums leading-none">{windowCount}</p>
                  <p className="text-xs text-zinc-500 mt-1.5 font-medium">service windows</p>
                </div>
                <button
                  onClick={() => setWindowCount(Math.min(20, windowCount + 1))}
                  className="w-10 h-10 rounded-lg border border-zinc-700 bg-zinc-800/80 flex items-center justify-center text-zinc-300 hover:bg-zinc-700 text-lg font-bold transition-colors flex-shrink-0"
                >
                  +
                </button>
              </div>

              {/* Language */}
              <div className="mb-8">
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">
                  Announcement Language
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['en', 'sw', 'ar', 'fr'] as const).map((lang) => (
                    <button
                      key={lang}
                      onClick={() => setLanguage(lang)}
                      className={cn(
                        'rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors',
                        language === lang
                          ? 'border-indigo-500 bg-indigo-600/15 text-indigo-200'
                          : 'border-zinc-800 bg-zinc-900/40 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                      )}
                    >
                      {{ en: 'English', sw: 'Kiswahili', ar: 'العربية', fr: 'Français' }[lang]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('mode')}
                  className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2.5 text-sm font-medium text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-300 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleFinish}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
                >
                  Finish Setup <Check className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: Complete ── */}
          {step === 'complete' && (
            <div className="text-center">
              <div className="relative inline-block mb-6">
                <div className="w-20 h-20 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center">
                  <Check className="w-10 h-10 text-indigo-400" />
                </div>
                <div className="absolute -top-1 -right-1">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                </div>
              </div>
              <h1 className="text-2xl font-bold text-zinc-50 mb-2">Setup Complete!</h1>
              <p className="text-sm text-zinc-500 mb-8 leading-relaxed">
                Your announcement system is configured and ready.<br />
                Open the operator panel to start calling.
              </p>
              <button
                onClick={() => setPage('login')}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-7 py-3 text-sm font-semibold text-white transition-colors"
              >
                Open Operator Panel <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
