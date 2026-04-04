import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { createOperatorWindow, createDisplayWindow, createKioskWindow } from './windows'
import { setupIpcHandlers } from './ipc'
import { setupPrintHandlers } from './print'
import { checkLicense } from './license'

let operatorWindow: BrowserWindow | null = null
let displayWindow: BrowserWindow | null = null
let kioskWindow: BrowserWindow | null = null

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.announcement.system')

  // DevTools shortcut in dev only
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register all IPC handlers
  setupIpcHandlers()
  setupPrintHandlers()

  // Create operator window
  operatorWindow = createOperatorWindow()

  // Check license on startup
  const licenseValid = await checkLicense()
  if (!licenseValid) {
    // Route to setup/activation page
    if (is.dev) {
      operatorWindow.webContents.send('navigate', '/setup')
    }
  }

  // Setup auto-updater (production only)
  if (!is.dev) {
    setupAutoUpdater(operatorWindow)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      operatorWindow = createOperatorWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function setupAutoUpdater(win: BrowserWindow) {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    win.webContents.send('update-available', info)
  })

  autoUpdater.on('download-progress', (progress) => {
    win.webContents.send('update-download-progress', progress)
  })

  autoUpdater.on('update-downloaded', () => {
    win.webContents.send('update-downloaded')
  })

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err)
  })

  // Check on startup, then every 4 hours
  autoUpdater.checkForUpdates().catch(console.error)
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(console.error)
  }, 4 * 60 * 60 * 1000)

  // IPC: operator triggered update download
  ipcMain.handle('updater:download', () => autoUpdater.downloadUpdate())
  ipcMain.handle('updater:install', () => autoUpdater.quitAndInstall())
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Find the live display window — stored ref first, fallback scan all windows */
function getDisplayWindow(): BrowserWindow | null {
  if (displayWindow && !displayWindow.isDestroyed()) return displayWindow
  // Fallback: scan all open windows for the one loaded as display
  const found = BrowserWindow.getAllWindows().find((w) => {
    try { return w.webContents.getURL().includes('display') } catch { return false }
  })
  if (found) { displayWindow = found; return found }
  return null
}

// ── Display window IPC ────────────────────────────────────────────────────────

ipcMain.handle('display:open', async (_event, screenIndex: number) => {
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.focus()
    return
  }
  displayWindow = createDisplayWindow(screenIndex)
  displayWindow.on('closed', () => { displayWindow = null })
})

ipcMain.handle('display:close', () => {
  const win = getDisplayWindow()
  if (win) { win.close(); displayWindow = null }
})

ipcMain.handle('display:send', (_event, payload: unknown) => {
  const win = getDisplayWindow()
  if (win) {
    win.webContents.send('display:update', payload)
  } else {
    console.warn('[display:send] No display window found — payload dropped')
  }
})

// Allow display window to register itself (called on display page mount)
ipcMain.handle('display:register', (_event) => {
  const senderContents = _event.sender
  const win = BrowserWindow.getAllWindows().find((w) => w.webContents === senderContents)
  if (win) { displayWindow = win; console.log('[display] Window registered') }
})

ipcMain.handle('kiosk:open', async (_event, screenIndex: number) => {
  if (kioskWindow && !kioskWindow.isDestroyed()) {
    kioskWindow.focus()
    return
  }
  kioskWindow = createKioskWindow(screenIndex ?? 0)
  kioskWindow.on('closed', () => { kioskWindow = null })
})

ipcMain.handle('kiosk:close', () => {
  if (kioskWindow && !kioskWindow.isDestroyed()) {
    kioskWindow.close()
    kioskWindow = null
  }
})

ipcMain.handle('shell:openExternal', (_event, url: string) => {
  shell.openExternal(url)
})
