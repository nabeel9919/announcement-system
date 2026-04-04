/**
 * Lightweight cron runner — no external dependencies.
 * Runs inside the Fastify process on a configurable interval.
 *
 * Jobs:
 *  1. licenseExpirySMSJob  — SMS reminders at 7 days and 1 day before expiry
 *  2. invoiceOverdueSMSJob — SMS reminders for invoices overdue by 1+ days
 *  3. subscriptionExpiryJob — mark subscriptions PAST_DUE when period ends
 */

import { PrismaClient } from '@prisma/client'
import {
  sendSMS,
  licenseExpiryMessage,
  invoiceDueMessage,
} from './sms'

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000)
}

function startOfDay(d = new Date()): Date {
  const s = new Date(d)
  s.setHours(0, 0, 0, 0)
  return s
}

function endOfDay(d = new Date()): Date {
  const s = new Date(d)
  s.setHours(23, 59, 59, 999)
  return s
}

// ── Job: License Expiry SMS ───────────────────────────────────────────────────

/**
 * Sends an SMS for every non-revoked license expiring in exactly N days
 * (matching calendar day). Called once per day.
 *
 * Targets: 7 days ahead and 1 day ahead.
 */
async function licenseExpirySMSJob(prisma: PrismaClient): Promise<void> {
  const targets = [7, 1] // days ahead to notify

  for (const daysAhead of targets) {
    const windowStart = startOfDay(daysFromNow(daysAhead))
    const windowEnd   = endOfDay(daysFromNow(daysAhead))

    const licenses = await prisma.license.findMany({
      where: {
        isRevoked: false,
        expiresAt: { gte: windowStart, lte: windowEnd },
      },
      include: {
        client: { select: { organizationName: true, contactPhone: true } },
      },
    })

    for (const lic of licenses) {
      const phone = lic.client.contactPhone
      if (!phone) continue

      const msg = licenseExpiryMessage(lic.client.organizationName, daysAhead)
      const result = await sendSMS(phone, msg)

      if (result.success) {
        console.info(
          `[cron] licenseExpiry SMS sent to ${phone} (${lic.formattedKey}, ${daysAhead}d) — id=${result.messageId}`
        )
      } else {
        console.warn(
          `[cron] licenseExpiry SMS FAILED to ${phone} (${lic.formattedKey}, ${daysAhead}d) — ${result.error}`
        )
      }
    }
  }
}

// ── Job: Invoice Overdue SMS ──────────────────────────────────────────────────

/**
 * Sends an SMS to clients with invoices that became overdue TODAY
 * (dueAt falls within yesterday — catches the exact day they go overdue).
 * Avoids spamming: only fires once per invoice on the day it first goes overdue.
 */
async function invoiceOverdueSMSJob(prisma: PrismaClient): Promise<void> {
  const yesterday = new Date(Date.now() - 86_400_000)
  const overdueWindow = { gte: startOfDay(yesterday), lte: endOfDay(yesterday) }

  const invoices = await prisma.invoice.findMany({
    where: { status: 'OPEN', dueAt: overdueWindow },
    include: {
      client: { select: { organizationName: true, contactPhone: true } },
    },
  })

  for (const inv of invoices) {
    const phone = inv.client.contactPhone
    if (!phone) continue

    const dueDateStr = new Date(inv.dueAt).toLocaleDateString('en-TZ', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
    const msg = invoiceDueMessage(inv.client.organizationName, inv.amount, inv.currency, dueDateStr)
    const result = await sendSMS(phone, msg)

    if (result.success) {
      console.info(`[cron] invoiceOverdue SMS sent to ${phone} (inv=${inv.id}) — id=${result.messageId}`)
    } else {
      console.warn(`[cron] invoiceOverdue SMS FAILED to ${phone} (inv=${inv.id}) — ${result.error}`)
    }
  }
}

// ── Job: Subscription Status Sync ────────────────────────────────────────────

/**
 * Marks ACTIVE subscriptions as PAST_DUE when currentPeriodEnd has passed.
 * This keeps subscription statuses up-to-date without Stripe webhooks.
 */
async function subscriptionExpiryJob(prisma: PrismaClient): Promise<void> {
  const { count } = await prisma.subscription.updateMany({
    where: {
      status: 'ACTIVE',
      currentPeriodEnd: { lt: new Date() },
      cancelAtPeriodEnd: false,
    },
    data: { status: 'PAST_DUE' },
  })

  if (count > 0) {
    console.info(`[cron] subscriptionExpiry: marked ${count} subscription(s) as PAST_DUE`)
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let cronTimer: ReturnType<typeof setInterval> | null = null

/**
 * Starts the daily cron scheduler.
 * Runs all jobs once immediately on boot (so you don't wait until next day)
 * then again every 24 hours.
 *
 * @param prisma — shared Prisma instance from Fastify
 * @param intervalMs — defaults to 24 hours; override for testing
 */
export function startCron(prisma: PrismaClient, intervalMs = 24 * 60 * 60 * 1000): void {
  async function runAllJobs() {
    console.info('[cron] Running scheduled jobs...')
    try {
      await Promise.allSettled([
        licenseExpirySMSJob(prisma),
        invoiceOverdueSMSJob(prisma),
        subscriptionExpiryJob(prisma),
      ])
    } catch (err) {
      console.error('[cron] Unexpected error in job runner:', err)
    }
    console.info('[cron] All jobs done.')
  }

  // Run once at startup (after a short delay so DB is ready)
  setTimeout(runAllJobs, 10_000)

  // Then every 24 hours
  cronTimer = setInterval(runAllJobs, intervalMs)

  console.info(`[cron] Scheduler started — interval ${intervalMs / 3_600_000}h`)
}

export function stopCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer)
    cronTimer = null
    console.info('[cron] Scheduler stopped.')
  }
}
