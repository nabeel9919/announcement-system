import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'

const CONFIG_PATH = join(app.getPath('userData'), 'config.json')
const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL ?? 'http://localhost:3001'
const OFFLINE_GRACE_HOURS = 72

interface LocalConfig {
  licenseKey?: string
  lastValidatedAt?: string
  licenseData?: unknown
  installationConfig?: unknown
  isSetupComplete?: boolean
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

/**
 * Validate license on startup.
 * Returns true if app can run (valid, grace period, or offline within 72h).
 */
export async function checkLicense(): Promise<boolean> {
  const config = readLocalConfig()

  if (!config.licenseKey || !config.isSetupComplete) {
    return false  // Needs setup
  }

  // Attempt online validation
  try {
    const { getMachineId } = await import('node-machine-id')
    const machineId = await getMachineId()

    const response = await fetch(`${LICENSE_SERVER_URL}/api/licenses/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: config.licenseKey, machineId }),
      signal: AbortSignal.timeout(10_000),
    })

    const result = await response.json() as { valid: boolean; status: string }

    if (result.valid) {
      writeLocalConfig({ lastValidatedAt: new Date().toISOString(), licenseData: result })
      return true
    }

    if (result.status === 'grace_period') {
      writeLocalConfig({ lastValidatedAt: new Date().toISOString(), licenseData: result })
      return true
    }

    return false
  } catch {
    // Offline or server unreachable — check grace period
    if (config.lastValidatedAt) {
      const lastValid = new Date(config.lastValidatedAt)
      const hoursSince = (Date.now() - lastValid.getTime()) / 3_600_000

      if (hoursSince < OFFLINE_GRACE_HOURS) {
        console.log(`[License] Offline mode — grace period: ${Math.round(OFFLINE_GRACE_HOURS - hoursSince)}h remaining`)
        return true
      }
    }

    return false
  }
}
