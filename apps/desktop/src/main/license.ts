import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'

const CONFIG_PATH = join(app.getPath('userData'), 'config.json')
const OFFLINE_GRACE_HOURS = 72

interface LocalConfig {
  licenseKey?: string
  lastValidatedAt?: string
  licenseData?: unknown
  installationConfig?: unknown
  isSetupComplete?: boolean
  /** Override the license server URL — editable from the desktop Settings page */
  licenseServerUrl?: string
}

function getLicenseServerUrl(config?: LocalConfig): string {
  const raw = config?.licenseServerUrl
    ?? process.env.LICENSE_SERVER_URL
    ?? 'http://localhost:3001'
  // Enforce HTTPS for any non-localhost URL so traffic to Railway is always encrypted
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(raw)
  if (!isLocal && raw.startsWith('http://')) {
    return 'https://' + raw.slice('http://'.length)
  }
  return raw
}

export function readLocalConfig(): LocalConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    }
  } catch {
    // Corrupted config — return empty
  }
  return {}
}

export function writeLocalConfig(config: Partial<LocalConfig>): void {
  const existing = readLocalConfig()
  const merged = { ...existing, ...config }
  fs.mkdirSync(join(app.getPath('userData')), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8')
}

export type LicenseCheckResult = 'ok' | 'needs_setup' | 'expired'

/**
 * Validate license on startup.
 * Returns:
 *   'ok'          — license valid or within offline grace period
 *   'needs_setup' — first run, no license key / setup not complete
 *   'expired'     — setup complete but license revoked or expired
 */
export async function checkLicense(): Promise<LicenseCheckResult> {
  const config = readLocalConfig()

  if (!config.licenseKey || !config.isSetupComplete) {
    return 'needs_setup'
  }

  const serverUrl = getLicenseServerUrl(config)

  // Attempt online validation
  try {
    const mod = await import('node-machine-id')
    const getMachineId = mod.machineId ?? mod.default?.machineId
    const machineId = await getMachineId()

    const response = await fetch(`${serverUrl}/api/licenses/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: config.licenseKey, machineId }),
      signal: AbortSignal.timeout(10_000),
    })

    const result = await response.json() as { valid: boolean; status: string }

    if (result.valid) {
      writeLocalConfig({ lastValidatedAt: new Date().toISOString(), licenseData: result })
      return 'ok'
    }

    if (result.status === 'grace_period') {
      writeLocalConfig({ lastValidatedAt: new Date().toISOString(), licenseData: result })
      return 'ok'
    }

    // Online check returned invalid — license is revoked or expired
    return 'expired'
  } catch {
    // Offline or server unreachable — check grace period
    if (config.lastValidatedAt) {
      const lastValid = new Date(config.lastValidatedAt)
      const hoursSince = (Date.now() - lastValid.getTime()) / 3_600_000

      if (hoursSince < OFFLINE_GRACE_HOURS) {
        console.log(`[License] Offline mode — grace period: ${Math.round(OFFLINE_GRACE_HOURS - hoursSince)}h remaining`)
        return 'ok'
      }

      // Grace period exhausted → treat as expired
      return 'expired'
    }

    // Never validated online and offline — treat as needs_setup
    return 'needs_setup'
  }
}
