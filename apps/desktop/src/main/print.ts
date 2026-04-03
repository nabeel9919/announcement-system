import { BrowserWindow, ipcMain } from 'electron'

/**
 * Thermal ticket printing via Electron's print API.
 * Opens a hidden window, renders the ticket HTML, prints silently to default printer.
 */
export function setupPrintHandlers(): void {
  ipcMain.handle('print:ticket', async (_event, ticket: {
    displayNumber: string
    categoryLabel: string
    organizationName: string
    issuedAt: string
    windowCount: number
  }) => {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      const printWindow = new BrowserWindow({
        width: 320,
        height: 480,
        show: false,
        webPreferences: { javascript: true },
      })

      const html = buildTicketHtml(ticket)
      printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

      printWindow.webContents.once('did-finish-load', () => {
        printWindow.webContents.print(
          {
            silent: true,
            printBackground: true,
            margins: { marginType: 'none' },
            pageSize: { width: 80000, height: 160000 }, // 80mm × 160mm in microns
          },
          (success, errorType) => {
            printWindow.close()
            if (success) {
              resolve({ success: true })
            } else {
              resolve({ success: false, error: errorType ?? 'Print failed' })
            }
          }
        )
      })
    })
  })

  ipcMain.handle('print:listPrinters', async (_event) => {
    const win = new BrowserWindow({ show: false })
    const printers = await win.webContents.getPrintersAsync()
    win.close()
    return printers.map((p) => ({ name: p.name, isDefault: p.isDefault }))
  })
}

function buildTicketHtml(ticket: {
  displayNumber: string
  categoryLabel: string
  organizationName: string
  issuedAt: string
  windowCount: number
}): string {
  const time = new Date(ticket.issuedAt).toLocaleTimeString('en-TZ', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const date = new Date(ticket.issuedAt).toLocaleDateString('en-TZ', {
    day: '2-digit', month: 'short', year: 'numeric',
  })

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', monospace;
    width: 76mm;
    padding: 4mm;
    background: white;
    color: black;
    -webkit-print-color-adjust: exact;
  }
  .center { text-align: center; }
  .org {
    font-size: 11pt;
    font-weight: bold;
    text-align: center;
    border-bottom: 1px dashed #000;
    padding-bottom: 3mm;
    margin-bottom: 3mm;
  }
  .category {
    font-size: 9pt;
    text-align: center;
    color: #444;
    margin-bottom: 2mm;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .number {
    font-size: 44pt;
    font-weight: bold;
    text-align: center;
    letter-spacing: 2px;
    line-height: 1;
    margin: 4mm 0;
  }
  .divider {
    border-top: 1px dashed #000;
    margin: 3mm 0;
  }
  .meta {
    font-size: 8pt;
    text-align: center;
    color: #555;
    line-height: 1.6;
  }
  .footer {
    font-size: 7pt;
    text-align: center;
    color: #888;
    margin-top: 3mm;
    border-top: 1px dashed #000;
    padding-top: 2mm;
  }
</style>
</head>
<body>
  <div class="org">${ticket.organizationName}</div>
  <div class="category">${ticket.categoryLabel}</div>
  <div class="number">${ticket.displayNumber}</div>
  <div class="divider"></div>
  <div class="meta">
    <div>${date} &nbsp;·&nbsp; ${time}</div>
    <div>Please wait to be called</div>
  </div>
  <div class="footer">Powered by Announcement System</div>
</body>
</html>`
}
