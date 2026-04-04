import { useState } from 'react'
import { useAppStore } from '../../store/app'
import { ShieldOff, RefreshCw, Settings, Loader2 } from 'lucide-react'

export default function LicenseExpiredPage() {
  const { setPage } = useAppStore()
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)

  async function retryCheck() {
    setChecking(true)
    setCheckResult(null)
    try {
      // Re-read config and try validating again
      const config = await window.api.config.read()
      if (!config?.licenseKey) {
        setCheckResult('No license key found. Please complete setup.')
        setChecking(false)
        return
      }
      const result = await window.api.license.validate(config.licenseKey)
      if (result?.valid || result?.status === 'grace_period') {
        // Write updated validation timestamp then go to operator
        setPage('operator')
      } else {
        setCheckResult(result?.error ?? 'License is revoked or expired. Contact your supplier.')
      }
    } catch {
      setCheckResult('Could not reach the license server. Check your internet connection or server URL.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-50 items-center justify-center p-8">
      <div className="w-full max-w-md text-center">
        {/* Icon */}
        <div className="w-20 h-20 rounded-full bg-red-600/20 border-2 border-red-500/40 flex items-center justify-center mx-auto mb-6">
          <ShieldOff className="w-10 h-10 text-red-400" />
        </div>

        <h1 className="text-2xl font-bold text-zinc-100 mb-2">License Expired</h1>
        <p className="text-zinc-400 text-sm mb-8 leading-relaxed">
          Your license key is no longer valid. This could mean it has expired,
          been revoked, or the license server cannot be reached.
          <br /><br />
          Contact your system supplier to renew your license, then click Retry.
        </p>

        {checkResult && (
          <div className="rounded-lg border border-red-500/30 bg-red-600/10 px-4 py-3 text-sm text-red-300 mb-6">
            {checkResult}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button
            onClick={retryCheck}
            disabled={checking}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-5 py-3 text-sm font-semibold text-white transition-colors"
          >
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {checking ? 'Checking license...' : 'Retry License Check'}
          </button>

          <button
            onClick={() => setPage('settings')}
            className="flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors"
          >
            <Settings className="w-4 h-4" />
            Change Server URL
          </button>

          <button
            onClick={() => setPage('setup')}
            className="text-sm text-zinc-600 hover:text-zinc-400 transition-colors py-1"
          >
            Re-activate with a new key
          </button>
        </div>

        <p className="text-xs text-zinc-700 mt-8">
          The system will continue running in read-only mode until the license is renewed.
        </p>
      </div>
    </div>
  )
}
