import { ipcMain } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const execAsync = promisify(exec)
const isWin = process.platform === 'win32'

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

// ── Cross-platform printer helpers ───────────────────────────────────────────

async function listSystemPrinters(): Promise<{ name: string; isDefault: boolean }[]> {
  try {
    if (isWin) {
      const { stdout } = await execAsync('wmic printer get name,default /format:list 2>nul')
      const blocks = stdout.split(/\r?\n\r?\n/).filter(Boolean)
      return blocks.map((block) => {
        const name = (block.match(/Name=(.+)/) ?? [])[1]?.trim() ?? ''
        const def  = (block.match(/Default=(.+)/) ?? [])[1]?.trim().toLowerCase() === 'true'
        return { name, isDefault: def }
      }).filter((p) => p.name)
    } else {
      const { stdout } = await execAsync('lpstat -a 2>/dev/null || echo ""')
      return stdout.trim().split('\n').filter(Boolean)
        .map((line) => ({ name: line.split(' ')[0], isDefault: false }))
    }
  } catch {
    return []
  }
}

async function getDefaultPrinterName(): Promise<string> {
  try {
    if (isWin) {
      const { stdout } = await execAsync('wmic printer where "Default=True" get name /format:list 2>nul')
      const match = stdout.match(/Name=(.+)/)
      if (match) return match[1].trim()
    } else {
      const { stdout } = await execAsync('lpstat -d 2>/dev/null')
      const match = stdout.match(/system default destination:\s+(\S+)/)
      if (match) return match[1]
    }
  } catch { /* fall through */ }
  return isWin ? 'POS58' : 'ZKT200'
}

/** Send raw ESC/POS bytes to a printer — works on Windows and Linux */
async function printRaw(printerName: string, data: Buffer): Promise<void> {
  const tmpBin = join(tmpdir(), `ticket-${Date.now()}.bin`)
  await writeFile(tmpBin, data)

  if (isWin) {
    // Use a temporary PowerShell script to send raw bytes via winspool.drv
    const psFile = join(tmpdir(), `print-${Date.now()}.ps1`)
    const safePrinter = printerName.replace(/'/g, "''")
    const safeBin = tmpBin.replace(/\\/g, '\\\\')
    const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrint {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true)]
    public static extern bool OpenPrinter(string p, out IntPtr h, IntPtr d);
    [DllImport("winspool.Drv", EntryPoint="ClosePrinter")]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA")]
    public static extern Int32 StartDocPrinter(IntPtr h, Int32 l, [In,MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter")]
    public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter")]
    public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter")]
    public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr h, IntPtr buf, Int32 cnt, out Int32 written);
    public static bool Send(string printer, byte[] data) {
        IntPtr hP; var di = new DOCINFOA { pDocName="Ticket", pDataType="RAW" };
        if (!OpenPrinter(printer, out hP, IntPtr.Zero)) return false;
        StartDocPrinter(hP, 1, di); StartPagePrinter(hP);
        IntPtr ptr = Marshal.AllocCoTaskMem(data.Length);
        Marshal.Copy(data, 0, ptr, data.Length);
        Int32 w; bool ok = WritePrinter(hP, ptr, data.Length, out w);
        Marshal.FreeCoTaskMem(ptr);
        EndPagePrinter(hP); EndDocPrinter(hP); ClosePrinter(hP); return ok;
    }
}
"@
[RawPrint]::Send('${safePrinter}', [System.IO.File]::ReadAllBytes('${safeBin}'))
`
    await writeFile(psFile, psScript, 'utf8')
    await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`)
    await unlink(psFile).catch(() => {})
  } else {
    await execAsync(`lp -d "${printerName}" -o raw -o page-left=0 -o page-right=0 -o page-top=0 -o page-bottom=0 "${tmpBin}"`)
  }
  await unlink(tmpBin).catch(() => {})
}

export function setupPrintHandlers(): void {
  ipcMain.handle('print:ticket', async (_event, ticket: PrintTicketOptions) => {
    try {
      const printerName = await getDefaultPrinterName()
      await printRaw(printerName, buildEscPosTicket(ticket))
      return { success: true }
    } catch (e: unknown) {
      console.error('[print:ticket] error:', e)
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('print:listPrinters', async () => {
    return listSystemPrinters().catch(() => [])
  })
}
