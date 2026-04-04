import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

function rendererURL(hash?: string): string {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return hash
      ? `${process.env['ELECTRON_RENDERER_URL']}#/${hash}`
      : process.env['ELECTRON_RENDERER_URL']
  }
  return ''
}

function sharedPrefs() {
  return {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false,
    contextIsolation: true,
    nodeIntegration: false,
  }
}

// ── Screen utilities ──────────────────────────────────────────────────────────

export function getScreenList() {
  return screen.getAllDisplays().map((d, idx) => ({
    index: idx,
    id: d.id,
    label: `Screen ${idx + 1}${idx === 0 ? ' (Primary)' : ''}`,
    width: d.bounds.width,
    height: d.bounds.height,
    scaleFactor: d.scaleFactor,
    isPrimary: idx === 0,
  }))
}

// ── Operator window ───────────────────────────────────────────────────────────

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
    webPreferences: sharedPrefs(),
  })

  win.on('ready-to-show', () => {
    win.show()
    win.focus()
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// ── Display window ────────────────────────────────────────────────────────────

export function createDisplayWindow(screenIndex = 1): BrowserWindow {
  const displays = screen.getAllDisplays()
  // Fall back to last display if index out of range
  const target = displays[screenIndex] ?? displays[displays.length - 1]
  const { x, y, width, height } = target.bounds

  // In dev: open as a normal resizable window on the primary screen (easier to test)
  const devOptions = is.dev
    ? {
        x: Math.round(x + width * 0.5),
        y: Math.round(y + 20),
        width: Math.round(width * 0.48),
        height: Math.round(height * 0.9),
        fullscreen: false,
        alwaysOnTop: false,
        frame: true,
      }
    : {
        x,
        y,
        width,
        height,
        fullscreen: true,
        alwaysOnTop: true,
        frame: false,
      }

  const win = new BrowserWindow({
    ...devOptions,
    title: `Announcement System — Display (Screen ${screenIndex + 1})`,
    backgroundColor: '#09090b',
    skipTaskbar: !is.dev,
    autoHideMenuBar: true,
    webPreferences: sharedPrefs(),
  })

  const url = rendererURL('display')
  if (url) {
    win.loadURL(url)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'display' })
  }

  win.setMenu(null)
  return win
}

// ── Kiosk window ──────────────────────────────────────────────────────────────

export function createKioskWindow(screenIndex = 0): BrowserWindow {
  const displays = screen.getAllDisplays()
  const target = displays[screenIndex] ?? displays[0]
  const { x, y, width, height } = target.bounds

  const devOptions = is.dev
    ? {
        x: Math.round(x + width * 0.02),
        y: Math.round(y + 20),
        width: Math.round(width * 0.46),
        height: Math.round(height * 0.9),
        fullscreen: false,
        frame: true,
        kiosk: false,
      }
    : {
        x,
        y,
        width,
        height,
        fullscreen: true,
        frame: false,
        kiosk: true,
      }

  const win = new BrowserWindow({
    ...devOptions,
    title: `Announcement System — Kiosk (Screen ${screenIndex + 1})`,
    backgroundColor: '#09090b',
    skipTaskbar: false,
    autoHideMenuBar: true,
    webPreferences: sharedPrefs(),
  })

  const url = rendererURL('kiosk')
  if (url) {
    win.loadURL(url)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'kiosk' })
  }

  win.setMenu(null)
  return win
}
