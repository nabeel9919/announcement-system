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

function buildEscPosTicket(ticket: {
  displayNumber: string
  categoryLabel: string
  organizationName: string
  issuedAt: string
}): Buffer {
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
  parts.push(esc(0x45, 0x01))                  // ESC E 1 — bold on
  parts.push(text(ticket.organizationName))
  parts.push(lf())
  parts.push(esc(0x45, 0x00))                  // ESC E 0 — bold off

  // Divider
  parts.push(text('--------------------------------'))
  parts.push(lf())

  // Category
  parts.push(text(ticket.categoryLabel.toUpperCase()))
  parts.push(lf())
  parts.push(lf())

  // Big ticket number — double width + height
  parts.push(gs(0x21, 0x33))                   // GS ! — 4x width, 4x height
  parts.push(esc(0x45, 0x01))
  parts.push(text(ticket.displayNumber))
  parts.push(lf())
  parts.push(gs(0x21, 0x00))                   // reset size
  parts.push(esc(0x45, 0x00))

  // Divider
  parts.push(text('--------------------------------'))
  parts.push(lf())

  // Date/time
  parts.push(text(`${date}  ${time}`))
  parts.push(lf())
  parts.push(text('Please wait to be called'))
  parts.push(lf())

  // Footer
  parts.push(text('--------------------------------'))
  parts.push(lf())
  parts.push(text('Powered by Announcement System'))
  parts.push(lf())

  // Feed and cut
  parts.push(lf())
  parts.push(lf())
  parts.push(lf())
  parts.push(gs(0x56, 0x00))                   // GS V 0 — full cut

  return Buffer.concat(parts)
}

export function setupPrintHandlers(): void {
  ipcMain.handle('print:ticket', async (_event, ticket: {
    displayNumber: string
    categoryLabel: string
    organizationName: string
    issuedAt: string
    windowCount: number
  }) => {
    try {
      const printerName = await getDefaultPrinterName()
      const data = buildEscPosTicket(ticket)

      // Write to temp file and send via lp -o raw
      const tmpFile = join(tmpdir(), `ticket-${Date.now()}.bin`)
      await writeFile(tmpFile, data)
      await execAsync(`lp -d ${printerName} -o raw "${tmpFile}"`)
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
