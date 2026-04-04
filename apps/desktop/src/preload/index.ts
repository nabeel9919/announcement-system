import { contextBridge, ipcRenderer } from 'electron'

/**
 * Exposes a safe, typed API to the renderer process via contextBridge.
 * All IPC communication goes through here — renderer never touches Node directly.
 */
const api = {
  // ─── Config ────────────────────────────────────────────────────────────
  config: {
    read: () => ipcRenderer.invoke('config:read'),
    write: (config: Record<string, unknown>) => ipcRenderer.invoke('config:write', config),
  },

  // ─── Tickets ───────────────────────────────────────────────────────────
  tickets: {
    list: (status?: string) => ipcRenderer.invoke('tickets:list', status),
    create: (ticket: Record<string, unknown>) => ipcRenderer.invoke('tickets:create', ticket),
    call: (ticketId: string, windowId: string) => ipcRenderer.invoke('tickets:call', ticketId, windowId),
    recall: (ticketId: string) => ipcRenderer.invoke('tickets:recall', ticketId),
    serve: (ticketId: string) => ipcRenderer.invoke('tickets:serve', ticketId),
    skip: (ticketId: string) => ipcRenderer.invoke('tickets:skip', ticketId),
    nextSequence: (categoryId: string) => ipcRenderer.invoke('tickets:nextSequence', categoryId),
    resetDay: () => ipcRenderer.invoke('tickets:resetDay'),
  },

  // ─── Categories ────────────────────────────────────────────────────────
  categories: {
    list: () => ipcRenderer.invoke('categories:list'),
    upsert: (category: Record<string, unknown>) => ipcRenderer.invoke('categories:upsert', category),
  },

  // ─── Windows ───────────────────────────────────────────────────────────
  windows: {
    list: () => ipcRenderer.invoke('windows:list'),
    upsert: (window: Record<string, unknown>) => ipcRenderer.invoke('windows:upsert', window),
  },

  // ─── Stats ─────────────────────────────────────────────────────────────
  stats: {
    today: () => ipcRenderer.invoke('stats:today'),
  },

  // ─── Display Window ────────────────────────────────────────────────────
  display: {
    open: (screenIndex: number) => ipcRenderer.invoke('display:open', screenIndex),
    close: () => ipcRenderer.invoke('display:close'),
    send: (payload: unknown) => ipcRenderer.invoke('display:send', payload),
    register: () => ipcRenderer.invoke('display:register'),
    onUpdate: (cb: (payload: unknown) => void) => {
      ipcRenderer.on('display:update', (_e, payload) => cb(payload))
    },
  },

  // ─── Updater ───────────────────────────────────────────────────────────
  updater: {
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onAvailable: (cb: (info: unknown) => void) => {
      ipcRenderer.on('update-available', (_e, info) => cb(info))
    },
    onProgress: (cb: (progress: unknown) => void) => {
      ipcRenderer.on('update-download-progress', (_e, p) => cb(p))
    },
    onDownloaded: (cb: () => void) => {
      ipcRenderer.on('update-downloaded', () => cb())
    },
  },

  // ─── License ───────────────────────────────────────────────────────────
  license: {
    validate: (key: string) => ipcRenderer.invoke('license:validate', key),
  },

  // ─── Print ─────────────────────────────────────────────────────────────
  print: {
    ticket: (ticket: Record<string, unknown>) => ipcRenderer.invoke('print:ticket', ticket),
    listPrinters: () => ipcRenderer.invoke('print:listPrinters'),
  },

  // ─── Kiosk Window ──────────────────────────────────────────────────────
  kiosk: {
    open: (screenIndex?: number) => ipcRenderer.invoke('kiosk:open', screenIndex ?? 0),
    close: () => ipcRenderer.invoke('kiosk:close'),
  },

  // ─── Navigation ────────────────────────────────────────────────────────
  onNavigate: (cb: (route: string) => void) => {
    ipcRenderer.on('navigate', (_e, route) => cb(route))
  },

  // ─── Shell ─────────────────────────────────────────────────────────────
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
