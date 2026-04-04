import { ipcMain, app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'path'
import { readLocalConfig, writeLocalConfig } from './license'

let db: Database.Database | null = null

function getDb(): Database.Database {
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

    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_category ON tickets(category_id);
    CREATE INDEX IF NOT EXISTS idx_call_log_date ON call_log(called_at);
  `)
}

export function setupIpcHandlers(): void {
  // ─── License validation ───────────────────────────────────────────────────

  ipcMain.handle('license:validate', async (_event, key: string) => {
    try {
      const { getMachineId } = await import('node-machine-id')
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
    } catch {
      return { valid: false, error: 'Cannot reach license server. Make sure it is running on port 3001.' }
    }
  })

  // ─── Config ──────────────────────────────────────────────────────────────

  ipcMain.handle('config:read', () => readLocalConfig())

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
    return ticket
  })

  ipcMain.handle('tickets:call', (_event, ticketId: string, windowId: string) => {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(`
      UPDATE tickets SET status = 'called', called_at = ?, window_id = ?, recall_count = recall_count + 1
      WHERE id = ?
    `).run(now, windowId, ticketId)
    db.prepare(`UPDATE windows SET current_ticket_id = ? WHERE id = ?`).run(ticketId, windowId)
    db.prepare(`
      INSERT INTO call_log (id, ticket_id, window_id, called_at, type)
      VALUES (?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), ticketId, windowId, now, 'initial')
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
    return { success: true }
  })

  ipcMain.handle('tickets:serve', (_event, ticketId: string) => {
    const db = getDb()
    db.prepare(`
      UPDATE tickets SET status = 'served', served_at = ? WHERE id = ?
    `).run(new Date().toISOString(), ticketId)
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as any
    if (ticket?.window_id) {
      db.prepare(`UPDATE windows SET current_ticket_id = NULL WHERE id = ?`).run(ticket.window_id)
    }
    return { success: true }
  })

  ipcMain.handle('tickets:skip', (_event, ticketId: string) => {
    const db = getDb()
    db.prepare(`UPDATE tickets SET status = 'skipped' WHERE id = ?`).run(ticketId)
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
    return {
      waiting: (db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE status = 'waiting' AND created_at LIKE ?`).get(`${today}%`) as any).c,
      called: (db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE status = 'called' AND created_at LIKE ?`).get(`${today}%`) as any).c,
      served: (db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE status = 'served' AND created_at LIKE ?`).get(`${today}%`) as any).c,
      skipped: (db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE status = 'skipped' AND created_at LIKE ?`).get(`${today}%`) as any).c,
    }
  })
}
