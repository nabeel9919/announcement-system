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
    setServerUrl: (url: string) => ipcRenderer.invoke('config:setServerUrl', url),
    getServerUrl: () => ipcRenderer.invoke('config:getServerUrl'),
    verifyPin: (pin: string): Promise<boolean> => ipcRenderer.invoke('config:verifyPin', pin),
    setPin: (pin: string): Promise<boolean> => ipcRenderer.invoke('config:setPin', pin),
  },

  // ─── Tickets ───────────────────────────────────────────────────────────
  tickets: {
    list: (status?: string) => ipcRenderer.invoke('tickets:list', status),
    create: (ticket: Record<string, unknown>) => ipcRenderer.invoke('tickets:create', ticket),
    call: (ticketId: string, windowId: string) => ipcRenderer.invoke('tickets:call', ticketId, windowId),
    recall: (ticketId: string) => ipcRenderer.invoke('tickets:recall', ticketId),
    serve: (ticketId: string) => ipcRenderer.invoke('tickets:serve', ticketId),
    skip: (ticketId: string) => ipcRenderer.invoke('tickets:skip', ticketId),
    noShow: (ticketId: string) => ipcRenderer.invoke('tickets:noShow', ticketId),
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
    waitTime: (categoryId?: string): Promise<{
      waitingAhead: number
      avgServiceSeconds: number
      estimatedWaitSeconds: number
      estimatedWaitMinutes: number
    }> => ipcRenderer.invoke('stats:waitTime', categoryId),
  },

  // ─── Audit log ─────────────────────────────────────────────────────────
  audit: {
    recent: (limit?: number): Promise<Record<string, unknown>[]> => ipcRenderer.invoke('audit:recent', limit),
  },

  // ─── Users / RBAC ──────────────────────────────────────────────────────
  users: {
    login: (username: string, password: string): Promise<Record<string, unknown> | null> =>
      ipcRenderer.invoke('users:login', username, password),
    list: (): Promise<Record<string, unknown>[]> => ipcRenderer.invoke('users:list'),
    upsert: (user: Record<string, unknown>): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('users:upsert', user),
    delete: (userId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('users:delete', userId),
    changePassword: (userId: string, oldPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('users:changePassword', userId, oldPassword, newPassword),
  },

  // ─── Display Window ────────────────────────────────────────────────────
  display: {
    /** Open display on a specific screen index (0 = primary, 1 = second, etc.) */
    open: (screenIndex: number) => ipcRenderer.invoke('display:open', screenIndex),
    /** Close display on a specific screen, or all displays if no index given */
    close: (screenIndex?: number) => ipcRenderer.invoke('display:close', screenIndex),
    /** Broadcast payload to ALL open display windows */
    send: (payload: unknown) => ipcRenderer.invoke('display:send', payload),
    /** Called by display page on mount to register itself */
    register: () => ipcRenderer.invoke('display:register'),
    onUpdate: (cb: (payload: unknown) => void) => {
      ipcRenderer.on('display:update', (_e, payload) => cb(payload))
    },
  },

  // ─── Screens ───────────────────────────────────────────────────────────
  screens: {
    /** List all connected displays with index, label, resolution, and display-open status */
    list: () => ipcRenderer.invoke('screens:list'),
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

  // ─── LAN server ────────────────────────────────────────────────────────
  lan: {
    /** Returns the LAN URL (e.g. http://192.168.1.5:4000) or null if not started */
    getUrl: (): Promise<string | null> => ipcRenderer.invoke('lan:getUrl'),
    /** Returns the current LAN API token (40-char hex) */
    getToken: (): Promise<string> => ipcRenderer.invoke('lan:getToken'),
    /** Called when a remote operator triggers an announcement via LAN */
    onAnnounce: (cb: (data: { text: string; displayNumber: string }) => void) => {
      ipcRenderer.on('lan:announce', (_e, data) => cb(data))
    },
  },

  // ─── Piper TTS ─────────────────────────────────────────────────────────
  piper: {
    /** Check if Piper binary + model are present for the given language */
    status: (lang?: string): Promise<{ available: boolean; binPath: string; modelPath: string | null }> =>
      ipcRenderer.invoke('piper:status', lang ?? 'sw'),
    /** Synthesize text — returns base64-encoded WAV string */
    synthesize: (text: string, lang?: string): Promise<string> =>
      ipcRenderer.invoke('piper:synthesize', text, lang ?? 'sw'),
  },

  // ─── Videos ────────────────────────────────────────────────────────────
  videos: {
    list: (): Promise<{ name: string; filePath: string; fileUrl: string; size: number; order: number }[]> =>
      ipcRenderer.invoke('videos:list'),
    add: (): Promise<{ name: string; filePath: string; fileUrl: string; size: number; order: number }[] | null> =>
      ipcRenderer.invoke('videos:add'),
    delete: (name: string): Promise<{ name: string; filePath: string; fileUrl: string; size: number; order: number }[]> =>
      ipcRenderer.invoke('videos:delete', name),
    reorder: (orderedNames: string[]): Promise<{ name: string; filePath: string; fileUrl: string; size: number; order: number }[]> =>
      ipcRenderer.invoke('videos:reorder', orderedNames),
    getDir: (): Promise<string> => ipcRenderer.invoke('videos:getDir'),
  },

  // ─── Global keyboard shortcuts ─────────────────────────────────────────────
  /** Fired when the user presses a global shortcut (F1/F2/F9) even when window is unfocused */
  onShortcut: (cb: (action: 'call-next' | 'recall-last' | 'toggle-mute') => void) => {
    ipcRenderer.on('shortcut', (_e, action) => cb(action))
  },

  // ─── Navigation ────────────────────────────────────────────────────────
  onNavigate: (cb: (route: string) => void) => {
    ipcRenderer.on('navigate', (_e, route) => cb(route))
  },

  // ─── Screen change notification ────────────────────────────────────────
  onScreensChanged: (cb: () => void) => {
    ipcRenderer.on('screens:changed', () => cb())
  },

  // ─── Feedback ──────────────────────────────────────────────────────────
  feedback: {
    /** Enabled questions for the kiosk feedback screen */
    listQuestions: (): Promise<unknown[]> => ipcRenderer.invoke('feedback:questions.list'),
    /** All questions including disabled — for Settings editor */
    listAllQuestions: (): Promise<unknown[]> => ipcRenderer.invoke('feedback:questions.listAll'),
    upsertQuestion: (q: unknown): Promise<unknown> => ipcRenderer.invoke('feedback:questions.upsert', q),
    deleteQuestion: (id: string): Promise<{ success: boolean }> => ipcRenderer.invoke('feedback:questions.delete', id),
    reorderQuestions: (ids: string[]): Promise<{ success: boolean }> => ipcRenderer.invoke('feedback:questions.reorder', ids),
    submit: (response: unknown): Promise<{ success: boolean; id: string }> => ipcRenderer.invoke('feedback:submit', response),
    listResponses: (days?: number): Promise<unknown[]> => ipcRenderer.invoke('feedback:responses.list', days),
    summary: (days?: number): Promise<{ total: number; ratings: unknown[]; choices: unknown[] }> => ipcRenderer.invoke('feedback:summary', days),
  },

  // ─── Kiosk Idle Config ─────────────────────────────────────────────────
  kioskIdleConfig: {
    get: (): Promise<unknown> => ipcRenderer.invoke('kiosk:idleConfig.get'),
    set: (cfg: unknown): Promise<{ success: boolean }> => ipcRenderer.invoke('kiosk:idleConfig.set', cfg),
  },

  // ─── Kiosk Questions ───────────────────────────────────────────────────
  kioskQuestions: {
    /** Questions for a specific category (+ global), enabled only */
    list: (categoryId?: string): Promise<unknown[]> =>
      ipcRenderer.invoke('kiosk:questions.list', categoryId),
    /** All questions including disabled — for the Settings editor */
    listAll: (): Promise<unknown[]> =>
      ipcRenderer.invoke('kiosk:questions.listAll'),
    upsert: (q: unknown): Promise<unknown> =>
      ipcRenderer.invoke('kiosk:questions.upsert', q),
    delete: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('kiosk:questions.delete', id),
    reorder: (ids: string[]): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('kiosk:questions.reorder', ids),
  },

  // ─── Shell ─────────────────────────────────────────────────────────────
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
