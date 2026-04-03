import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { createOperatorWindow, createDisplayWindow } from './windows'
import { setupIpcHandlers } from './ipc'
import { checkLicense } from './license'

let operatorWindow: BrowserWindow | null = null
let displayWindow: BrowserWindow | null = null

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.announcement.system')

  // DevTools shortcut in dev only
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register all IPC handlers
  setupIpcHandlers()

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

// Expose display window management to renderer
ipcMain.handle('display:open', async (_event, screenIndex: number) => {
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.focus()
    return
  }
  displayWindow = createDisplayWindow(screenIndex)
})

ipcMain.handle('display:close', () => {
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.close()
    displayWindow = null
  }
})

ipcMain.handle('display:send', (_event, payload: unknown) => {
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.webContents.send('display:update', payload)
  }
})

ipcMain.handle('shell:openExternal', (_event, url: string) => {
  shell.openExternal(url)
})
