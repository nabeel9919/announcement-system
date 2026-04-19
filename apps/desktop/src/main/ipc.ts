import { ipcMain, app, protocol, net } from 'electron'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import bcrypt from 'bcryptjs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { readLocalConfig, writeLocalConfig } from './license'
import { isPiperAvailable, synthesizeWithPiper, getPiperBin, getPiperModel } from './piper-synth'
import { listVideos, addVideo, deleteVideo, reorderVideos, getVideosDir } from './video-manager'
import {
  getEmailConfig, saveEmailConfig, sendTestEmail,
  sendDailyReport, sendWeeklyDigest,
} from './email-reporter'
import type { UserRole } from '@announcement/shared'

// ─── DB row types ─────────────────────────────────────────────────────────────

interface DbTicket {
  id: string
  display_number: string
  sequence_number: number
  category_id: string
  status: 'waiting' | 'called' | 'served' | 'skipped' | 'no_show'
  created_at: string
  called_at: string | null
  served_at: string | null
  window_id: string | null
  callee_name: string | null
  recall_count: number
  answers: string | null
}

interface DbCategory {
  id: string
  code: string
  label: string
  window_ids: string
  color: string
  prefix: string
}

interface DbWindow {
  id: string
  number: number
  label: string
  operator_name: string | null
  is_active: 0 | 1
  current_ticket_id: string | null
}

interface DbUser {
  id: string
  username: string
  display_name: string
  password_hash: string
  role: UserRole
  window_id: string | null
  is_active: 0 | 1
  created_at: string
  last_login_at: string | null
}

interface DbFeedbackResponse {
  id: string
  submitted_at: string
  category_id: string | null
  category_label: string | null
  answers: string
}

/** SQLite COUNT(*) result row */
interface CountRow { c: number }
/** SQLite AVG() result row */
interface AvgRow { s: number | null }

interface OpPerfRow {
  callee_name: string
  window_id: string | null
  total_called: number
  served: number
  skipped: number
  no_show: number
  avg_service_seconds: number | null
}

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

