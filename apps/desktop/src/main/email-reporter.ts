/**
 * Email reporting module.
 * Sends automated daily end-of-day reports and weekly feedback digests.
 * Uses nodemailer + user-configured SMTP (Gmail, Outlook, company server, etc.)
 */

import * as nodemailer from 'nodemailer'
import { readLocalConfig, writeLocalConfig } from './license'

export interface EmailConfig {
  enabled: boolean
  smtpHost: string
  smtpPort: number
  secure: boolean        // true = TLS/SSL (port 465), false = STARTTLS (port 587)
  username: string
  password: string
  fromAddress: string    // e.g. noreply@clinic.co.tz
  fromName: string       // e.g. "Clinic Queue System"
  recipients: string[]   // manager email addresses
  dailyReportEnabled: boolean
  dailyReportTime: string  // "17:00"
  weeklyDigestEnabled: boolean
  weeklyDigestDay: number  // 0=Sun … 6=Sat, default 1=Mon
}

export const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  enabled: false,
  smtpHost: '',
  smtpPort: 587,
  secure: false,
  username: '',
  password: '',
  fromAddress: '',
  fromName: 'Queue System Reports',
  recipients: [],
  dailyReportEnabled: true,
  dailyReportTime: '17:00',
  weeklyDigestEnabled: false,
  weeklyDigestDay: 1,
}

export function getEmailConfig(): EmailConfig {
  const config = readLocalConfig() as any
  return { ...DEFAULT_EMAIL_CONFIG, ...(config.emailConfig ?? {}) }
}

export function saveEmailConfig(cfg: EmailConfig): void {
  writeLocalConfig({ emailConfig: cfg } as any)
}

function createTransporter(cfg: EmailConfig) {
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.secure,
    auth: { user: cfg.username, pass: cfg.password },
    tls: { rejectUnauthorized: false },  // tolerate self-signed certs on LAN mail servers
  })
}

// ── HTML email builders ───────────────────────────────────────────────────────

function kpiCell(value: string | number, label: string, color: string) {
  return `
    <td style="padding:20px;text-align:center;background:#fff;width:33%">
      <p style="margin:0;font-size:28px;font-weight:800;color:${color}">${value}</p>
      <p style="margin:4px 0 0;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:.07em">${label}</p>
    </td>`
}

function buildDailyReportHtml(
  orgName: string,
  stats: { served: number; skipped: number; waiting: number; total: number; serveRate: number },
  catStats: { label: string; code: string; served: number; skipped: number; total: number }[],
  feedbackToday: number,
  feedbackScore: number | null,
): string {
  const date = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const rateColor = stats.serveRate >= 80 ? '#16a34a' : stats.serveRate >= 60 ? '#d97706' : '#dc2626'

  const catRows = catStats.map((c) => {
    const rate = c.total > 0 ? Math.round((c.served / c.total) * 100) : 0
    return `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #f4f4f5;font-size:13px;color:#18181b">${c.label} <span style="color:#a1a1aa;font-size:11px">${c.code}</span></td>
        <td style="padding:10px 14px;border-bottom:1px solid #f4f4f5;font-size:13px;font-weight:700;color:#16a34a;text-align:center">${c.served}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f4f4f5;font-size:13px;color:#dc2626;text-align:center">${c.skipped}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f4f4f5;font-size:13px;font-weight:700;color:${rate >= 80 ? '#16a34a' : rate >= 60 ? '#d97706' : '#dc2626'};text-align:center">${rate}%</td>
      </tr>`
  }).join('')

  const feedbackSection = feedbackToday > 0 ? `
    <div style="padding:0 24px 24px">
      <div style="background:#fafafa;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px">
        <span style="font-size:28px">⭐</span>
        <div>
          <p style="margin:0;font-size:14px;font-weight:700;color:#18181b">
            ${feedbackToday} customer feedback response${feedbackToday !== 1 ? 's' : ''} today
            ${feedbackScore !== null ? `&nbsp;·&nbsp;<span style="color:#d97706">${feedbackScore.toFixed(1)} / 5</span>` : ''}
          </p>
          <p style="margin:4px 0 0;font-size:12px;color:#71717a">Check the Feedback Report for full analysis</p>
        </div>
      </div>
    </div>` : ''

  const catSection = catStats.length > 0 ? `
    <div style="padding:0 24px 24px">
      <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:.07em">By Service Category</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f4f4f5">
            <th style="text-align:left;padding:8px 14px;font-size:10px;font-weight:700;color:#71717a;text-transform:uppercase">Category</th>
            <th style="text-align:center;padding:8px 14px;font-size:10px;font-weight:700;color:#71717a;text-transform:uppercase">Served</th>
            <th style="text-align:center;padding:8px 14px;font-size:10px;font-weight:700;color:#71717a;text-transform:uppercase">Skipped</th>
            <th style="text-align:center;padding:8px 14px;font-size:10px;font-weight:700;color:#71717a;text-transform:uppercase">Rate</th>
          </tr>
        </thead>
        <tbody>${catRows}</tbody>
      </table>
    </div>` : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;margin:0;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#4f46e5,#6366f1);padding:30px 24px">
      <p style="margin:0;font-size:12px;color:rgba(255,255,255,.7);letter-spacing:.08em;text-transform:uppercase">Daily Operations Report</p>
      <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800">${orgName || 'Queue System'}</h1>
      <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,.7)">${date}</p>
    </div>

    <!-- KPIs -->
    <table style="width:100%;border-collapse:collapse;border-bottom:1px solid #e4e4e7">
      <tr>
        ${kpiCell(stats.served, 'Served', '#16a34a')}
        <td style="width:1px;background:#e4e4e7;padding:0"></td>
        ${kpiCell(stats.total, 'Total Tickets', '#4f46e5')}
        <td style="width:1px;background:#e4e4e7;padding:0"></td>
        ${kpiCell(stats.serveRate + '%', 'Service Rate', rateColor)}
      </tr>
    </table>

    <!-- Category breakdown -->
    ${catSection}

    <!-- Feedback -->
    ${feedbackSection}

    <!-- Footer -->
    <div style="border-top:1px solid #e4e4e7;padding:14px 24px;background:#fafafa">
      <p style="margin:0;font-size:11px;color:#a1a1aa;text-align:center">
        Automated daily report from <strong>${orgName || 'Queue System'}</strong> &nbsp;·&nbsp; Do not reply to this email
      </p>
    </div>
  </div>
