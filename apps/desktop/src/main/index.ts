import { app, BrowserWindow, ipcMain, shell, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { createOperatorWindow, createDisplayWindow, createKioskWindow, getScreenList } from './windows'
import { setupIpcHandlers } from './ipc'
import { setupPrintHandlers } from './print'
import { checkLicense } from './license'

let operatorWindow: BrowserWindow | null = null
/** Map of screenIndex → display BrowserWindow (supports multi-screen) */
const displayWindows = new Map<number, BrowserWindow>()
let kioskWindow: BrowserWindow | null = null

// Legacy single-window ref kept for display:register compatibility
let displayWindow: BrowserWindow | null = null

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

  // Check license on startup — wait for renderer to load first
  const licenseStatus = await checkLicense()
  if (licenseStatus !== 'ok') {
    const route = licenseStatus === 'expired' ? '/expired' : '/setup'
    const sendNav = () => operatorWindow!.webContents.send('navigate', route)
    if (operatorWindow.webContents.isLoading()) {
      operatorWindow.webContents.once('did-finish-load', sendNav)
    } else {
      sendNav()
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

/** All live display windows (values of displayWindows map + fallback scan) */
function getAllDisplayWindows(): BrowserWindow[] {
  // Collect from map, filtering destroyed ones
  const fromMap = Array.from(displayWindows.values()).filter((w) => !w.isDestroyed())

  // Fallback: also pick up any display windows opened outside the map (e.g. registered via display:register)
  const scanned = BrowserWindow.getAllWindows().filter((w) => {
    if (fromMap.includes(w)) return false
    try { return w.webContents.getURL().includes('display') } catch { return false }
  })

  return [...fromMap, ...scanned]
}

/** Broadcast a payload to all open display windows */
function broadcastToDisplays(payload: unknown) {
  const wins = getAllDisplayWindows()
  if (wins.length === 0) {
    console.warn('[display:send] No display windows open — payload dropped')
    return
  }
  wins.forEach((w) => w.webContents.send('display:update', payload))
}

// ── Display window IPC ────────────────────────────────────────────────────────

/** Open a display window on a specific screen (or move to front if already open) */
ipcMain.handle('display:open', async (_event, screenIndex: number) => {
  const existing = displayWindows.get(screenIndex)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return { opened: false, screenIndex }
  }
  const win = createDisplayWindow(screenIndex)
  displayWindows.set(screenIndex, win)
  displayWindow = win  // keep legacy ref for display:register
  win.on('closed', () => {
    displayWindows.delete(screenIndex)
    if (displayWindow === win) displayWindow = null
  })
  return { opened: true, screenIndex }
})

/** Close display window(s) — omit screenIndex to close all */
ipcMain.handle('display:close', (_event, screenIndex?: number) => {
  if (screenIndex !== undefined) {
    const win = displayWindows.get(screenIndex)
    if (win && !win.isDestroyed()) { win.close() }
    displayWindows.delete(screenIndex)
  } else {
    // Close all display windows
    getAllDisplayWindows().forEach((w) => { if (!w.isDestroyed()) w.close() })
    displayWindows.clear()
    displayWindow = null
  }
})

/** Send payload to ALL open display windows */
ipcMain.handle('display:send', (_event, payload: unknown) => {
  broadcastToDisplays(payload)
})

/** Return list of connected screens with status */
ipcMain.handle('screens:list', () => {
  const screens = getScreenList()
  return screens.map((s) => ({
    ...s,
    hasDisplay: displayWindows.has(s.index) && !displayWindows.get(s.index)!.isDestroyed(),
  }))
})

/** Allow display window to register itself — called on display page mount */
ipcMain.handle('display:register', (_event) => {
  const senderContents = _event.sender
  const win = BrowserWindow.getAllWindows().find((w) => w.webContents === senderContents)
  if (win) {
    displayWindow = win
    // Find which screen index this window is on and register it in the map
    const winBounds = win.getBounds()
    const displays = screen.getAllDisplays()
    const idx = displays.findIndex((d) =>
      winBounds.x >= d.bounds.x && winBounds.x < d.bounds.x + d.bounds.width
    )
    const screenIdx = idx >= 0 ? idx : 0
    displayWindows.set(screenIdx, win)
    console.log(`[display] Window registered on screen ${screenIdx}`)
  }
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
