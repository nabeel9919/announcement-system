import type { LicenseValidationResult } from '@announcement/shared'
import { validateKeyChecksum, normalizeKey } from './key-generator'

export interface StoredLicense {
  key: string
  clientId: string
  organizationName: string
  tier: 'starter' | 'professional' | 'enterprise'
  maxWindows: number
  maxSites: number
  features: string[]
  expiresAt: Date
  issuedAt: Date
  machineId?: string   // locked to machine after first activation
  isRevoked: boolean
}

/**
 * Validate a license key submitted by the desktop client.
 * Called on app startup and every 4 hours.
 */
export async function validateLicense(
  key: string,
  machineId: string,
  getLicense: (normalizedKey: string) => Promise<StoredLicense | null>
): Promise<LicenseValidationResult> {
  const normalized = normalizeKey(key)

  // 1. Checksum
  if (!validateKeyChecksum(key)) {
    return { valid: false, status: 'invalid', error: 'Invalid license key format' }
  }

  // 2. Lookup in DB
  const license = await getLicense(normalized)
  if (!license) {
    return { valid: false, status: 'invalid', error: 'License key not found' }
  }

  // 3. Revocation
  if (license.isRevoked) {
    return { valid: false, status: 'suspended', error: 'This license has been suspended' }
  }

  // 4. Machine binding — lock key to first machine that activates it
  if (license.machineId && license.machineId !== machineId) {
    return {
      valid: false,
      status: 'invalid',
      error: 'This license is activated on a different machine. Contact support to transfer.',
    }
  }

  // 5. Expiry
  const now = new Date()
  const expiresAt = new Date(license.expiresAt)
  const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000)

  if (daysUntilExpiry < -7) {
    // Beyond grace period
    return {
      valid: false,
      status: 'expired',
      error: 'License has expired. Please renew your subscription.',
      daysUntilExpiry,
    }
  }

  if (daysUntilExpiry < 0) {
    // Within 7-day grace period
    return {
      valid: true,
      status: 'grace_period',
      graceDaysRemaining: 7 + daysUntilExpiry,
      daysUntilExpiry,
      license: {
        key: license.key,
        clientId: license.clientId,
        organizationName: license.organizationName,
        tier: license.tier,
        maxWindows: license.maxWindows,
        maxSites: license.maxSites,
        features: license.features as any,
        expiresAt: license.expiresAt.toISOString(),
        issuedAt: license.issuedAt.toISOString(),
      },
    }
  }

  return {
    valid: true,
    status: 'active',
    daysUntilExpiry,
    license: {
      key: license.key,
      clientId: license.clientId,
      organizationName: license.organizationName,
      tier: license.tier,
      maxWindows: license.maxWindows,
      maxSites: license.maxSites,
      features: license.features as any,
      expiresAt: license.expiresAt.toISOString(),
      issuedAt: license.issuedAt.toISOString(),
    },
  }
}
