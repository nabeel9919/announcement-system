import { ipcMain } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const execAsync = promisify(exec)

// ESC/POS command helpers
const ESC = 0x1b
const GS = 0x1d

function esc(...bytes: number[]): Buffer { return Buffer.from([ESC, ...bytes]) }
function gs(...bytes: number[]): Buffer { return Buffer.from([GS, ...bytes]) }
function text(s: string): Buffer { return Buffer.from(s, 'latin1') }
function lf(): Buffer { return Buffer.from([0x0a]) }

interface PrintTicketOptions {
  displayNumber: string
  categoryLabel: string
  organizationName: string
  issuedAt: string
  windowCount?: number
  waitingAhead?: number
  estimatedWaitMinutes?: number
  answers?: { question: string; value: string }[]
}

/** Truncate a string to fit 32-char receipt width, padding with spaces */
function pad32(s: string): string {
  return s.slice(0, 32).padEnd(32, ' ')
}

/** Wrap a long string into lines of max 32 chars */
function wrap32(s: string): string[] {
  const words = s.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if ((line + (line ? ' ' : '') + w).length <= 32) {
      line += (line ? ' ' : '') + w
    } else {
      if (line) lines.push(line)
      // If a single word is >32 chars, hard-break it
      let remaining = w
      while (remaining.length > 32) {
        lines.push(remaining.slice(0, 32))
        remaining = remaining.slice(32)
      }
      line = remaining
    }
  }
  if (line) lines.push(line)
  return lines
}

function buildEscPosTicket(ticket: PrintTicketOptions): Buffer {
  const time = new Date(ticket.issuedAt).toLocaleTimeString('en-TZ', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const date = new Date(ticket.issuedAt).toLocaleDateString('en-TZ', {
    day: '2-digit', month: 'short', year: 'numeric',
  })

  const parts: Buffer[] = []

  // Init printer
  parts.push(esc(0x40))                        // ESC @ — initialize
  parts.push(esc(0x61, 0x01))                  // ESC a 1 — center align

  // Organization name — bold
  parts.push(esc(0x45, 0x01))
  parts.push(text(ticket.organizationName))
  parts.push(lf())
  parts.push(esc(0x45, 0x00))

  parts.push(text('--------------------------------'))
  parts.push(lf())

  // Category
  parts.push(text(ticket.categoryLabel.toUpperCase()))
  parts.push(lf())

  // Big ticket number
  parts.push(gs(0x21, 0x33))                   // 4x size
  parts.push(esc(0x45, 0x01))
  parts.push(text(ticket.displayNumber))
  parts.push(lf())
  parts.push(gs(0x21, 0x00))
  parts.push(esc(0x45, 0x00))

  parts.push(text('--------------------------------'))
  parts.push(lf())

  // Answers section (kiosk questionnaire)
  if (ticket.answers && ticket.answers.length > 0) {
    parts.push(esc(0x61, 0x00))                // left align
    for (const a of ticket.answers) {
      // Question label — small, muted-style
      parts.push(esc(0x45, 0x00))
      for (const line of wrap32(a.question)) {
        parts.push(text(line))
        parts.push(lf())
      }
      // Answer value — bold
      parts.push(esc(0x45, 0x01))
      for (const line of wrap32('> ' + a.value)) {
        parts.push(text(line))
        parts.push(lf())
      }
      parts.push(esc(0x45, 0x00))
      parts.push(lf())
    }
    parts.push(esc(0x61, 0x01))                // back to center
    parts.push(text('--------------------------------'))
    parts.push(lf())
  }

  // Wait info
  if (ticket.waitingAhead !== undefined && ticket.estimatedWaitMinutes !== undefined) {
    parts.push(text(`Ahead of you: ${ticket.waitingAhead}`))
    parts.push(lf())
    const waitStr = ticket.estimatedWaitMinutes < 1
      ? 'Est. wait: <1 min'
      : `Est. wait: ~${ticket.estimatedWaitMinutes} min`
    parts.push(text(waitStr))
    parts.push(lf())
    parts.push(text('--------------------------------'))
    parts.push(lf())
  }

  // Date/time + footer
  parts.push(text(`${date}  ${time}`))
  parts.push(lf())
  parts.push(text('Please wait to be called'))
  parts.push(lf())
  parts.push(text('--------------------------------'))
  parts.push(lf())
  parts.push(text('Powered by Announcement System'))
  parts.push(lf())

  // Feed and cut
  parts.push(lf())
  parts.push(lf())
  parts.push(lf())
  parts.push(lf())
  parts.push(lf())
  parts.push(gs(0x56, 0x00))                   // full cut

  return Buffer.concat(parts)
}

export function setupPrintHandlers(): void {
  ipcMain.handle('print:ticket', async (_event, ticket: PrintTicketOptions) => {
    try {
      const printerName = await getDefaultPrinterName()
      const data = buildEscPosTicket(ticket)

      // Write to temp file and send via lp -o raw
      const tmpFile = join(tmpdir(), `ticket-${Date.now()}.bin`)
      await writeFile(tmpFile, data)
      await execAsync(`lp -d ${printerName} -o raw -o page-left=0 -o page-right=0 -o page-top=0 -o page-bottom=0 "${tmpFile}"`)
      await unlink(tmpFile).catch(() => {})

      return { success: true }
    } catch (e: unknown) {
      console.error('[print:ticket] error:', e)
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('print:listPrinters', async () => {
    try {
      const { stdout } = await execAsync('lpstat -a 2>/dev/null || echo ""')
      return stdout.trim().split('\n')
        .filter(Boolean)
        .map((line) => ({ name: line.split(' ')[0], isDefault: false }))
    } catch {
      return []
    }
  })
}

async function getDefaultPrinterName(): Promise<string> {
  try {
    const { stdout } = await execAsync('lpstat -d 2>/dev/null')
    const match = stdout.match(/system default destination:\s+(\S+)/)
    if (match) return match[1]
  } catch { /* fall through */ }
  return 'ZKT200'
}