</body></html>`
}

function buildWeeklyDigestHtml(
  orgName: string,
  total7d: number,
  avgScore7d: number | null,
  dailyBreakdown: { date: string; count: number }[],
): string {
  const from = dailyBreakdown[0]?.date ?? ''
  const to = dailyBreakdown[dailyBreakdown.length - 1]?.date ?? ''
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })

  const rows = dailyBreakdown.map((d) => `
    <tr>
      <td style="padding:8px 14px;border-bottom:1px solid #f4f4f5;font-size:13px;color:#18181b">
        ${new Date(d.date).toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' })}
      </td>
      <td style="padding:8px 14px;border-bottom:1px solid #f4f4f5;font-size:13px;font-weight:700;color:#4f46e5;text-align:right">${d.count}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;margin:0;padding:20px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#4f46e5,#6366f1);padding:28px 24px">
      <p style="margin:0;font-size:12px;color:rgba(255,255,255,.7);letter-spacing:.08em;text-transform:uppercase">Weekly Digest</p>
      <h1 style="margin:6px 0 0;color:#fff;font-size:20px;font-weight:800">${orgName || 'Queue System'}</h1>
      <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,.7)">${fmt(from)} – ${fmt(to)}</p>
    </div>

    <div style="padding:24px;display:flex;gap:16px">
      <div style="flex:1;background:#f4f4f5;border-radius:10px;padding:16px;text-align:center">
        <p style="margin:0;font-size:28px;font-weight:800;color:#4f46e5">${total7d}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#71717a;text-transform:uppercase">Total Tickets</p>
      </div>
      ${avgScore7d !== null ? `
      <div style="flex:1;background:#fef3c7;border-radius:10px;padding:16px;text-align:center">
        <p style="margin:0;font-size:28px;font-weight:800;color:#d97706">${avgScore7d.toFixed(1)}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#92400e;text-transform:uppercase">Avg Satisfaction</p>
      </div>` : ''}
    </div>

    <div style="padding:0 24px 24px">
      <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:.07em">Daily Breakdown</p>
      <table style="width:100%;border-collapse:collapse">
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div style="border-top:1px solid #e4e4e7;padding:14px 24px;background:#fafafa">
      <p style="margin:0;font-size:11px;color:#a1a1aa;text-align:center">
        Automated weekly digest from <strong>${orgName || 'Queue System'}</strong> &nbsp;·&nbsp; Do not reply to this email
      </p>
    </div>
  </div>
