import { ipcMain, app, protocol, net } from 'electron'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { readLocalConfig, writeLocalConfig } from './license'
import { isPiperAvailable, synthesizeWithPiper, getPiperBin, getPiperModel } from './piper-synth'
import { listVideos, addVideo, deleteVideo, reorderVideos, getVideosDir } from './video-manager'
import type { UserRole } from '@announcement/shared'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = join(app.getPath('userData'), 'queue.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    initSchema(db)
  }
  return db
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      display_number TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      category_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      created_at TEXT NOT NULL,
      called_at TEXT,
      served_at TEXT,
      window_id TEXT,
      callee_name TEXT,
      recall_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      window_ids TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#3B82F6',
      prefix TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS windows (
      id TEXT PRIMARY KEY,
      number INTEGER NOT NULL,
      label TEXT NOT NULL,
      operator_name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      current_ticket_id TEXT
    );

    CREATE TABLE IF NOT EXISTS call_log (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      window_id TEXT NOT NULL,
      called_at TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'initial'
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator',
      window_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      event TEXT NOT NULL,
      ticket_id TEXT,
      display_number TEXT,
      window_id TEXT,
      window_label TEXT,
      operator_name TEXT,
      category_id TEXT,
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_category ON tickets(category_id);
    CREATE INDEX IF NOT EXISTS idx_call_log_date ON call_log(called_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(timestamp);
  `)
}

function logAuditEvent(
  db: Database.Database,
  event: string,
  ticketId?: string | null,
  displayNumber?: string | null,
  windowId?: string | null,
  categoryId?: string | null,
  notes?: string | null,
): void {
  const windowLabel = windowId
    ? (db.prepare('SELECT label FROM windows WHERE id = ?').get(windowId) as any)?.label ?? null
    : null
  db.prepare(`
    INSERT INTO audit_log (id, timestamp, event, ticket_id, display_number, window_id, window_label, category_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    new Date().toISOString(),
    event,
    ticketId ?? null,
    displayNumber ?? null,
    windowId ?? null,
    windowLabel,
    categoryId ?? null,
    notes ?? null,
  )
}

export function setupIpcHandlers(): void {
  // ─── License validation ───────────────────────────────────────────────────

  ipcMain.handle('license:validate', async (_event, key: string) => {
    try {
      const mod = await import('node-machine-id')
      const getMachineId = mod.machineId ?? mod.default?.machineId
      const machineId = await getMachineId()
      const config = readLocalConfig()
      const serverUrl = config.licenseServerUrl ?? process.env.LICENSE_SERVER_URL ?? 'http://localhost:3001'

      const res = await fetch(`${serverUrl}/api/licenses/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, machineId }),
        signal: AbortSignal.timeout(10_000),
      })
      return await res.json()
    } catch (e) {
      console.error('[license:validate] error:', e)
      return { valid: false, error: 'Cannot reach license server. Make sure it is running on port 3001.' }
    }
  })

  // ─── Config ──────────────────────────────────────────────────────────────

  ipcMain.handle('config:read', () => readLocalConfig())

  /** Verify admin PIN — returns true/false */
  ipcMain.handle('config:verifyPin', (_event, pin: string) => {
    const config = readLocalConfig()
    const stored = (config as any).adminPin ?? '0000'
    return pin === stored
  })

  /** Set a new admin PIN */
  ipcMain.handle('config:setPin', (_event, pin: string) => {
    writeLocalConfig({ adminPin: pin } as any)
    return true
  })

  ipcMain.handle('config:write', (_event, config: Record<string, unknown>) => {
    writeLocalConfig(config)
    return true
  })

  ipcMain.handle('config:setServerUrl', (_event, url: string) => {
    writeLocalConfig({ licenseServerUrl: url.trim() || undefined })
    return true
  })

  ipcMain.handle('config:getServerUrl', () => {
    const config = readLocalConfig()
    return config.licenseServerUrl ?? process.env.LICENSE_SERVER_URL ?? 'http://localhost:3001'
  })

  // ─── Tickets ─────────────────────────────────────────────────────────────

  function mapTicket(row: any) {
    return {
      id: row.id,
      displayNumber: row.display_number,
      sequenceNumber: row.sequence_number,
      categoryId: row.category_id,
      status: row.status,
      createdAt: row.created_at,
      calledAt: row.called_at ?? undefined,
      servedAt: row.served_at ?? undefined,
      windowId: row.window_id ?? undefined,
      calleeName: row.callee_name ?? undefined,
      recallCount: row.recall_count ?? 0,
    }
  }

  function mapCategory(row: any) {
    return {
      id: row.id,
      code: row.code,
      label: row.label,
      windowIds: JSON.parse(row.window_ids ?? '[]'),
      color: row.color,
      prefix: row.prefix,
    }
  }

  function mapWindow(row: any) {
    return {
      id: row.id,
      number: row.number,
      label: row.label,
      operatorName: row.operator_name ?? undefined,
      isActive: row.is_active === 1,
      currentTicketId: row.current_ticket_id ?? undefined,
    }
  }

  ipcMain.handle('tickets:list', (_event, status?: string) => {
    const db = getDb()
    const rows = status
      ? db.prepare('SELECT * FROM tickets WHERE status = ? ORDER BY sequence_number ASC').all(status)
      : db.prepare('SELECT * FROM tickets ORDER BY sequence_number ASC').all()
    return (rows as any[]).map(mapTicket)
  })

  ipcMain.handle('tickets:create', (_event, ticket: Record<string, unknown>) => {
    const db = getDb()
    db.prepare(`
      INSERT INTO tickets (id, display_number, sequence_number, category_id, status, created_at, callee_name, recall_count)
      VALUES (@id, @display_number, @sequence_number, @category_id, 'waiting', @created_at, @callee_name, 0)
    `).run({
      id: ticket.id,
      display_number: ticket.displayNumber,
      sequence_number: ticket.sequenceNumber,
      category_id: ticket.categoryId,
      created_at: ticket.createdAt ?? new Date().toISOString(),
      callee_name: ticket.calleeName ?? null,
    })
    logAuditEvent(db, 'ticket_issued', ticket.id as string, ticket.displayNumber as string, null, ticket.categoryId as string)
    return ticket
  })

  ipcMain.handle('tickets:call', (_event, ticketId: string, windowId: string) => {
    const db = getDb()
    const now = new Date().toISOString()
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as any
    db.prepare(`
      UPDATE tickets SET status = 'called', called_at = ?, window_id = ?, recall_count = recall_count + 1
      WHERE id = ?
    `).run(now, windowId, ticketId)
    db.prepare(`UPDATE windows SET current_ticket_id = ? WHERE id = ?`).run(ticketId, windowId)
    db.prepare(`
      INSERT INTO call_log (id, ticket_id, window_id, called_at, type)
      VALUES (?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), ticketId, windowId, now, 'initial')
    logAuditEvent(db, 'ticket_called', ticketId, ticket?.display_number, windowId, ticket?.category_id)
    return { success: true }
  })

  ipcMain.handle('tickets:recall', (_event, ticketId: string) => {
    const db = getDb()
    const now = new Date().toISOString()
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as any
    if (!ticket) return { success: false }
    db.prepare(`UPDATE tickets SET recall_count = recall_count + 1 WHERE id = ?`).run(ticketId)
    db.prepare(`
      INSERT INTO call_log (id, ticket_id, window_id, called_at, type)
      VALUES (?, ?, ?, ?, 'recall')
    `).run(crypto.randomUUID(), ticketId, ticket.window_id, now)
    logAuditEvent(db, 'ticket_recalled', ticketId, ticket.display_number, ticket.window_id, ticket.category_id)
    return { success: true }
  })

  ipcMain.handle('tickets:serve', (_event, ticketId: string) => {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(`
      UPDATE tickets SET status = 'served', served_at = ? WHERE id = ?
    `).run(now, ticketId)
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as any
    if (ticket?.window_id) {
      db.prepare(`UPDATE windows SET current_ticket_id = NULL WHERE id = ?`).run(ticket.window_id)
    }
    logAuditEvent(db, 'ticket_served', ticketId, ticket?.display_number, ticket?.window_id, ticket?.category_id)
    return { success: true }
  })

  ipcMain.handle('tickets:skip', (_event, ticketId: string) => {
    const db = getDb()
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as any
    db.prepare(`UPDATE tickets SET status = 'skipped' WHERE id = ?`).run(ticketId)
    logAuditEvent(db, 'ticket_skipped', ticketId, ticket?.display_number, ticket?.window_id, ticket?.category_id)
    return { success: true }
  })

  ipcMain.handle('tickets:noShow', (_event, ticketId: string) => {
    const db = getDb()
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as any
    db.prepare(`UPDATE tickets SET status = 'no_show' WHERE id = ?`).run(ticketId)
    if (ticket?.window_id) {
      db.prepare(`UPDATE windows SET current_ticket_id = NULL WHERE id = ?`).run(ticket.window_id)
    }
    logAuditEvent(db, 'ticket_no_show', ticketId, ticket?.display_number, ticket?.window_id, ticket?.category_id)
    return { success: true }
  })

  ipcMain.handle('tickets:nextSequence', (_event, categoryId: string) => {
    const db = getDb()
    const today = new Date().toISOString().slice(0, 10)
    const result = db.prepare(
      `SELECT MAX(sequence_number) as max FROM tickets WHERE category_id = ? AND created_at LIKE ?`
    ).get(categoryId, `${today}%`) as { max: number | null }
    return (result.max ?? 0) + 1
  })

  ipcMain.handle('tickets:resetDay', () => {
    const db = getDb()
    logAuditEvent(db, 'day_reset')
    db.prepare(`DELETE FROM tickets`).run()
    db.prepare(`UPDATE windows SET current_ticket_id = NULL`).run()
    return { success: true }
  })

  // ─── Categories ───────────────────────────────────────────────────────────

  ipcMain.handle('categories:list', () => {
    const db = getDb()
    return (db.prepare('SELECT * FROM categories').all() as any[]).map(mapCategory)
  })

  ipcMain.handle('categories:upsert', (_event, category: Record<string, unknown>) => {
    const db = getDb()
    db.prepare(`
      INSERT INTO categories (id, code, label, window_ids, color, prefix)
      VALUES (@id, @code, @label, @window_ids, @color, @prefix)
      ON CONFLICT(id) DO UPDATE SET
        code = @code, label = @label, window_ids = @window_ids,
        color = @color, prefix = @prefix
    `).run({
      id: category.id,
      code: category.code,
      label: category.label,
      window_ids: JSON.stringify(category.windowIds ?? []),
      color: category.color,
      prefix: category.prefix,
    })
    return { success: true }
  })

  // ─── Windows ─────────────────────────────────────────────────────────────

  ipcMain.handle('windows:list', () => {
    const db = getDb()
    return (db.prepare('SELECT * FROM windows ORDER BY number ASC').all() as any[]).map(mapWindow)
  })

  ipcMain.handle('windows:upsert', (_event, window: Record<string, unknown>) => {
    const db = getDb()
    db.prepare(`
      INSERT INTO windows (id, number, label, operator_name, is_active)
      VALUES (@id, @number, @label, @operator_name, 1)
      ON CONFLICT(id) DO UPDATE SET
        number = @number, label = @label, operator_name = @operator_name
    `).run({
      id: window.id,
      number: window.number,
      label: window.label,
      operator_name: window.operatorName ?? null,
    })
    return { success: true }
  })

  // ─── Stats ────────────────────────────────────────────────────────────────

  ipcMain.handle('stats:today', () => {
    const db = getDb()
    const today = new Date().toISOString().slice(0, 10)
    const q = (status: string) =>
      (db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE status = ? AND created_at LIKE ?`).get(status, `${today}%`) as any).c
    return {
      waiting: q('waiting'),
      called: q('called'),
      served: q('served'),
      skipped: q('skipped'),
      noShow: q('no_show'),
    }
  })

  ipcMain.handle('stats:waitTime', (_event, categoryId?: string) => {
    const db = getDb()
    const today = new Date().toISOString().slice(0, 10)

    // Waiting tickets ahead (all waiting tickets today, filtered by category if given)
    const waitingCount = categoryId
      ? (db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE status = 'waiting' AND category_id = ? AND created_at LIKE ?`).get(categoryId, `${today}%`) as any).c
      : (db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE status = 'waiting' AND created_at LIKE ?`).get(`${today}%`) as any).c

    // Average service time from today's completed tickets (created → served)
    let avgSeconds: number | null = null
    const catAvg = categoryId
      ? (db.prepare(`SELECT AVG((julianday(served_at) - julianday(created_at)) * 86400) as s FROM tickets WHERE status = 'served' AND category_id = ? AND created_at LIKE ? AND served_at IS NOT NULL`).get(categoryId, `${today}%`) as any)?.s
      : null
    if (catAvg) {
      avgSeconds = catAvg
    } else {
      // Fall back to overall average across all categories today
      const overallAvg = (db.prepare(`SELECT AVG((julianday(served_at) - julianday(created_at)) * 86400) as s FROM tickets WHERE status = 'served' AND created_at LIKE ? AND served_at IS NOT NULL`).get(`${today}%`) as any)?.s
      avgSeconds = overallAvg ?? null
    }

    const DEFAULT_SERVICE_SECONDS = 5 * 60 // 5 min fallback when no history yet
    const serviceTime = avgSeconds ?? DEFAULT_SERVICE_SECONDS
    const estimatedWaitSeconds = Math.round(waitingCount * serviceTime)

    return {
      waitingAhead: waitingCount,
      avgServiceSeconds: Math.round(serviceTime),
      estimatedWaitSeconds,
      estimatedWaitMinutes: Math.ceil(estimatedWaitSeconds / 60),
    }
  })

  ipcMain.handle('audit:recent', (_event, limit = 100) => {
    const db = getDb()
    return db.prepare(`SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?`).all(limit)
  })

  // ─── Users / RBAC ────────────────────────────────────────────────────────

  function hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex')
  }

  function mapUser(row: any) {
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role as UserRole,
      windowId: row.window_id ?? undefined,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at ?? undefined,
    }
  }

  /** Seed a default admin account on first run if no users exist */
  function seedDefaultAdmin(db: Database.Database): void {
    const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c
    if (count === 0) {
      db.prepare(`
        INSERT INTO users (id, username, display_name, password_hash, role, is_active, created_at)
        VALUES (?, 'admin', 'Administrator', ?, 'admin', 1, ?)
      `).run(crypto.randomUUID(), hashPassword('admin1234'), new Date().toISOString())
      console.log('[RBAC] Default admin seeded — username: admin, password: admin1234')
    }
  }
  seedDefaultAdmin(getDb())

  /** Authenticate user — returns user object (without hash) or null */
  ipcMain.handle('users:login', (_event, username: string, password: string) => {
    const db = getDb()
    const row = db.prepare(`SELECT * FROM users WHERE username = ? AND is_active = 1`).get(username) as any
    if (!row || row.password_hash !== hashPassword(password)) return null
    db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(new Date().toISOString(), row.id)
    logAuditEvent(db, 'user_login', null, null, null, null, `user:${row.username} role:${row.role}`)
    return mapUser(row)
  })

  ipcMain.handle('users:list', () => {
    const db = getDb()
    return (db.prepare(`SELECT * FROM users ORDER BY display_name ASC`).all() as any[]).map(mapUser)
  })

  ipcMain.handle('users:upsert', (_event, user: Record<string, unknown>) => {
    const db = getDb()
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(user.id) as any
    if (existing) {
      // Update — only update password if provided
      if (user.password) {
        db.prepare(`
          UPDATE users SET username = ?, display_name = ?, password_hash = ?, role = ?, window_id = ?, is_active = ?
          WHERE id = ?
        `).run(user.username, user.displayName, hashPassword(user.password as string), user.role, user.windowId ?? null, user.isActive ? 1 : 0, user.id)
      } else {
        db.prepare(`
          UPDATE users SET username = ?, display_name = ?, role = ?, window_id = ?, is_active = ?
          WHERE id = ?
        `).run(user.username, user.displayName, user.role, user.windowId ?? null, user.isActive ? 1 : 0, user.id)
      }
    } else {
      db.prepare(`
        INSERT INTO users (id, username, display_name, password_hash, role, window_id, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        user.id,
        user.username,
        user.displayName,
        hashPassword((user.password as string) ?? 'changeme'),
        user.role,
        user.windowId ?? null,
        new Date().toISOString(),
      )
    }
    return { success: true }
  })

  ipcMain.handle('users:delete', (_event, userId: string) => {
    const db = getDb()
    // Soft-delete: deactivate rather than remove
    db.prepare(`UPDATE users SET is_active = 0 WHERE id = ?`).run(userId)
    return { success: true }
  })

  ipcMain.handle('users:changePassword', (_event, userId: string, oldPassword: string, newPassword: string) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any
    if (!row) return { success: false, error: 'User not found' }
    if (row.password_hash !== hashPassword(oldPassword)) return { success: false, error: 'Incorrect current password' }
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(newPassword), userId)
    return { success: true }
  })

  // ─── LAN server ───────────────────────────────────────────────────────────

  // Getter is set by index.ts once the LAN server is started
  let lanUrlGetter: (() => string | null) | null = null

  ipcMain.handle('lan:getUrl', () => (lanUrlGetter ? lanUrlGetter() : null))

  // Called by index.ts to register the URL getter after server starts
  ;(global as any).__setLanUrlGetter = (fn: () => string | null) => { lanUrlGetter = fn }

  // ─── Piper TTS ────────────────────────────────────────────────────────────

  /** Returns { available, binPath, modelPath } for diagnostics */
  ipcMain.handle('piper:status', (_event, lang = 'sw') => {
    return {
      available: isPiperAvailable(lang as string),
      binPath: getPiperBin(),
      modelPath: getPiperModel(lang as string),
    }
  })

  /** Synthesize text with Piper — returns base64-encoded WAV string */
  ipcMain.handle('piper:synthesize', async (_event, text: string, lang = 'sw') => {
    const wav = await synthesizeWithPiper(text, lang as string)
    return wav.toString('base64')
  })

  // ─── Video management ─────────────────────────────────────────────────────

  /**
   * Build a local-video:// URL for a given filename.
   * The custom protocol (registered with stream:true) handles range requests so
   * <video> can seek. Using file:// directly fails in dev because the renderer
   * origin (http://localhost) is cross-origin to file://.
   */
  function videoUrl(name: string): string {
    return `local-video://videos/${encodeURIComponent(name)}`
  }

  /** Returns ordered list of videos with local-video:// URLs */
  ipcMain.handle('videos:list', () => {
    return listVideos().map((v) => ({ ...v, fileUrl: videoUrl(v.name) }))
  })

  /** Open file picker, copy selected videos to userData/videos/, return updated list */
  ipcMain.handle('videos:add', async () => {
    const result = await addVideo()
    if (!result) return null
    return result.map((v) => ({ ...v, fileUrl: videoUrl(v.name) }))
  })

  /** Delete a video by filename, return updated list */
  ipcMain.handle('videos:delete', (_event, name: string) => {
    return deleteVideo(name).map((v) => ({ ...v, fileUrl: videoUrl(v.name) }))
  })

  /** Save new playlist order */
  ipcMain.handle('videos:reorder', (_event, orderedNames: string[]) => {
    return reorderVideos(orderedNames).map((v) => ({ ...v, fileUrl: videoUrl(v.name) }))
  })

  /** Returns the videos directory path */
  ipcMain.handle('videos:getDir', () => getVideosDir())
}

/**
 * Register a custom protocol `local-video://` so the renderer can load
 * videos from userData without needing file:// permission overrides.
 * Call this BEFORE app.whenReady() using protocol.registerSchemesAsPrivileged().
 */
export function registerVideoProtocol() {
  protocol.handle('local-video', (request) => {
    const url = new URL(request.url)
    const dir = getVideosDir()
    // local-video://videos/filename.mp4  →  hostname="videos"  pathname="/filename.mp4"
    // local-video:///filename.mp4        →  hostname=""         pathname="/filename.mp4"
    // Both forms work — just strip the leading slash from pathname
    const filename = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const filePath = join(dir, filename)
    return net.fetch(pathToFileURL(filePath).href)
  })
}
