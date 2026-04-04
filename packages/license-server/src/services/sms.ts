/**
 * SMS notifications via Africa's Talking
 * Used to notify clients when their license is expiring or invoice is due.
 * Africa's Talking covers Tanzania, Kenya, Uganda, Rwanda, Ethiopia, Nigeria, Ghana.
 */

interface SMSResult {
  success: boolean
  messageId?: string
  error?: string
}

const AT_URL = 'https://api.africastalking.com/version1/messaging'

export async function sendSMS(
  to: string,
  message: string,
  opts?: { from?: string }
): Promise<SMSResult> {
  const apiKey  = process.env.AFRICASTALKING_API_KEY
  const username = process.env.AFRICASTALKING_USERNAME ?? 'sandbox'

  if (!apiKey) {
    console.warn('[SMS] AFRICASTALKING_API_KEY not set — skipping SMS')
    return { success: false, error: 'SMS not configured' }
  }

  // Normalize Tanzania numbers: 07XXXXXXXX → +2557XXXXXXXX
  const normalized = normalizeTanzaniaPhone(to)

  const params = new URLSearchParams({
    username,
    to: normalized,
    message,
    ...(opts?.from ? { from: opts.from } : {}),
  })

  try {
    const res = await fetch(AT_URL, {
      method: 'POST',
      headers: {
        apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const data = await res.json() as any
    const recipient = data?.SMSMessageData?.Recipients?.[0]

    if (recipient?.statusCode === 101) {
      return { success: true, messageId: recipient.messageId }
    }

    return { success: false, error: recipient?.status ?? 'Unknown error' }
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Network error' }
  }
}

/**
 * Normalize phone to E.164 format.
 * Handles TZ: 0712345678 → +255712345678
 * Already E.164 numbers are passed through unchanged.
 */
function normalizeTanzaniaPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (phone.startsWith('+')) return phone
  if (digits.startsWith('255')) return `+${digits}`
  if (digits.startsWith('0') && digits.length === 10) return `+255${digits.slice(1)}`
  // For other countries (Kenya 07xx, Uganda 07xx etc) just add + prefix
  return `+${digits}`
}

// ── Pre-built message templates ─────────────────────────────────────────────

export function licenseExpiryMessage(orgName: string, daysLeft: number, renewUrl?: string): string {
  const days = daysLeft === 1 ? '1 day' : `${daysLeft} days`
  return `Dear ${orgName}, your Announcement System license expires in ${days}. ` +
    `Please renew to avoid service interruption.` +
    (renewUrl ? ` Renew at: ${renewUrl}` : ' Contact support to renew.')
}

export function invoiceDueMessage(orgName: string, amount: number, currency: string, dueDate: string): string {
  return `Dear ${orgName}, invoice of ${currency} ${amount.toLocaleString()} is due on ${dueDate}. ` +
    `Please make payment to continue your Announcement System service.`
}

export function licenseActivatedMessage(orgName: string, key: string): string {
  return `Dear ${orgName}, your Announcement System license ${key} has been activated. ` +
    `Thank you for choosing our service.`
}