</body></html>`
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function sendTestEmail(cfg: EmailConfig): Promise<{ success: boolean; error?: string }> {
  try {
    const transport = createTransporter(cfg)
    await transport.sendMail({
      from: `"${cfg.fromName}" <${cfg.fromAddress}>`,
      to: cfg.recipients.join(', '),
      subject: 'Test Email — Queue System Configuration',
      html: `<div style="font-family:sans-serif;padding:24px;max-width:480px">
        <h2 style="color:#4f46e5;margin:0 0 12px">Test email received ✓</h2>
        <p style="color:#52525b">Your email configuration is working correctly. Automated reports will be delivered to this inbox.</p>
        <p style="color:#a1a1aa;font-size:12px;margin-top:16px">Sent from Queue System — ${new Date().toLocaleString()}</p>
      </div>`,
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function sendDailyReport(getDb: () => any): Promise<{ success: boolean; error?: string }> {
  const cfg = getEmailConfig()
  if (!cfg.enabled || !cfg.smtpHost || !cfg.fromAddress || cfg.recipients.length === 0) {
    return { success: false, error: 'Email not configured or disabled' }
  }
  try {
    const db = getDb()
    const today = new Date().toISOString().slice(0, 10)
    const localCfg = readLocalConfig() as any
    const orgName = localCfg.installationConfig?.organizationName ?? ''

    const q = (status: string) =>
      (db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE status=? AND created_at LIKE ?`).get(status, `${today}%`) as any).c
    const total = (db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE created_at LIKE ?`).get(`${today}%`) as any).c
    const served = q('served'), skipped = q('skipped'), waiting = q('waiting')
    const serveRate = served + skipped > 0 ? Math.round((served / (served + skipped)) * 100) : 0

    const catStats = (db.prepare(`
      SELECT c.label, c.code,
        SUM(CASE WHEN t.status='served' THEN 1 ELSE 0 END) as served,
        SUM(CASE WHEN t.status='skipped' THEN 1 ELSE 0 END) as skipped,
        COUNT(*) as total
      FROM tickets t JOIN categories c ON c.id=t.category_id
      WHERE t.created_at LIKE ? GROUP BY t.category_id ORDER BY total DESC
    `).all(`${today}%`) as any[]).map((r) => ({
      label: r.label, code: r.code,
      served: r.served, skipped: r.skipped, total: r.total,
    }))

    const feedbackToday = (db.prepare(`SELECT COUNT(*) as c FROM feedback_responses WHERE submitted_at LIKE ?`).get(`${today}%`) as any).c

    // Get today's avg feedback score
    const fbRows = db.prepare(`SELECT answers FROM feedback_responses WHERE submitted_at LIKE ?`).all(`${today}%`) as any[]
    let scoreSum = 0, scoreCount = 0
    for (const row of fbRows) {
      const answers: any[] = JSON.parse(row.answers ?? '[]')
      for (const a of answers) {
        if ((a.type === 'star' || a.type === 'emoji') && a.score) {
          scoreSum += a.score; scoreCount++
        }
      }
    }
    const feedbackScore = scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 10) / 10 : null

    const html = buildDailyReportHtml(orgName, { served, skipped, waiting, total, serveRate }, catStats, feedbackToday, feedbackScore)
    const transport = createTransporter(cfg)
    await transport.sendMail({
      from: `"${cfg.fromName}" <${cfg.fromAddress}>`,
      to: cfg.recipients.join(', '),
      subject: `Daily Report — ${orgName || 'Queue System'} — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      html,
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function sendWeeklyDigest(getDb: () => any): Promise<{ success: boolean; error?: string }> {
  const cfg = getEmailConfig()
  if (!cfg.enabled || !cfg.smtpHost || !cfg.fromAddress || cfg.recipients.length === 0) {
    return { success: false, error: 'Email not configured or disabled' }
  }
  try {
    const db = getDb()
    const localCfg = readLocalConfig() as any
    const orgName = localCfg.installationConfig?.organizationName ?? ''

    const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const total7d = (db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE created_at >= ?`).get(since) as any).c

    // Daily breakdown
    const dailyBreakdown: { date: string; count: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
      const cnt = (db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE created_at LIKE ?`).get(`${d}%`) as any).c
      dailyBreakdown.push({ date: d, count: cnt })
    }

    // Avg feedback score for the week
    const fbRows = db.prepare(`SELECT answers FROM feedback_responses WHERE submitted_at >= ?`).all(since) as any[]
    let scoreSum = 0, scoreCount = 0
    for (const row of fbRows) {
      const answers: any[] = JSON.parse(row.answers ?? '[]')
      for (const a of answers) {
        if ((a.type === 'star' || a.type === 'emoji') && a.score) { scoreSum += a.score; scoreCount++ }
      }
    }
    const avgScore7d = scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 10) / 10 : null

    const html = buildWeeklyDigestHtml(orgName, total7d, avgScore7d, dailyBreakdown)
    const transport = createTransporter(cfg)
    await transport.sendMail({
      from: `"${cfg.fromName}" <${cfg.fromAddress}>`,
      to: cfg.recipients.join(', '),
      subject: `Weekly Digest — ${orgName || 'Queue System'} — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
      html,
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _getDb: (() => any) | null = null
let lastDailyDate = ''
let lastWeeklyDate = ''

export function scheduleEmailReports(getDb: () => any): void {
  _getDb = getDb

  setInterval(async () => {
    const cfg = getEmailConfig()
    if (!cfg.enabled || !cfg.smtpHost || cfg.recipients.length === 0) return

    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    // Daily report
    if (cfg.dailyReportEnabled && timeStr === cfg.dailyReportTime && lastDailyDate !== todayStr) {
      lastDailyDate = todayStr
      sendDailyReport(getDb).then((r) => {
        if (r.success) console.log('[Email] Daily report sent')
        else console.error('[Email] Daily report failed:', r.error)
      })
    }

    // Weekly digest — send on configured day at the same daily-report time
    if (cfg.weeklyDigestEnabled && now.getDay() === cfg.weeklyDigestDay
      && timeStr === cfg.dailyReportTime && lastWeeklyDate !== todayStr) {
      lastWeeklyDate = todayStr
      sendWeeklyDigest(getDb).then((r) => {
        if (r.success) console.log('[Email] Weekly digest sent')
        else console.error('[Email] Weekly digest failed:', r.error)
      })
    }
  }, 60_000)  // tick every minute
}
