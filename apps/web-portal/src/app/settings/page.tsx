'use client'
import { useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { apiFetch } from '@/lib/utils'
import { Save, Eye, EyeOff, Loader2, Shield, Bell, Globe, Database, Key } from 'lucide-react'

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 mb-6">
      <h2 className="text-sm font-semibold text-zinc-100 mb-5 flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary-400" />
        {title}
      </h2>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-6 items-start py-4 border-b border-zinc-800/60 last:border-0">
      <div>
        <p className="text-sm font-medium text-zinc-200">{label}</p>
        {hint && <p className="text-xs text-zinc-600 mt-0.5">{hint}</p>}
      </div>
      <div className="col-span-2">{children}</div>
    </div>
  )
}

export default function SettingsPage() {
  const [saving, setSaving] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const [adminEmail, setAdminEmail] = useState('')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')

  const [serverUrl, setServerUrl] = useState(
    typeof window !== 'undefined'
      ? (localStorage.getItem('license_server_url') ?? 'http://localhost:3001')
      : 'http://localhost:3001'
  )
  const [googleTtsKey, setGoogleTtsKey] = useState('')
  const [gracePeriod, setGracePeriod] = useState('7')
  const [offlineGrace, setOfflineGrace] = useState('72')
  const [trialDays, setTrialDays] = useState('14')

  async function saveSection(section: string, payload: object) {
    setSaving(section)
    try {
      await apiFetch('/api/settings', { method: 'PATCH', body: JSON.stringify({ section, ...payload }) })
      setSaved(section)
      setTimeout(() => setSaved(null), 3000)
    } catch {
      // Show inline error in real implementation
    } finally {
      setSaving(null)
    }
  }

  function SaveButton({ section }: { section: string }) {
    const isLoading = saving === section
    const isDone = saved === section
    return (
      <button
        onClick={() => {
          if (section === 'auth') saveSection(section, { adminEmail, currentPw, newPw })
          else if (section === 'server') {
            localStorage.setItem('license_server_url', serverUrl)
            saveSection(section, { serverUrl })
          }
          else if (section === 'tts') saveSection(section, { googleTtsKey })
          else if (section === 'license') saveSection(section, { gracePeriod: +gracePeriod, offlineGrace: +offlineGrace, trialDays: +trialDays })
        }}
        disabled={isLoading}
        className="flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white transition-colors"
      >
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {isDone ? 'Saved!' : isLoading ? 'Saving...' : 'Save'}
      </button>
    )
  }

  const inputCls = "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary-500"

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <Sidebar />
      <main className="flex-1 p-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>
          <p className="text-zinc-500 text-sm mt-1">Configure the admin portal and license server</p>
        </div>

        {/* Admin credentials */}
        <Section title="Admin Credentials" icon={Shield}>
          <Field label="Admin Email" hint="Used for portal login">
            <input value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="admin@announcement.local" className={inputCls} />
          </Field>
          <Field label="Current Password" hint="Required to change password">
            <div className="relative">
              <input type={showCurrentPw ? 'text' : 'password'} value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                placeholder="Enter current password" className={inputCls} />
              <button onClick={() => setShowCurrentPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
          <Field label="New Password" hint="Leave blank to keep current">
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="New password (min 8 chars)" className={inputCls} />
              <button onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
          <div className="pt-4"><SaveButton section="auth" /></div>
        </Section>

        {/* Server connection */}
        <Section title="Server Connection" icon={Globe}>
          <Field label="License Server URL" hint="The URL of your Fastify backend">
            <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:3001" className={inputCls} />
          </Field>
          <div className="pt-4 flex items-center gap-3">
            <SaveButton section="server" />
            <button
              onClick={async () => {
                try {
                  await apiFetch('/health')
                  alert('Server reachable!')
                } catch {
                  alert('Cannot reach server.')
                }
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              Test Connection
            </button>
          </div>
        </Section>

        {/* TTS */}
        <Section title="Text-to-Speech" icon={Bell}>
          <Field label="Google TTS API Key" hint="Optional — enables premium voices. Leave blank to use free Web Speech API.">
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={googleTtsKey}
                onChange={(e) => setGoogleTtsKey(e.target.value)}
                placeholder="AIza..." className={inputCls} />
            </div>
            <p className="text-xs text-zinc-600 mt-2">
              Without this key, the desktop app uses the browser's built-in speech synthesis (always available offline).
              Google TTS provides higher quality voices.
            </p>
          </Field>
          <div className="pt-4"><SaveButton section="tts" /></div>
        </Section>

        {/* License policy */}
        <Section title="License Policy" icon={Key}>
          <Field label="Trial Period" hint="Days before subscription is required">
            <div className="flex items-center gap-2">
              <input type="number" value={trialDays} onChange={(e) => setTrialDays(e.target.value)}
                min={0} max={90} className="w-24 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              <span className="text-sm text-zinc-500">days</span>
            </div>
          </Field>
          <Field label="Post-expiry Grace Period" hint="Days app keeps working after license expires">
            <div className="flex items-center gap-2">
              <input type="number" value={gracePeriod} onChange={(e) => setGracePeriod(e.target.value)}
                min={0} max={30} className="w-24 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              <span className="text-sm text-zinc-500">days</span>
            </div>
          </Field>
          <Field label="Offline Grace Period" hint="Hours app works without reaching the server">
            <div className="flex items-center gap-2">
              <input type="number" value={offlineGrace} onChange={(e) => setOfflineGrace(e.target.value)}
                min={0} max={168} className="w-24 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              <span className="text-sm text-zinc-500">hours</span>
            </div>
          </Field>
          <div className="pt-4"><SaveButton section="license" /></div>
        </Section>

        {/* Danger zone */}
        <Section title="Danger Zone" icon={Database}>
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-zinc-200">Export All Data</p>
              <p className="text-xs text-zinc-600 mt-0.5">Download a JSON backup of all clients, licenses, and invoices</p>
            </div>
            <button
              onClick={() => apiFetch('/api/export').then((data) => {
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                const a = document.createElement('a')
                a.href = URL.createObjectURL(blob)
                a.download = `announcement-backup-${new Date().toISOString().slice(0, 10)}.json`
                a.click()
              })}
              className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              Export JSON
            </button>
          </div>
          <div className="flex items-center justify-between py-3 border-t border-zinc-800/60">
            <div>
              <p className="text-sm font-medium text-red-400">Revoke All Licenses</p>
              <p className="text-xs text-zinc-600 mt-0.5">Emergency kill-switch — revokes every active license immediately</p>
            </div>
            <button
              onClick={() => {
                if (!confirm('EMERGENCY: Revoke ALL active licenses? This cannot be undone.')) return
                apiFetch('/api/licenses/revoke-all', { method: 'POST', body: JSON.stringify({ reason: 'Admin emergency revoke' }) })
              }}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Revoke All
            </button>
          </div>
        </Section>
      </main>
    </div>
  )
}
