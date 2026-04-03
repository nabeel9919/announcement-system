import crypto from 'crypto'

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I, O, 0, 1 to avoid confusion
const KEY_LENGTH = 20
const SECRET = process.env.LICENSE_HMAC_SECRET ?? 'CHANGE_THIS_IN_PRODUCTION'

/**
 * Generate a unique 20-character license key.
 * Format: XXXXX-XXXXX-XXXXX-XXXXX  (4 groups of 5, 20 chars + 3 dashes = 23 chars displayed)
 *
 * The key encodes:
 *  - 16 random chars (entropy)
 *  - 4 char HMAC checksum (tamper detection)
 */
export function generateLicenseKey(): string {
  // 16 random chars
  const randomPart = Array.from({ length: 16 }, () =>
    CHARSET[crypto.randomInt(0, CHARSET.length)]
  ).join('')

  // 4-char HMAC checksum
  const hmac = crypto.createHmac('sha256', SECRET)
  hmac.update(randomPart)
  const digest = hmac.digest('hex').toUpperCase()
  const checksum = digest
    .split('')
    .filter((c) => CHARSET.includes(c))
    .slice(0, 4)
    .join('')
    .padEnd(4, 'X')

  const raw = randomPart + checksum  // 20 chars

  // Format as XXXXX-XXXXX-XXXXX-XXXXX
  return [
    raw.slice(0, 5),
    raw.slice(5, 10),
    raw.slice(10, 15),
    raw.slice(15, 20),
  ].join('-')
}

/**
 * Validate the checksum portion of a license key.
 * Does NOT validate expiry or machine binding — that's done in key-validator.ts.
 */
export function validateKeyChecksum(formattedKey: string): boolean {
  const raw = formattedKey.replace(/-/g, '').toUpperCase()
  if (raw.length !== KEY_LENGTH) return false
  if (!raw.split('').every((c) => CHARSET.includes(c))) return false

  const randomPart = raw.slice(0, 16)
  const providedChecksum = raw.slice(16, 20)

  const hmac = crypto.createHmac('sha256', SECRET)
  hmac.update(randomPart)
  const digest = hmac.digest('hex').toUpperCase()
  const expectedChecksum = digest
    .split('')
    .filter((c) => CHARSET.includes(c))
    .slice(0, 4)
    .join('')
    .padEnd(4, 'X')

  return providedChecksum === expectedChecksum
}

/** Normalize key input — strip spaces, dashes, uppercase */
export function normalizeKey(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase()
}
