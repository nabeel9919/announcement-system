import { useState } from 'react'
import { useAppStore } from '../../store/app'
import type { Sector, CallingMode, SupportedLanguage } from '@announcement/shared'
import { SECTOR_PRESETS, CALLING_MODES } from '@announcement/shared'
import { cn, generateId } from '../../lib/utils'
import { Check, ChevronRight, Building2, Mic, KeyRound, MonitorPlay, Loader2 } from 'lucide-react'

type Step = 'license' | 'sector' | 'mode' | 'windows' | 'audio' | 'complete'

const STEPS: { id: Step; label: string; icon: React.ElementType }[] = [
  { id: 'license', label: 'Activation', icon: KeyRound },
  { id: 'sector', label: 'Sector', icon: Building2 },
  { id: 'mode', label: 'Calling Mode', icon: Mic },
  { id: 'windows', label: 'Windows', icon: MonitorPlay },
  { id: 'audio', label: 'Audio', icon: Mic },
  { id: 'complete', label: 'Done', icon: Check },
]

export default function SetupPage() {
  const { setPage, setConfig, setSetupComplete } = useAppStore()

  const [step, setStep] = useState<Step>('license')
  const [licenseKey, setLicenseKey] = useState('')
  const [orgName, setOrgName] = useState('')
  const [licenseError, setLicenseError] = useState('')
  const [validating, setValidating] = useState(false)

  const [sector, setSector] = useState<Sector>('hospital')
  const [callingMode, setCallingMode] = useState<CallingMode>('hybrid')
  const [windowCount, setWindowCount] = useState(4)
  const [language, setLanguage] = useState<SupportedLanguage>('en')

  const currentStepIdx = STEPS.findIndex((s) => s.id === step)

  async function handleValidateLicense() {
    if (licenseKey.replace(/[\s-]/g, '').length < 20) {
      setLicenseError('Please enter a valid 20-character license key')
      return
    }
    if (!orgName.trim()) {
      setLicenseError('Please enter your organization name')
      return
    }
    setValidating(true)
    setLicenseError('')

    // For now, accept any well-formed key — server validates on real startup
    await new Promise((r) => setTimeout(r, 1200)) // simulate network
    setValidating(false)
    setStep('sector')
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

    // Persist to local config
    await window.api.config.write({ isSetupComplete: true, installationConfig })

    // Save categories and windows to DB
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
    <div className="flex h-screen bg-zinc-950 text-zinc-50">
      {/* Sidebar */}
      <div className="w-64 border-r border-zinc-800 bg-zinc-900/50 flex flex-col">
        <div className="p-6 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
              <MonitorPlay className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-100">Announcement</p>
              <p className="text-xs text-zinc-500">System Setup</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {STEPS.map((s, idx) => {
            const isDone = idx < currentStepIdx
            const isCurrent = s.id === step
            const Icon = s.icon
            return (
              <div
                key={s.id}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                  isCurrent && 'bg-primary-600/20 text-primary-400',
                  isDone && 'text-zinc-400',
                  !isCurrent && !isDone && 'text-zinc-600'
                )}
              >
                <div
                  className={cn(
                    'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs',
                    isDone && 'bg-primary-600 text-white',
                    isCurrent && 'border-2 border-primary-500 text-primary-400',
                    !isCurrent && !isDone && 'border border-zinc-700 text-zinc-600'
                  )}
                >
                  {isDone ? <Check className="w-3 h-3" /> : idx + 1}
                </div>
                {s.label}
              </div>
            )
          })}
        </nav>

        <div className="p-4 border-t border-zinc-800">
          <p className="text-xs text-zinc-600">Version 1.0.0</p>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-12">
        <div className="w-full max-w-lg animate-fade-in">

          {/* STEP: License */}
          {step === 'license' && (
            <div>
              <h1 className="text-2xl font-bold text-zinc-100 mb-1">Activate Your License</h1>
              <p className="text-zinc-500 mb-8">Enter your 20-character license key to get started.</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                    Organization Name
                  </label>
                  <input
                    type="text"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g. City Hospital, Julius Nyerere Airport"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                    License Key
                  </label>
                  <input
                    type="text"
                    value={licenseKey}
                    onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                    placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                    maxLength={23}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3.5 py-2.5 text-sm font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent tracking-widest"
                  />
                  {licenseError && (
                    <p className="mt-1.5 text-xs text-red-400">{licenseError}</p>
                  )}
                </div>

                <button
                  onClick={handleValidateLicense}
                  disabled={validating}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors mt-2"
                >
                  {validating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Validating...
                    </>
                  ) : (
                    <>
                      Activate License
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* STEP: Sector */}
          {step === 'sector' && (
            <div>
              <h1 className="text-2xl font-bold text-zinc-100 mb-1">Select Your Sector</h1>
              <p className="text-zinc-500 mb-8">
                This configures default departments, window names, and announcement templates.
              </p>

              <div className="grid grid-cols-3 gap-3 mb-8">
                {(Object.values(SECTOR_PRESETS)).map((preset) => (
                  <button
                    key={preset.sector}
                    onClick={() => setSector(preset.sector)}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all',
                      sector === preset.sector
                        ? 'border-primary-500 bg-primary-600/20 text-primary-300'
                        : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
                    )}
                  >
                    <span className="text-2xl">{preset.icon}</span>
                    <span className="text-xs font-medium leading-tight">{preset.label}</span>
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('license')}
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('mode')}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
                >
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP: Calling Mode */}
          {step === 'mode' && (
            <div>
              <h1 className="text-2xl font-bold text-zinc-100 mb-1">Calling Mode</h1>
              <p className="text-zinc-500 mb-8">How will patients or customers be called to service?</p>

              <div className="space-y-3 mb-8">
                {(Object.values(CALLING_MODES)).map((mode) => (
                  <button
                    key={mode.mode}
                    onClick={() => setCallingMode(mode.mode)}
                    className={cn(
                      'w-full text-left rounded-xl border p-4 transition-all',
                      callingMode === mode.mode
                        ? 'border-primary-500 bg-primary-600/20'
                        : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className={cn('text-sm font-semibold mb-0.5', callingMode === mode.mode ? 'text-primary-300' : 'text-zinc-100')}>
                          {mode.label}
                        </p>
                        <p className="text-xs text-zinc-500 leading-relaxed">{mode.description}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {mode.features.map((f) => (
                            <span key={f} className="text-xs text-zinc-600 bg-zinc-800 rounded px-1.5 py-0.5">
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                      {callingMode === mode.mode && (
                        <div className="w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep('sector')} className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors">Back</button>
                <button onClick={() => setStep('windows')} className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors">
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP: Windows */}
          {step === 'windows' && (
            <div>
              <h1 className="text-2xl font-bold text-zinc-100 mb-1">Service Windows</h1>
              <p className="text-zinc-500 mb-8">How many windows or counters will be active?</p>

              <div className="flex items-center gap-6 mb-8 p-6 rounded-xl border border-zinc-800 bg-zinc-900/60">
                <button
                  onClick={() => setWindowCount(Math.max(1, windowCount - 1))}
                  className="w-10 h-10 rounded-lg border border-zinc-700 bg-zinc-800 flex items-center justify-center text-zinc-300 hover:bg-zinc-700 text-lg font-bold transition-colors"
                >—</button>
                <div className="flex-1 text-center">
                  <p className="text-5xl font-display font-extrabold text-primary-400">{windowCount}</p>
                  <p className="text-sm text-zinc-500 mt-1">windows / counters</p>
                </div>
                <button
                  onClick={() => setWindowCount(Math.min(20, windowCount + 1))}
                  className="w-10 h-10 rounded-lg border border-zinc-700 bg-zinc-800 flex items-center justify-center text-zinc-300 hover:bg-zinc-700 text-lg font-bold transition-colors"
                >+</button>
              </div>

              <div className="mb-8">
                <label className="block text-sm font-medium text-zinc-300 mb-3">Language</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['en', 'sw', 'ar', 'fr'] as const).map((lang) => (
                    <button
                      key={lang}
                      onClick={() => setLanguage(lang)}
                      className={cn(
                        'rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors',
                        language === lang
                          ? 'border-primary-500 bg-primary-600/20 text-primary-300'
                          : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600'
                      )}
                    >
                      {{ en: 'English', sw: 'Swahili', ar: 'Arabic (عربي)', fr: 'French' }[lang]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep('mode')} className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors">Back</button>
                <button onClick={handleFinish} className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors">
                  Finish Setup <Check className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP: Complete */}
          {step === 'complete' && (
            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-primary-600/20 border-2 border-primary-500 flex items-center justify-center mx-auto mb-6">
                <Check className="w-10 h-10 text-primary-400" />
              </div>
              <h1 className="text-2xl font-bold text-zinc-100 mb-2">Setup Complete</h1>
              <p className="text-zinc-500 mb-8">
                Your announcement system is ready. Launch the operator panel to start calling.
              </p>
              <button
                onClick={() => setPage('operator')}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 px-6 py-3 text-sm font-semibold text-white transition-colors"
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
