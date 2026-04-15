import type { Sector } from './announcement'
import type { CallingMode } from './queue'

export type LicenseTier = 'starter' | 'professional' | 'enterprise'

export type LicenseStatus = 'active' | 'expired' | 'grace_period' | 'invalid' | 'suspended'

export interface LicenseKey {
  /** 20-char formatted key e.g. "A3K9X-MP2QR-7TBNWZ-L5" */
  key: string
  tier: LicenseTier
  /** Max number of service windows */
  maxWindows: number
  /** Max number of sites/installations */
  maxSites: number
  /** ISO string */
  expiresAt: string
  /** ISO string */
  issuedAt: string
  features: LicenseFeature[]
  clientId: string
  organizationName: string
}

export type LicenseFeature =
  | 'ticket_mode'
  | 'card_mode'
  | 'name_mode'
  | 'hybrid_mode'
  | 'multi_language'
  | 'premium_tts'
  | 'analytics'
  | 'custom_branding'
  | 'api_access'
  | 'multi_site'
  | 'emergency_broadcast'
  | 'sms_notifications'
  | 'appointment_sync'

export interface LicenseValidationResult {
  valid: boolean
  status: LicenseStatus
  license?: LicenseKey
  error?: string
  /** Days remaining in grace period */
  graceDaysRemaining?: number
  /** Days until expiry */
  daysUntilExpiry?: number
}

export interface InstallationConfig {
  licenseKey: string
  organizationName: string
  sector: Sector
  callingMode: CallingMode
  windowCount: number
  language: SupportedLanguage
  /** Index of display screen (0 = primary, 1 = secondary TV) */
  displayScreenIndex: number
  /** Categories/departments configured during setup */
  categories: Array<{
    code: string
    label: string
    color: string
    prefix: string
  }>
  /** Customisable announcement phrase templates. Use {number}, {window}, {name} as placeholders. */
  announcementPhrases?: {
    ticket: string   // e.g. "Tangazo. Mwenye tiketi, {number}, tafadhali elekea {window}."
    card: string     // e.g. "Tangazo. Mwenye kadi, {number}, tafadhali elekea {window}."
    name: string     // e.g. "Tangazo. {name}, tafadhali elekea {window}."
  }
}

export type SupportedLanguage = 'en' | 'sw' | 'ar' | 'fr'

export interface MachineFingerprint {
  machineId: string
  hostname: string
  platform: string
}
