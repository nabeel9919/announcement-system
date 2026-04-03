import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

export function createOperatorWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    title: 'Announcement System — Operator',
    backgroundColor: '#09090b',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('ready-to-show', () => {
    win.show()
    win.focus()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in browser, not Electron
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

export function createKioskWindow(screenIndex = 0): BrowserWindow {
  const displays = screen.getAllDisplays()
  const targetDisplay = displays[screenIndex] ?? displays[0]
  const { x, y, width, height } = targetDisplay.bounds

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    title: 'Announcement System — Kiosk',
    backgroundColor: '#09090b',
    fullscreen: true,
    frame: false,
    skipTaskbar: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/kiosk`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'kiosk' })
  }

  win.setMenu(null)
  return win
}

export function createDisplayWindow(screenIndex = 1): BrowserWindow {
  const displays = screen.getAllDisplays()
  const targetDisplay = displays[screenIndex] ?? displays[displays.length - 1]
  const { x, y, width, height } = targetDisplay.bounds

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    title: 'Announcement System — Display',
    backgroundColor: '#09090b',
    fullscreen: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/display`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'display' })
  }

  win.setMenu(null)

  return win
}
