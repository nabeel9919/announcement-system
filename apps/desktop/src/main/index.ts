import { app, BrowserWindow, ipcMain, shell, screen, protocol, globalShortcut } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { createOperatorWindow, createDisplayWindow, createKioskWindow, getScreenList } from './windows'
import { setupIpcHandlers, getDb, registerVideoProtocol } from './ipc'
import { setupPrintHandlers } from './print'
import { checkLicense } from './license'
import { LanServer } from './lan-server'
import { scheduleDbBackup } from './db-backup'
import { scheduleEmailReports } from './email-reporter'

// Register custom scheme before app is ready (required by Electron)
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-video', privileges: { secure: true, supportFetchAPI: true, stream: true } },
])

let operatorWindow: BrowserWindow | null = null
/** Map of screenIndex → display BrowserWindow (supports multi-screen) */
const displayWindows = new Map<number, BrowserWindow>()
let lanServer: LanServer | null = null
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

  // Schedule automatic daily DB backup (runs once now + every midnight)
  scheduleDbBackup()

  // Schedule automated email reports (daily + weekly digest)
  scheduleEmailReports(() => getDb())

  // Register local-video:// protocol for serving userData video files
  registerVideoProtocol()

  // Create operator window
  operatorWindow = createOperatorWindow()

  // ── Global keyboard shortcuts (work even when window is not focused) ─────────
  // F1 = Call Next, F2 = Recall Last, F9 = Toggle Mute
  const SHORTCUTS: Record<string, string> = {
    F1: 'call-next',
    F2: 'recall-last',
    F9: 'toggle-mute',
  }
  for (const [key, action] of Object.entries(SHORTCUTS)) {
    globalShortcut.register(key, () => {
      const win = operatorWindow
      if (win && !win.isDestroyed()) {
        win.webContents.send('shortcut', action)
      }
    })
  }

  // ── Auto HDMI / external display detection ────────────────────────────────
  screen.on('display-added', (_event, display) => {
    const idx = screen.getAllDisplays().findIndex((d) => d.id === display.id)
    if (idx > 0) {
      console.log(`[Screen] External display connected at index ${idx} — opening display window`)
      const win = createDisplayWindow(idx)
      displayWindows.set(idx, win)
      win.on('closed', () => {
        displayWindows.delete(idx)
      })
      // Notify operator window so the screen list refreshes
      operatorWindow?.webContents.send('screens:changed')
    }
  })

  screen.on('display-removed', (_event, display) => {
    const idx = Array.from(displayWindows.keys()).find((k) => {
      const win = displayWindows.get(k)
      if (!win || win.isDestroyed()) return false
      const bounds = win.getBounds()
      return bounds.x >= display.bounds.x && bounds.x < display.bounds.x + display.bounds.width
    })
    if (idx !== undefined) {
      const win = displayWindows.get(idx)
      if (win && !win.isDestroyed()) win.close()
      displayWindows.delete(idx)
      operatorWindow?.webContents.send('screens:changed')
    }
  })

  // Start LAN server — staff on other PCs open the URL in their browser
  lanServer = new LanServer(
    () => getDb(),
    () => operatorWindow,
  )
  lanServer.start().then(() => {
    // Register URL and token getters so ipc.ts can return them
    ;(global as any).__setLanUrlGetter(() => lanServer?.getUrl() ?? null)
    ;(global as any).__setLanTokenGetter(() => lanServer?.getToken() ?? '')
    ;(global as any).__setLanKioskTokenGetter(() => lanServer?.getKioskToken() ?? '')
  }).catch((err) => {
    console.error('[LAN] Failed to start:', err)
  })

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

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  lanServer?.stop().catch(() => {})
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