function safeJsonParse<T = unknown>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
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

    CREATE TABLE IF NOT EXISTS kiosk_questions (
      id TEXT PRIMARY KEY,
      category_id TEXT,
      question TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'single',
      options TEXT NOT NULL DEFAULT '[]',
      order_index INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      depends_on_question_id TEXT,
      depends_on_option_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback_questions (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'star',
      options TEXT NOT NULL DEFAULT '[]',
      order_index INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      is_required INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback_responses (
      id TEXT PRIMARY KEY,
      submitted_at TEXT NOT NULL,
      category_id TEXT,
      category_label TEXT,
      answers TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS kiosk_terminals (
      id TEXT PRIMARY KEY,
      number INTEGER NOT NULL,
      label TEXT NOT NULL,
      location TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_category ON tickets(category_id);
    CREATE INDEX IF NOT EXISTS idx_call_log_date ON call_log(called_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_kiosk_q_category ON kiosk_questions(category_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_date ON feedback_responses(submitted_at);
  `)

  // Add answers column to tickets if it doesn't exist yet (migration)
  try {
    db.exec(`ALTER TABLE tickets ADD COLUMN answers TEXT DEFAULT NULL`)
  } catch { /* column already exists */ }

  // Conditional feedback question columns (migration)
  try {
    db.exec(`ALTER TABLE feedback_questions ADD COLUMN depends_on_question_id TEXT DEFAULT NULL`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE feedback_questions ADD COLUMN depends_on_answer_value TEXT DEFAULT NULL`)
  } catch { /* column already exists */ }
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
  const windowRow = windowId
    ? db.prepare('SELECT label FROM windows WHERE id = ?').get(windowId) as { label: string } | undefined
    : undefined
  const windowLabel = windowRow?.label ?? null
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

  function mapTicket(row: DbTicket) {
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

  function mapCategory(row: DbCategory) {
    return {
      id: row.id,
      code: row.code,
      label: row.label,
      windowIds: safeJsonParse(row.window_ids, [] as string[]),
      color: row.color,
      prefix: row.prefix,
    }
  }

  function mapWindow(row: DbWindow) {
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
    return (rows as DbTicket[]).map(mapTicket)
  })

  ipcMain.handle('tickets:create', (_event, ticket: Record<string, unknown>) => {
    const db = getDb()
    db.prepare(`
      INSERT INTO tickets (id, display_number, sequence_number, category_id, status, created_at, callee_name, recall_count, answers)
      VALUES (@id, @display_number, @sequence_number, @category_id, 'waiting', @created_at, @callee_name, 0, @answers)
    `).run({
      id: ticket.id,
      display_number: ticket.displayNumber,
      sequence_number: ticket.sequenceNumber,
      category_id: ticket.categoryId,
      created_at: ticket.createdAt ?? new Date().toISOString(),
      callee_name: ticket.calleeName ?? null,
      answers: ticket.answers ? JSON.stringify(ticket.answers) : null,
    })
    logAuditEvent(db, 'ticket_issued', ticket.id as string, ticket.displayNumber as string, null, ticket.categoryId as string)
    return ticket
  })

  ipcMain.handle('tickets:call', (_event, ticketId: string, windowId: string) => {
    const db = getDb()
    const now = new Date().toISOString()
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as DbTicket | undefined
    if (!ticket) return { success: false, error: 'Ticket not found' }
    db.transaction(() => {
      db.prepare(`
        UPDATE tickets SET status = 'called', called_at = ?, window_id = ?, recall_count = recall_count + 1
        WHERE id = ?
      `).run(now, windowId, ticketId)
      db.prepare(`UPDATE windows SET current_ticket_id = ? WHERE id = ?`).run(ticketId, windowId)
      db.prepare(`
        INSERT INTO call_log (id, ticket_id, window_id, called_at, type)
        VALUES (?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), ticketId, windowId, now, 'initial')
    })()
    logAuditEvent(db, 'ticket_called', ticketId, ticket.display_number, windowId, ticket.category_id)
    return { success: true }
  })

  ipcMain.handle('tickets:recall', (_event, ticketId: string) => {
    const db = getDb()
    const now = new Date().toISOString()
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as DbTicket | undefined
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
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as DbTicket | undefined
    db.transaction(() => {
      db.prepare(`UPDATE tickets SET status = 'served', served_at = ? WHERE id = ?`).run(now, ticketId)
      if (ticket?.window_id) {
        db.prepare(`UPDATE windows SET current_ticket_id = NULL WHERE id = ?`).run(ticket.window_id)
      }
    })()
    logAuditEvent(db, 'ticket_served', ticketId, ticket?.display_number, ticket?.window_id, ticket?.category_id)
    return { success: true }
  })

  ipcMain.handle('tickets:skip', (_event, ticketId: string) => {
    const db = getDb()
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as DbTicket | undefined
    db.prepare(`UPDATE tickets SET status = 'skipped' WHERE id = ?`).run(ticketId)
    logAuditEvent(db, 'ticket_skipped', ticketId, ticket?.display_number, ticket?.window_id, ticket?.category_id)
    return { success: true }
  })

  ipcMain.handle('tickets:noShow', (_event, ticketId: string) => {
    const db = getDb()
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as DbTicket | undefined
    db.transaction(() => {
      db.prepare(`UPDATE tickets SET status = 'no_show' WHERE id = ?`).run(ticketId)
      if (ticket?.window_id) {
        db.prepare(`UPDATE windows SET current_ticket_id = NULL WHERE id = ?`).run(ticket.window_id)
      }
    })()
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
    db.transaction(() => {
      db.prepare(`DELETE FROM tickets`).run()
      db.prepare(`UPDATE windows SET current_ticket_id = NULL`).run()
    })()
    return { success: true }
  })

  // ─── Categories ───────────────────────────────────────────────────────────

  ipcMain.handle('categories:list', () => {
    const db = getDb()
    return (db.prepare('SELECT * FROM categories').all() as DbCategory[]).map(mapCategory)
  })

  ipcMain.handle('categories:delete', (_event, id: string) => {
    const db = getDb()
    db.prepare('DELETE FROM categories WHERE id = ?').run(id)
    return { success: true }
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
    return (db.prepare('SELECT * FROM windows ORDER BY number ASC').all() as DbWindow[]).map(mapWindow)
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
      (db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE status = ? AND created_at LIKE ?`).get(status, `${today}%`) as CountRow).c
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
      ? (db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE status = 'waiting' AND category_id = ? AND created_at LIKE ?`).get(categoryId, `${today}%`) as CountRow).c
      : (db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE status = 'waiting' AND created_at LIKE ?`).get(`${today}%`) as CountRow).c

    // Average service time from today's completed tickets (created → served)
    let avgSeconds: number | null = null
    const catAvg = categoryId
      ? (db.prepare(`SELECT AVG((julianday(served_at) - julianday(created_at)) * 86400) as s FROM tickets WHERE status = 'served' AND category_id = ? AND created_at LIKE ? AND served_at IS NOT NULL`).get(categoryId, `${today}%`) as AvgRow | undefined)?.s
      : null
    if (catAvg) {
      avgSeconds = catAvg
    } else {
      // Fall back to overall average across all categories today
      const overallAvg = (db.prepare(`SELECT AVG((julianday(served_at) - julianday(created_at)) * 86400) as s FROM tickets WHERE status = 'served' AND created_at LIKE ? AND served_at IS NOT NULL`).get(`${today}%`) as AvgRow | undefined)?.s
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
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500))
    return db.prepare(`SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?`).all(safeLimit)
  })

  // ─── Users / RBAC ────────────────────────────────────────────────────────

  function hashPassword(password: string): string {
    return bcrypt.hashSync(password, 12)
  }

  /** Verify a password against a stored hash.
   *  Supports legacy SHA-256 hashes (64 hex chars) and auto-migrates them to bcrypt on success. */
  function verifyPassword(db: Database.Database, userId: string, password: string, storedHash: string): boolean {
    const isSha256 = /^[a-f0-9]{64}$/.test(storedHash)
    if (isSha256) {
      const matches = createHash('sha256').update(password).digest('hex') === storedHash
      if (matches) {
        // Migrate to bcrypt transparently
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId)
      }
      return matches
    }
    return bcrypt.compareSync(password, storedHash)
  }

  function mapUser(row: DbUser) {
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
    const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as CountRow).c
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
    const row = db.prepare(`SELECT * FROM users WHERE username = ? AND is_active = 1`).get(username) as DbUser | undefined
    if (!row || !verifyPassword(db, row.id, password, row.password_hash)) return null
    db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(new Date().toISOString(), row.id)
    logAuditEvent(db, 'user_login', null, null, null, null, `user:${row.username} role:${row.role}`)
    return mapUser(row)
  })

  ipcMain.handle('users:list', () => {
    const db = getDb()
    return (db.prepare(`SELECT * FROM users ORDER BY display_name ASC`).all() as DbUser[]).map(mapUser)
  })

  ipcMain.handle('users:upsert', (_event, user: Record<string, unknown>) => {
    const db = getDb()
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(user.id) as { id: string } | undefined
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
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as DbUser | undefined
    if (!row) return { success: false, error: 'User not found' }
    if (!verifyPassword(db, userId, oldPassword, row.password_hash)) return { success: false, error: 'Incorrect current password' }
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(newPassword), userId)
    return { success: true }
  })

  // ─── LAN server ───────────────────────────────────────────────────────────

  // Getter is set by index.ts once the LAN server is started
  let lanUrlGetter: (() => string | null) | null = null

  ipcMain.handle('lan:getUrl', () => (lanUrlGetter ? lanUrlGetter() : null))

  // Getter is set by index.ts once the LAN server is started
  let lanTokenGetter: (() => string) | null = null

  ipcMain.handle('lan:getToken', () => (lanTokenGetter ? lanTokenGetter() : ''))

  let lanKioskTokenGetter: (() => string) | null = null

  ipcMain.handle('lan:getKioskToken', () => (lanKioskTokenGetter ? lanKioskTokenGetter() : ''))

  // Called by index.ts to register the URL getter after server starts
  ;(global as any).__setLanUrlGetter = (fn: () => string | null) => { lanUrlGetter = fn }
  ;(global as any).__setLanTokenGetter = (fn: () => string) => { lanTokenGetter = fn }
  ;(global as any).__setLanKioskTokenGetter = (fn: () => string) => { lanKioskTokenGetter = fn }

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

  // ─── Kiosk Idle/Attract Screen Config ────────────────────────────────────

  const DEFAULT_IDLE_CONFIG = {
    enabled: true,
    timeoutSeconds: 45,
    welcomeMessage: 'Karibu!',
    tagline: 'Ujihudumie Mwenyewe • Self Service',
    steps: [
      { icon: '📋', title: 'Chagua Huduma', subtitle: 'Select your service' },
      { icon: '🎫', title: 'Pokea Tiketi', subtitle: 'Get your ticket' },
      { icon: '⏳', title: 'Subiri Kuitwa', subtitle: 'Wait to be called' },
    ],
  }

  ipcMain.handle('kiosk:idleConfig.get', () => {
    const config = readLocalConfig() as any
    return { ...DEFAULT_IDLE_CONFIG, ...(config.kioskIdleConfig ?? {}) }
  })

  ipcMain.handle('kiosk:idleConfig.set', (_event, cfg: any) => {
    writeLocalConfig({ kioskIdleConfig: cfg } as any)
    return { success: true }
  })

  // ─── Kiosk Questions ──────────────────────────────────────────────────────

  function mapKioskQuestion(row: any) {
    return {
      id: row.id,
      categoryId: row.category_id ?? null,
      question: row.question,
      type: row.type,
      options: safeJsonParse(row.options, [] as string[]),
      orderIndex: row.order_index,
      isEnabled: row.is_enabled === 1,
      dependsOnQuestionId: row.depends_on_question_id ?? null,
      dependsOnOptionId: row.depends_on_option_id ?? null,
      createdAt: row.created_at,
    }
  }

  /** Returns enabled questions for a category (+ global questions), ordered */
  ipcMain.handle('kiosk:questions.list', (_event, categoryId?: string) => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM kiosk_questions
      WHERE is_enabled = 1
        AND (category_id IS NULL OR category_id = ?)
      ORDER BY order_index ASC, created_at ASC
    `).all(categoryId ?? null)
    return rows.map(mapKioskQuestion)
  })

  /** Returns ALL questions (including disabled) for the Settings editor */
  ipcMain.handle('kiosk:questions.listAll', () => {
    const db = getDb()
    return db.prepare(`SELECT * FROM kiosk_questions ORDER BY order_index ASC, created_at ASC`).all().map(mapKioskQuestion)
  })

  /** Create or update a kiosk question */
  ipcMain.handle('kiosk:questions.upsert', (_event, q: any) => {
    const db = getDb()
    db.prepare(`
      INSERT INTO kiosk_questions (id, category_id, question, type, options, order_index, is_enabled, depends_on_question_id, depends_on_option_id, created_at)
      VALUES (@id, @category_id, @question, @type, @options, @order_index, @is_enabled, @depends_on_question_id, @depends_on_option_id, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        category_id = excluded.category_id,
        question = excluded.question,
        type = excluded.type,
        options = excluded.options,
        order_index = excluded.order_index,
        is_enabled = excluded.is_enabled,
        depends_on_question_id = excluded.depends_on_question_id,
        depends_on_option_id = excluded.depends_on_option_id
    `).run({
      id: q.id,
      category_id: q.categoryId ?? null,
      question: q.question,
      type: q.type ?? 'single',
      options: JSON.stringify(q.options ?? []),
      order_index: q.orderIndex ?? 0,
      is_enabled: q.isEnabled !== false ? 1 : 0,
      depends_on_question_id: q.dependsOnQuestionId ?? null,
      depends_on_option_id: q.dependsOnOptionId ?? null,
      created_at: q.createdAt ?? new Date().toISOString(),
    })
    return mapKioskQuestion(db.prepare('SELECT * FROM kiosk_questions WHERE id = ?').get(q.id))
  })

  /** Delete a kiosk question */
  ipcMain.handle('kiosk:questions.delete', (_event, id: string) => {
    const db = getDb()
    db.transaction(() => {
      // Also clear any questions that depend on this one
      db.prepare(`UPDATE kiosk_questions SET depends_on_question_id = NULL, depends_on_option_id = NULL WHERE depends_on_question_id = ?`).run(id)
      db.prepare(`DELETE FROM kiosk_questions WHERE id = ?`).run(id)
    })()
    return { success: true }
  })

  /** Bulk-update order_index to match the provided id array */
  ipcMain.handle('kiosk:questions.reorder', (_event, ids: string[]) => {
    const db = getDb()
    const update = db.prepare(`UPDATE kiosk_questions SET order_index = ? WHERE id = ?`)
    db.transaction(() => {
      ids.forEach((id, i) => update.run(i, id))
    })()
    return { success: true }
  })

  // ─── Kiosk Terminals ──────────────────────────────────────────────────────

  function mapKioskTerminal(row: any) {
    return {
      id: row.id,
      number: row.number,
      label: row.label,
      location: row.location ?? null,
      isEnabled: row.is_enabled === 1,
      createdAt: row.created_at,
    }
  }

  ipcMain.handle('kiosk:terminals.list', () => {
    return getDb().prepare('SELECT * FROM kiosk_terminals ORDER BY number ASC').all().map(mapKioskTerminal)
  })

  ipcMain.handle('kiosk:terminals.upsert', (_event, t: any) => {
    const db = getDb()
    db.prepare(`
      INSERT INTO kiosk_terminals (id, number, label, location, is_enabled, created_at)
      VALUES (@id, @number, @label, @location, @is_enabled, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        number    = excluded.number,
        label     = excluded.label,
        location  = excluded.location,
        is_enabled = excluded.is_enabled
    `).run({
      id:         t.id,
      number:     t.number,
      label:      t.label,
      location:   t.location ?? null,
      is_enabled: t.isEnabled !== false ? 1 : 0,
      created_at: t.createdAt ?? new Date().toISOString(),
    })
    return mapKioskTerminal(db.prepare('SELECT * FROM kiosk_terminals WHERE id = ?').get(t.id))
  })

  ipcMain.handle('kiosk:terminals.delete', (_event, id: string) => {
    getDb().prepare('DELETE FROM kiosk_terminals WHERE id = ?').run(id)
    return { success: true }
  })

  // ─── Feedback ─────────────────────────────────────────────────────────────

  function mapFeedbackQuestion(row: any) {
    return {
      id: row.id,
      question: row.question,
      type: row.type,
      options: safeJsonParse(row.options, [] as string[]),
      orderIndex: row.order_index,
      isEnabled: row.is_enabled === 1,
      isRequired: row.is_required === 1,
      createdAt: row.created_at,
      dependsOnQuestionId: row.depends_on_question_id ?? null,
      dependsOnAnswerValue: row.depends_on_answer_value ?? null,
    }
  }

  /** Enabled feedback questions ordered */
  ipcMain.handle('feedback:questions.list', () => {
    const db = getDb()
    return db.prepare(`SELECT * FROM feedback_questions WHERE is_enabled = 1 ORDER BY order_index ASC, created_at ASC`).all().map(mapFeedbackQuestion)
  })

  /** All feedback questions including disabled — for Settings */
  ipcMain.handle('feedback:questions.listAll', () => {
    const db = getDb()
    return db.prepare(`SELECT * FROM feedback_questions ORDER BY order_index ASC, created_at ASC`).all().map(mapFeedbackQuestion)
  })

  ipcMain.handle('feedback:questions.upsert', (_event, q: any) => {
    const db = getDb()
    db.prepare(`
      INSERT INTO feedback_questions (id, question, type, options, order_index, is_enabled, is_required, created_at, depends_on_question_id, depends_on_answer_value)
      VALUES (@id, @question, @type, @options, @order_index, @is_enabled, @is_required, @created_at, @depends_on_question_id, @depends_on_answer_value)
      ON CONFLICT(id) DO UPDATE SET
        question = excluded.question,
        type = excluded.type,
        options = excluded.options,
        order_index = excluded.order_index,
        is_enabled = excluded.is_enabled,
        is_required = excluded.is_required,
        depends_on_question_id = excluded.depends_on_question_id,
        depends_on_answer_value = excluded.depends_on_answer_value
    `).run({
      id: q.id,
      question: q.question,
      type: q.type ?? 'star',
      options: JSON.stringify(q.options ?? []),
      order_index: q.orderIndex ?? 0,
      is_enabled: q.isEnabled !== false ? 1 : 0,
      is_required: q.isRequired ? 1 : 0,
      created_at: q.createdAt ?? new Date().toISOString(),
      depends_on_question_id: q.dependsOnQuestionId ?? null,
      depends_on_answer_value: q.dependsOnAnswerValue ?? null,
    })
    return mapFeedbackQuestion(db.prepare('SELECT * FROM feedback_questions WHERE id = ?').get(q.id))
  })

  ipcMain.handle('feedback:questions.delete', (_event, id: string) => {
    const db = getDb()
    db.prepare(`DELETE FROM feedback_questions WHERE id = ?`).run(id)
    return { success: true }
  })

  ipcMain.handle('feedback:questions.reorder', (_event, ids: string[]) => {
    const db = getDb()
    const update = db.prepare(`UPDATE feedback_questions SET order_index = ? WHERE id = ?`)
    db.transaction(() => { ids.forEach((id, i) => update.run(i, id)) })()
    return { success: true }
  })

  /** Submit a feedback response */
  ipcMain.handle('feedback:submit', (_event, response: any) => {
    const db = getDb()
    const id = response.id ?? crypto.randomUUID()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO feedback_responses (id, submitted_at, category_id, category_label, answers)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, now, response.categoryId ?? null, response.categoryLabel ?? null, JSON.stringify(response.answers ?? []))
    return { success: true, id }
  })

  /** Fetch responses for analytics — defaults to last 30 days */
  ipcMain.handle('feedback:responses.list', (_event, days = 30) => {
    const db = getDb()
    const safeDays = Math.max(1, Math.min(Number(days) || 30, 365))
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString()
    const rows = db.prepare(`SELECT * FROM feedback_responses WHERE submitted_at >= ? ORDER BY submitted_at DESC`).all(since) as DbFeedbackResponse[]
    return rows.map(r => ({
      id: r.id,
      submittedAt: r.submitted_at,
      categoryId: r.category_id,
      categoryLabel: r.category_label,
      answers: safeJsonParse(r.answers, [] as unknown[]),
    }))
  })

  /** Summary stats for the feedback dashboard */
  ipcMain.handle('feedback:summary', (_event, days = 30) => {
    const db = getDb()
    const safeDays = Math.max(1, Math.min(Number(days) || 30, 365))
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString()
    const rows = db.prepare(`SELECT answers FROM feedback_responses WHERE submitted_at >= ?`).all(since) as Pick<DbFeedbackResponse, 'answers'>[]

    const total = rows.length
    // Aggregate scores per question
    const scoreMap: Record<string, { sum: number; count: number; label: string }> = {}
    const choiceMap: Record<string, Record<string, number>> = {}

    for (const row of rows) {
      const answers = safeJsonParse(row.answers, [] as Record<string, unknown>[])
      for (const a of answers) {
        if (a.type === 'star' || a.type === 'emoji') {
          if (!scoreMap[a.questionId]) scoreMap[a.questionId] = { sum: 0, count: 0, label: a.question }
          if (a.score) { scoreMap[a.questionId].sum += a.score; scoreMap[a.questionId].count++ }
        } else if (a.type === 'choice') {
          if (!choiceMap[a.questionId]) choiceMap[a.questionId] = {}
          if (a.value) choiceMap[a.questionId][a.value] = (choiceMap[a.questionId][a.value] ?? 0) + 1
        }
      }
    }

    const ratings = Object.entries(scoreMap).map(([qId, v]) => ({
      questionId: qId,
      question: v.label,
      average: v.count > 0 ? Math.round((v.sum / v.count) * 10) / 10 : 0,
      count: v.count,
    }))

    const choices = Object.entries(choiceMap).map(([qId, counts]) => ({
      questionId: qId,
      counts,
    }))

    return { total, ratings, choices }
  })

  /** Comprehensive feedback report for leadership — aggregates all dimensions */
  ipcMain.handle('feedback:report', (_event, days = 30) => {
    const db = getDb()
    const safeDays = Math.max(1, Math.min(Number(days) || 30, 365))
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString()
    const rows = db.prepare(`
      SELECT id, submitted_at, category_id, category_label, answers
      FROM feedback_responses WHERE submitted_at >= ?
      ORDER BY submitted_at DESC
    `).all(since) as DbFeedbackResponse[]

    // Seed daily buckets so every day in range appears even with 0 responses
    const dailyMap: Record<string, { count: number; scoreSum: number; scoreCount: number }> = {}
    for (let i = safeDays - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
      dailyMap[d] = { count: 0, scoreSum: 0, scoreCount: 0 }
    }

    const questionMap: Record<string, {
      question: string; type: string
      scoreSum: number; scoreCount: number
      distribution: Record<string, number>
      choiceOptions: Record<string, number>
      textSamples: string[]
    }> = {}

    const catMap: Record<string, { label: string; count: number; scoreSum: number; scoreCount: number }> = {}
    const recent: any[] = []

    for (const row of rows) {
      const date = (row.submitted_at as string).slice(0, 10)
      if (dailyMap[date]) dailyMap[date].count++

      const catKey = (row.category_id as string | null) ?? '__none__'
      if (!catMap[catKey]) catMap[catKey] = { label: row.category_label ?? 'General', count: 0, scoreSum: 0, scoreCount: 0 }
      catMap[catKey].count++

      const answers = safeJsonParse(row.answers, [] as Record<string, unknown>[])

      for (const a of answers) {
        const qId = a.questionId as string
        if (!questionMap[qId]) {
          questionMap[qId] = { question: a.question ?? qId, type: a.type, scoreSum: 0, scoreCount: 0, distribution: {}, choiceOptions: {}, textSamples: [] }
        }
        const q = questionMap[qId]
        if (a.type === 'star' || a.type === 'emoji') {
          const score = a.score ?? null
          if (score) {
            q.scoreSum += score; q.scoreCount++
            q.distribution[score] = (q.distribution[score] ?? 0) + 1
            if (dailyMap[date]) { dailyMap[date].scoreSum += score; dailyMap[date].scoreCount++ }
            catMap[catKey].scoreSum += score; catMap[catKey].scoreCount++
          }
        } else if (a.type === 'choice') {
          if (a.value) q.choiceOptions[a.value] = (q.choiceOptions[a.value] ?? 0) + 1
        } else if (a.type === 'text') {
          if (a.value && q.textSamples.length < 15) q.textSamples.push(a.value as string)
        }
      }

      if (recent.length < 25) {
        recent.push({
          id: row.id,
          submittedAt: row.submitted_at,
          categoryLabel: row.category_label ?? 'General',
          answers: answers.map((a) => ({
            question: a.question ?? '',
            type: a.type,
            value: a.value ?? null,
            score: a.score ?? null,
          })),
        })
      }
    }

    const dailyTrend = Object.entries(dailyMap).map(([date, d]) => ({
      date,
      count: d.count,
      avgScore: d.scoreCount > 0 ? Math.round((d.scoreSum / d.scoreCount) * 10) / 10 : null,
    }))

    const questions = Object.entries(questionMap).map(([qId, q]) => {
      const avg = q.scoreCount > 0 ? Math.round((q.scoreSum / q.scoreCount) * 10) / 10 : null
      const totalChoices = Object.values(q.choiceOptions).reduce((a, b) => a + b, 0)
      return {
        questionId: qId,
        question: q.question,
        type: q.type,
        average: avg,
        count: q.scoreCount || totalChoices || q.textSamples.length,
        distribution: q.distribution,
        options: Object.entries(q.choiceOptions)
          .map(([val, cnt]) => ({ value: val, count: cnt, pct: totalChoices > 0 ? Math.round((cnt / totalChoices) * 100) : 0 }))
          .sort((a, b) => b.count - a.count),
        textSamples: q.textSamples,
      }
    })

    const byCategory = Object.entries(catMap)
      .map(([catId, c]) => ({
        categoryId: catId === '__none__' ? null : catId,
        categoryLabel: c.label,
        count: c.count,
        avgScore: c.scoreCount > 0 ? Math.round((c.scoreSum / c.scoreCount) * 10) / 10 : null,
      }))
      .sort((a, b) => b.count - a.count)

    // Overall weighted score across all rating questions
    let totalScoreSum = 0, totalScoreCount = 0
    for (const q of questions) {
      if (q.average !== null && (q.type === 'star' || q.type === 'emoji')) {
        totalScoreSum += q.average * q.count
        totalScoreCount += q.count
      }
    }
    const overallScore = totalScoreCount > 0
      ? Math.round((totalScoreSum / totalScoreCount) * 10) / 10
      : null

    // Peak day
    const peakDay = dailyTrend.reduce<{ date: string; count: number } | null>((best, d) => {
      return !best || d.count > best.count ? { date: d.date, count: d.count } : best
    }, null)

    return { total: rows.length, overallScore, peakDay, dailyTrend, questions, byCategory, recent }
  })

  // ─── Kiosk Operating Hours ────────────────────────────────────────────────

  const DEFAULT_HOURS_CONFIG = {
    enabled: false,
    openTime: '08:00',
    closeTime: '17:00',
    days: [1, 2, 3, 4, 5, 6],  // Mon–Sat
    closedMessage: 'We are currently closed. Please visit us during our operating hours.',
  }

  ipcMain.handle('kiosk:hoursConfig.get', () => {
    const config = readLocalConfig() as any
    return { ...DEFAULT_HOURS_CONFIG, ...(config.kioskHoursConfig ?? {}) }
  })

  ipcMain.handle('kiosk:hoursConfig.set', (_event, cfg: any) => {
    writeLocalConfig({ kioskHoursConfig: cfg } as any)
    return { success: true }
  })

  // ─── Operator Performance ─────────────────────────────────────────────────

  ipcMain.handle('stats:operatorPerformance', (_event, days = 1) => {
    const db = getDb()
    const safeDays = Math.max(1, Math.min(Number(days) || 1, 365))
    const since = safeDays === 1
      ? new Date().toISOString().slice(0, 10)  // today only (LIKE query)
      : new Date(Date.now() - safeDays * 86_400_000).toISOString()

    const rows = safeDays === 1
      ? db.prepare(`
          SELECT callee_name, window_id,
            COUNT(*) as total_called,
            SUM(CASE WHEN status='served' THEN 1 ELSE 0 END) as served,
            SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) as skipped,
            SUM(CASE WHEN status='no_show' THEN 1 ELSE 0 END) as no_show,
            AVG(CASE WHEN served_at IS NOT NULL AND called_at IS NOT NULL
              THEN (julianday(served_at) - julianday(called_at)) * 86400
              ELSE NULL END) as avg_service_seconds
          FROM tickets
          WHERE callee_name IS NOT NULL AND created_at LIKE ?
          GROUP BY callee_name, window_id
          ORDER BY served DESC
        `).all(`${since}%`) as OpPerfRow[]
      : db.prepare(`
          SELECT callee_name, window_id,
            COUNT(*) as total_called,
            SUM(CASE WHEN status='served' THEN 1 ELSE 0 END) as served,
            SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) as skipped,
            SUM(CASE WHEN status='no_show' THEN 1 ELSE 0 END) as no_show,
            AVG(CASE WHEN served_at IS NOT NULL AND called_at IS NOT NULL
              THEN (julianday(served_at) - julianday(called_at)) * 86400
              ELSE NULL END) as avg_service_seconds
          FROM tickets
          WHERE callee_name IS NOT NULL AND created_at >= ?
          GROUP BY callee_name, window_id
          ORDER BY served DESC
        `).all(since) as OpPerfRow[]

    return rows.map((r) => ({
      operatorName: r.callee_name,
      windowId: r.window_id,
      totalCalled: r.total_called,
      served: r.served,
      skipped: r.skipped,
      noShow: r.no_show,
      avgServiceSeconds: r.avg_service_seconds ? Math.round(r.avg_service_seconds) : null,
    }))
  })

  // ─── Email Reports ────────────────────────────────────────────────────────

  ipcMain.handle('email:config.get', () => getEmailConfig())

  ipcMain.handle('email:config.set', (_event, cfg: any) => {
    saveEmailConfig(cfg)
    return { success: true }
  })

  ipcMain.handle('email:sendTest', async () => sendTestEmail(getEmailConfig()))

  ipcMain.handle('email:sendDailyNow', async () => sendDailyReport(getDb))

  ipcMain.handle('email:sendWeeklyNow', async () => sendWeeklyDigest(getDb))
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
