/**
 * LAN HTTP Server — serves a web-based operator panel on the local network.
 * Staff on other computers open http://<SERVER_IP>:4000 in their browser.
 * No new npm dependencies — uses Node.js built-ins only.
 */
import * as http from 'http'
import * as os from 'os'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { readLocalConfig, writeLocalConfig } from './license'

type GetDb = () => Database.Database
type GetWindow = () => BrowserWindow | null

function getLocalIp(): string {
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return '127.0.0.1'
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')) } catch { resolve({}) }
    })
  })
}

// ── Announcement text builder (pure — no browser APIs) ────────────────────────
function expandNumber(n: string): string {
  return n.replace(/-/g, ', ').replace(/\s+/g, ', ').split(', ').map((part) => {
    if (/^\d+$/.test(part))
      return part.split('').map((d) => ['zero','one','two','three','four','five','six','seven','eight','nine'][+d]).join(' ')
    if (/^[A-Z]+$/.test(part) && part.length > 1) return part.split('').join(' ')
    return part
  }).join(', ')
}

function buildAnnouncementText(displayNumber: string, windowLabel: string, lang: string, mode: 'ticket' | 'card' | 'name'): string {
  if (mode === 'name') {
    switch (lang) {
      case 'sw': return `Tangazo. ${displayNumber}, tafadhali elekea ${windowLabel}.`
      case 'ar': return `إعلان. ${displayNumber}، يرجى التوجه إلى ${windowLabel}.`
      case 'fr': return `Annonce. ${displayNumber}, veuillez vous rendre à ${windowLabel}.`
      default:   return `Announcement. ${displayNumber}, please proceed to ${windowLabel}.`
    }
  }
  const expanded = expandNumber(displayNumber)
  switch (lang) {
    case 'sw':
      return mode === 'card'
        ? `Tangazo. Mwenye kadi, ${expanded}, tafadhali elekea ${windowLabel}.`
        : `Tangazo. Mwenye tiketi, ${expanded}, tafadhali elekea ${windowLabel}.`
    case 'ar':
      return mode === 'card'
        ? `إعلان. صاحب البطاقة رقم ${displayNumber}، يرجى التوجه إلى ${windowLabel}.`
        : `إعلان. صاحب التذكرة رقم ${displayNumber}، يرجى التوجه إلى ${windowLabel}.`
    case 'fr':
      return mode === 'card'
        ? `Annonce. Le titulaire de la carte numéro ${expanded}, veuillez vous rendre à ${windowLabel}.`
        : `Annonce. Le titulaire du ticket numéro ${expanded}, veuillez vous rendre à ${windowLabel}.`
    default:
      return mode === 'card'
        ? `Announcement. Card holder ${expanded}, please proceed to ${windowLabel}.`
        : `Announcement. Ticket number ${expanded}, please proceed to ${windowLabel}.`
  }
}

export class LanServer {
  private server: http.Server | null = null
  private sseClients = new Set<http.ServerResponse>()
  private port: number
  private actualPort: number | null = null
  private getDb: GetDb
  private getOperatorWindow: GetWindow

  // ── Security ─────────────────────────────────────────────────────────────
  private apiToken: string = ''
  /** ip → { failures, windowStart } */
  private rateLimiter = new Map<string, { failures: number; windowStart: number }>()
  private readonly RATE_MAX = 10
  private readonly RATE_WINDOW_MS = 5 * 60 * 1000   // 5 min sliding window
  private readonly RATE_BLOCK_MS  = 15 * 60 * 1000  // 15 min block after max failures

  constructor(getDb: GetDb, getOperatorWindow: GetWindow, port = 4000) {
    this.getDb = getDb
    this.getOperatorWindow = getOperatorWindow
    this.port = port
  }

  getUrl(): string | null {
    if (this.actualPort === null) return null
    return `http://${getLocalIp()}:${this.actualPort}`
  }

  getToken(): string { return this.apiToken }
  getPort(): number { return this.actualPort ?? this.port }

  // ── Token persistence ────────────────────────────────────────────────────
  private initToken(): void {
    const config = readLocalConfig() as any
    if (config.lanApiToken && typeof config.lanApiToken === 'string' && config.lanApiToken.length >= 32) {
      this.apiToken = config.lanApiToken
    } else {
      // Generate a 40-character hex token
      this.apiToken = Array.from({ length: 5 }, () => randomUUID().replace(/-/g, '')).join('').slice(0, 40)
      writeLocalConfig({ lanApiToken: this.apiToken } as any)
      console.log('[LAN] New API token generated and saved.')
    }
    console.log(`[LAN] API token: ${this.apiToken.slice(0, 8)}…${this.apiToken.slice(-4)}`)
  }

  // ── Rate limiter helpers ─────────────────────────────────────────────────
  private getIp(req: http.IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
    return req.socket.remoteAddress ?? 'unknown'
  }

  private checkRateLimit(ip: string): boolean {
    const entry = this.rateLimiter.get(ip)
    if (!entry) return false
    if (Date.now() - entry.windowStart > this.RATE_BLOCK_MS) {
      this.rateLimiter.delete(ip)
      return false
    }
    return entry.failures >= this.RATE_MAX
  }

  private recordFailure(ip: string): void {
    const now = Date.now()
    const entry = this.rateLimiter.get(ip)
    if (!entry || now - entry.windowStart > this.RATE_WINDOW_MS) {
      this.rateLimiter.set(ip, { failures: 1, windowStart: now })
    } else {
      entry.failures++
    }
  }

  private clearFailures(ip: string): void {
    this.rateLimiter.delete(ip)
  }

  // ── Auth check ───────────────────────────────────────────────────────────
  private checkAuth(req: http.IncomingMessage): boolean {
    const auth = req.headers['authorization'] ?? ''
    return auth === `Bearer ${this.apiToken}`
  }

  // ── CORS origin validation ───────────────────────────────────────────────
  private isLocalOrigin(origin: string | undefined): boolean {
    if (!origin) return true  // no Origin header = same-origin or curl — allow
    try {
      const host = new URL(origin).hostname
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
      if (/^192\.168\./.test(host)) return true
      if (/^10\./.test(host)) return true
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
    } catch { /* malformed origin — deny */ }
    return false
  }

  start(): Promise<void> {
    this.initToken()
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res))

      const tryListen = (port: number) => {
        this.server!.listen(port, '0.0.0.0', () => {
          this.actualPort = port
          console.log(`[LAN] Operator panel at http://0.0.0.0:${port}`)
          resolve()
        })
        this.server!.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE' && port < this.port + 10) {
            this.server!.removeAllListeners('error')
            tryListen(port + 1)
          } else {
            reject(err)
          }
        })
      }
      tryListen(this.port)
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const res of this.sseClients) { try { res.end() } catch { /* ignore */ } }
      this.sseClients.clear()
      if (this.server) {
        this.server.close(() => resolve())
      } else {
        resolve()
      }
    })
  }

  private broadcastSSE(event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const res of this.sseClients) {
      try { res.write(payload) } catch { this.sseClients.delete(res) }
    }
  }

  private getQueue() {
    const db = this.getDb()
    const tickets = db.prepare('SELECT * FROM tickets ORDER BY sequence_number ASC').all()
    const windows = db.prepare('SELECT * FROM windows ORDER BY number ASC').all()
    const categories = db.prepare('SELECT * FROM categories ORDER BY code ASC').all()
    return { tickets, windows, categories }
  }

  private getStats() {
    const db = this.getDb()
    const today = new Date().toISOString().slice(0, 10)
    const count = (status: string) =>
      (db.prepare('SELECT COUNT(*) as c FROM tickets WHERE status=? AND created_at LIKE ?')
        .get(status, `${today}%`) as { c: number }).c
    return {
      waiting: count('waiting'),
      called: count('called'),
      served: count('served'),
      skipped: count('skipped'),
    }
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url    = new URL(req.url ?? '/', `http://localhost`)
    const method = req.method ?? 'GET'
    const path   = url.pathname
    const ip     = this.getIp(req)
    const origin = req.headers['origin'] as string | undefined
    // Allow local-network origins; reflect the origin back so cookies work
    const allowOrigin = this.isLocalOrigin(origin) ? (origin ?? '*') : 'null'

    // ── Rate-limit check ────────────────────────────────────────────────────
    if (this.checkRateLimit(ip)) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.ceil(this.RATE_BLOCK_MS / 1000)),
      })
      res.end(JSON.stringify({ error: 'Too many failed attempts. Try again in 15 minutes.' }))
      return
    }

    // ── Reply helper — attaches correct CORS headers every time ────────────
    const reply = (status: number, data: unknown) => {
      const body = JSON.stringify(data)
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      })
      res.end(body)
    }

    // ── CORS preflight ───────────────────────────────────────────────────────
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      })
      res.end()
      return
    }

    // ── Bearer-token check for ALL write endpoints ───────────────────────────
    if (method === 'POST') {
      if (!this.checkAuth(req)) {
        this.recordFailure(ip)
        reply(401, { error: 'Unauthorized. Include "Authorization: Bearer <token>" header.' })
        return
      }
      this.clearFailures(ip)
    }

    // ── SSE — token passed as query param (EventSource can't set headers) ──
    if (method === 'GET' && path === '/api/events') {
      const token = url.searchParams.get('token')
      if (token !== this.apiToken) {
        this.recordFailure(ip)
        res.writeHead(401, { 'Content-Type': 'text/plain' })
        res.end('Unauthorized')
        return
      }
      this.clearFailures(ip)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': allowOrigin,
      })
      res.write(`event: ping\ndata: {}\n\n`)
      this.sseClients.add(res)
      const { tickets, windows, categories } = this.getQueue()
      res.write(`event: queue\ndata: ${JSON.stringify({ tickets, windows, categories })}\n\n`)
      res.write(`event: stats\ndata: ${JSON.stringify(this.getStats())}\n\n`)
      req.socket.on('close', () => this.sseClients.delete(res))
      const ping = setInterval(() => {
        try { res.write(`event: ping\ndata: {}\n\n`) }
        catch { clearInterval(ping); this.sseClients.delete(res) }
      }, 25000)
      req.socket.on('close', () => clearInterval(ping))
      return
    }

    // ── GET /api/queue ───────────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/queue') {
      reply(200, this.getQueue())
      return
    }

    // ── GET /api/stats ───────────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/stats') {
      reply(200, this.getStats())
      return
    }

    // ── GET /api/config ──────────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/config') {
      const db = this.getDb()
      const categories = db.prepare('SELECT * FROM categories ORDER BY code ASC').all()
      const windows    = db.prepare('SELECT * FROM windows ORDER BY number ASC').all()
      reply(200, { categories, windows })
      return
    }

    // ── POST /api/call-name ──────────────────────────────────────────────────
    if (method === 'POST' && path === '/api/call-name') {
      const body = await readBody(req) as { name: string; windowId?: string }
      if (!body.name) { reply(400, { error: 'name required' }); return }
      try {
        const win = body.windowId ? (this.getDb().prepare('SELECT * FROM windows WHERE id=?').get(body.windowId) as any) : null
        this.triggerAnnounce(body.name, win?.label ?? 'Reception', body.windowId ?? '', 'name')
        this.broadcastSSE('announce', { name: body.name, windowId: body.windowId ?? '' })
        reply(200, { success: true })
      } catch (e) { reply(500, { error: String(e) }) }
      return
    }

    // ── POST /api/tickets/issue ──────────────────────────────────────────────
    if (method === 'POST' && path === '/api/tickets/issue') {
      const body = await readBody(req) as { categoryId: string }
      if (!body.categoryId) { reply(400, { error: 'categoryId required' }); return }
      try {
        const db  = this.getDb()
        const cat = db.prepare('SELECT * FROM categories WHERE id=?').get(body.categoryId) as any
        if (!cat) { reply(404, { error: 'Category not found' }); return }
        const today  = new Date().toISOString().slice(0, 10)
        const maxRow = db.prepare(
          `SELECT MAX(sequence_number) as m FROM tickets WHERE category_id=? AND created_at LIKE ?`
        ).get(body.categoryId, `${today}%`) as { m: number | null }
        const seq           = (maxRow.m ?? 0) + 1
        const pad           = (n: number) => String(n).padStart(3, '0')
        const displayNumber = `${cat.prefix ?? ''}${pad(seq)}`
        const id            = randomUUID()
        const now           = new Date().toISOString()
        db.prepare(`INSERT INTO tickets (id,display_number,sequence_number,category_id,status,created_at,recall_count) VALUES (?,?,?,?,'waiting',?,0)`)
          .run(id, displayNumber, seq, body.categoryId, now)
        this.broadcastSSE('queue', this.getQueue())
        this.broadcastSSE('stats', this.getStats())
        reply(200, { success: true, ticket: { id, displayNumber, sequenceNumber: seq, categoryId: body.categoryId } })
      } catch (e) { reply(500, { error: String(e) }) }
      return
    }

    // ── POST /api/tickets/:id/call ───────────────────────────────────────────
    const callMatch = path.match(/^\/api\/tickets\/([^/]+)\/call$/)
    if (method === 'POST' && callMatch) {
      const ticketId = callMatch[1]
      const body     = await readBody(req) as { windowId: string }
      if (!body.windowId) { reply(400, { error: 'windowId required' }); return }
      try {
        const db  = this.getDb()
        const now = new Date().toISOString()
        db.prepare(`UPDATE tickets SET status='called',called_at=?,window_id=?,recall_count=recall_count+1 WHERE id=?`)
          .run(now, body.windowId, ticketId)
        db.prepare(`UPDATE windows SET current_ticket_id=? WHERE id=?`).run(ticketId, body.windowId)
        db.prepare(`INSERT INTO call_log (id,ticket_id,window_id,called_at,type) VALUES (?,?,?,?,'initial')`)
          .run(randomUUID(), ticketId, body.windowId, now)
        const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId) as any
        const win    = db.prepare('SELECT * FROM windows WHERE id=?').get(body.windowId) as any
        this.triggerAnnounce(ticket?.display_number ?? '', win?.label ?? 'Counter', body.windowId)
        this.broadcastSSE('queue', this.getQueue())
        this.broadcastSSE('stats', this.getStats())
        reply(200, { success: true, ticket })
      } catch (e) { reply(500, { error: String(e) }) }
      return
    }

    // ── POST /api/tickets/next/:windowId/:categoryId ─────────────────────────
    const nextMatch = path.match(/^\/api\/tickets\/next\/([^/]+)\/([^/]+)$/)
    if (method === 'POST' && nextMatch) {
      const [, windowId, categoryId] = nextMatch
      try {
        const db   = this.getDb()
        const next = db.prepare(
          `SELECT * FROM tickets WHERE status='waiting' AND category_id=? ORDER BY sequence_number ASC LIMIT 1`
        ).get(categoryId) as any
        if (!next) { reply(404, { error: 'No waiting tickets' }); return }
        const now = new Date().toISOString()
        db.prepare(`UPDATE tickets SET status='called',called_at=?,window_id=?,recall_count=recall_count+1 WHERE id=?`)
          .run(now, windowId, next.id)
        db.prepare(`UPDATE windows SET current_ticket_id=? WHERE id=?`).run(next.id, windowId)
        db.prepare(`INSERT INTO call_log (id,ticket_id,window_id,called_at,type) VALUES (?,?,?,?,'initial')`)
          .run(randomUUID(), next.id, windowId, now)
        const win = db.prepare('SELECT * FROM windows WHERE id=?').get(windowId) as any
        this.triggerAnnounce(next.display_number, win?.label ?? 'Counter', windowId)
        this.broadcastSSE('queue', this.getQueue())
        this.broadcastSSE('stats', this.getStats())
        reply(200, { success: true, ticket: next })
      } catch (e) { reply(500, { error: String(e) }) }
      return
    }

    // ── POST /api/tickets/:id/recall ─────────────────────────────────────────
    const recallMatch = path.match(/^\/api\/tickets\/([^/]+)\/recall$/)
    if (method === 'POST' && recallMatch) {
      const ticketId = recallMatch[1]
      try {
        const db     = this.getDb()
        const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId) as any
        db.prepare(`UPDATE tickets SET recall_count=recall_count+1 WHERE id=?`).run(ticketId)
        const win = ticket?.window_id
          ? db.prepare('SELECT * FROM windows WHERE id=?').get(ticket.window_id) as any
          : null
        this.triggerAnnounce(ticket?.display_number ?? '', win?.label ?? 'Counter', ticket?.window_id ?? '')
        this.broadcastSSE('queue', this.getQueue())
        reply(200, { success: true })
      } catch (e) { reply(500, { error: String(e) }) }
      return
    }

    // ── POST /api/tickets/:id/serve ──────────────────────────────────────────
    const serveMatch = path.match(/^\/api\/tickets\/([^/]+)\/serve$/)
    if (method === 'POST' && serveMatch) {
      const ticketId = serveMatch[1]
      try {
        const db     = this.getDb()
        const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId) as any
        if (ticket?.window_id) db.prepare(`UPDATE windows SET current_ticket_id=NULL WHERE id=?`).run(ticket.window_id)
        db.prepare(`UPDATE tickets SET status='served',served_at=? WHERE id=?`).run(new Date().toISOString(), ticketId)
        this.broadcastSSE('queue', this.getQueue())
        this.broadcastSSE('stats', this.getStats())
        reply(200, { success: true })
      } catch (e) { reply(500, { error: String(e) }) }
      return
    }

    // ── POST /api/tickets/:id/skip ───────────────────────────────────────────
    const skipMatch = path.match(/^\/api\/tickets\/([^/]+)\/skip$/)
    if (method === 'POST' && skipMatch) {
      const ticketId = skipMatch[1]
      try {
        const db = this.getDb()
        db.prepare(`UPDATE tickets SET status='skipped' WHERE id=?`).run(ticketId)
        this.broadcastSSE('queue', this.getQueue())
        this.broadcastSSE('stats', this.getStats())
        reply(200, { success: true })
      } catch (e) { reply(500, { error: String(e) }) }
      return
    }

    // ── GET / — serve the web operator panel ────────────────────────────────
    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(this.buildPanel())
      return
    }

    reply(404, { error: 'Not found' })
  }

  private triggerAnnounce(displayNumber: string, windowLabel: string, windowId: string, mode: 'ticket' | 'card' | 'name' = 'ticket') {
    const win = this.getOperatorWindow()
    if (!win || win.isDestroyed()) return
    const lang = this.getLanguage()
    const text = buildAnnouncementText(displayNumber, windowLabel, lang, mode)
    win.webContents.send('lan:announce', { text, displayNumber, windowId })
  }

  private getLanguage(): string {
    try {
      const config = readLocalConfig()
      const instCfg = config.installationConfig as any
      const langCode: string = instCfg?.announcement?.language ?? instCfg?.language ?? 'en'
      return langCode.split('-')[0].toLowerCase()
    } catch {
      return 'en'
    }
  }

  private buildPanel(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>Queue Panel</title>
<style>
/* ── Reset ───────────────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
:root{
  --bg:#0d1117;
  --surface:#161b22;
  --surface2:#1c2128;
  --border:#30363d;
  --border2:#21262d;
  --text:#e6edf3;
  --muted:#8b949e;
  --cyan:#39d0d8;
  --blue:#58a6ff;
  --green:#3fb950;
  --amber:#d29922;
  --red:#f85149;
  --purple:#bc8cff;
  --accent:#1f6feb;
  --accent-hover:#388bfd;
}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);display:flex;flex-direction:column;height:100vh}

/* ── LOGIN ───────────────────────────────────────────────── */
#login-screen{flex:1;display:flex;align-items:center;justify-content:center;background:var(--bg)}
.login-wrap{width:420px}
.login-brand{text-align:center;margin-bottom:28px}
.login-brand .icon{font-size:40px}
.login-brand h1{font-size:22px;font-weight:700;margin-top:10px;color:var(--text)}
.login-brand p{font-size:13px;color:var(--muted);margin-top:4px}
.login-box{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:28px}
.f{margin-bottom:16px}
.f label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:6px}
.f input,.f select{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:9px 12px;font-size:14px;color:var(--text);outline:none;transition:border-color 0.15s}
.f input:focus,.f select:focus{border-color:var(--accent)}
.f input::placeholder{color:#484f58}
.f select option{background:var(--surface)}
#window-field{display:none}
.role-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.role-card{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:14px 10px;text-align:center;cursor:pointer;transition:all 0.15s;user-select:none}
.role-card:hover{border-color:#484f58}
.role-card.active{border-color:var(--accent);background:#1f2d3d}
.role-card .ri{font-size:24px;margin-bottom:6px}
.role-card .rl{font-size:13px;font-weight:600;color:var(--text)}
.role-card .rs{font-size:11px;color:var(--muted);margin-top:2px}
.btn-login{width:100%;background:var(--accent);color:#fff;border:none;border-radius:6px;padding:11px;font-size:14px;font-weight:600;cursor:pointer;margin-top:4px;transition:background 0.15s}
.btn-login:hover{background:var(--accent-hover)}
.btn-login:disabled{background:#21262d;color:#484f58;cursor:not-allowed}

/* ── APP SHELL ───────────────────────────────────────────── */
#app{display:none;flex-direction:column;height:100vh;overflow:hidden}

/* ── TOPBAR ──────────────────────────────────────────────── */
.topbar{height:50px;min-height:50px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 16px;gap:12px;flex-shrink:0}
.topbar-brand{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:var(--text)}
.topbar-brand span{font-size:18px}
.topbar-sep{width:1px;height:20px;background:var(--border)}
.topbar-ctx{font-size:13px;color:var(--muted);flex:1}
.topbar-ctx b{color:var(--text)}
.topbar-right{display:flex;align-items:center;gap:10px}
.conn-pill{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);background:var(--bg);border:1px solid var(--border);border-radius:20px;padding:3px 10px}
.cdot{width:6px;height:6px;border-radius:50%;background:var(--green);flex-shrink:0}
.cdot.off{background:var(--red)}
.user-chip{background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:3px 12px 3px 6px;display:flex;align-items:center;gap:6px;font-size:12px}
.av{width:22px;height:22px;border-radius:50%;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.av.reception{background:#553098;color:#c4b5fd}
.av.room{background:#0d4b6e;color:#7dd3fc}
.btn-out{background:transparent;border:1px solid var(--border);border-radius:5px;padding:4px 10px;font-size:11px;color:var(--muted);cursor:pointer;transition:all 0.15s}
.btn-out:hover{background:var(--surface2);color:var(--text)}

/* ── STATS BAR ───────────────────────────────────────────── */
.statsbar{height:52px;min-height:52px;display:grid;grid-template-columns:repeat(4,1fr);background:var(--surface2);border-bottom:1px solid var(--border);flex-shrink:0}
.sb{display:flex;align-items:center;justify-content:center;gap:10px;border-right:1px solid var(--border2)}
.sb:last-child{border-right:none}
.sb-n{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1}
.sb-l{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-top:2px}
.sb.w .sb-n{color:var(--blue)}
.sb.c .sb-n{color:var(--amber)}
.sb.s .sb-n{color:var(--green)}
.sb.k .sb-n{color:var(--red)}

/* ── MAIN CONTENT (fills remaining height) ───────────────── */
#content-area{flex:1;overflow:hidden;display:flex}

/* ── COLUMNS ─────────────────────────────────────────────── */
.col{display:flex;flex-direction:column;overflow:hidden;border-right:1px solid var(--border)}
.col:last-child{border-right:none}
.col-hd{padding:9px 14px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.col-hd-title{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px}
.col-hd-badge{font-size:11px;font-weight:700;color:var(--cyan)}
.col-body{flex:1;overflow-y:auto}
.col-body::-webkit-scrollbar{width:4px}
.col-body::-webkit-scrollbar-track{background:transparent}
.col-body::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}

/* ── SECTION WITHIN COL ──────────────────────────────────── */
.sec{border-bottom:1px solid var(--border2)}
.sec-hd{padding:8px 14px;font-size:10px;font-weight:700;color:#484f58;text-transform:uppercase;letter-spacing:0.5px;background:var(--bg)}

/* ── CATEGORY BUTTONS (issue / call) ─────────────────────── */
.cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;padding:12px}
.cat-btn{background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;display:flex;flex-direction:column;align-items:center;gap:3px}
.cat-btn:hover:not(:disabled){border-color:#444c56;background:#21262d;transform:translateY(-1px)}
.cat-btn:active:not(:disabled){transform:translateY(0)}
.cat-btn:disabled{opacity:0.4;cursor:not-allowed}
.cat-btn .cc{font-size:16px;font-weight:800;letter-spacing:0.5px}
.cat-btn .cl{font-size:10px;color:var(--muted)}
.cat-btn .cn{font-size:11px;font-weight:700;margin-top:2px}

/* ── CALL BY NAME ────────────────────────────────────────── */
.name-box{padding:10px 12px;display:flex;gap:6px;border-top:1px solid var(--border2)}
.name-inp{flex:1;background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:7px 10px;font-size:13px;color:var(--text);outline:none}
.name-inp:focus{border-color:var(--accent)}
.name-inp::placeholder{color:#484f58}
.name-go{background:var(--accent);color:#fff;border:none;border-radius:5px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;transition:background 0.15s}
.name-go:hover{background:var(--accent-hover)}
.name-go:disabled{background:#21262d;color:#484f58;cursor:not-allowed}

/* ── TICKET ROWS ─────────────────────────────────────────── */
.tr{border-bottom:1px solid var(--border2);padding:9px 14px;display:flex;align-items:center;gap:10px;transition:background 0.1s}
.tr:last-child{border-bottom:none}
.tr:hover{background:var(--surface2)}
.tr-num{font-size:16px;font-weight:800;min-width:52px;font-variant-numeric:tabular-nums}
.tr-info{flex:1;min-width:0}
.tr-cat{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tr-name{font-size:11px;color:#484f58;margin-top:1px}
.tr-time{font-size:10px;color:#484f58;white-space:nowrap}
.tr-acts{display:flex;gap:3px;flex-shrink:0}
.btn{border:none;border-radius:5px;padding:5px 9px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.1s;white-space:nowrap}
.btn-r{background:#2d1f0a;color:var(--amber);border:1px solid #3d2a0d}.btn-r:hover{background:#3d2a0d}
.btn-s{background:#0d2b1a;color:var(--green);border:1px solid #113823}.btn-s:hover{background:#113823}
.btn-k{background:var(--surface2);color:var(--muted);border:1px solid var(--border)}.btn-k:hover{background:#21262d}

/* ── CURRENT TICKET (room) ───────────────────────────────── */
.cur-panel{padding:16px 14px;text-align:center;background:var(--surface2);border-bottom:1px solid var(--border);flex-shrink:0}
.cur-lbl{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px}
.cur-num{font-size:72px;font-weight:900;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:2px}
.cur-num.empty{color:#21262d;font-size:48px}
.cur-cat{font-size:12px;color:var(--muted);margin-top:6px}
.cur-name{font-size:13px;color:var(--cyan);margin-top:3px;font-weight:500}
.cur-acts{display:flex;gap:8px;margin-top:14px;justify-content:center}
.cur-acts .btn{flex:1;max-width:130px;padding:8px}

/* ── POPUP ───────────────────────────────────────────────── */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:200}
.pop{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:32px 28px;text-align:center;min-width:240px;animation:pop .2s ease-out}
@keyframes pop{from{transform:scale(.85);opacity:0}to{transform:scale(1);opacity:1}}
.pop-lbl{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px}
.pop-num{font-size:64px;font-weight:900;line-height:1;letter-spacing:2px;font-variant-numeric:tabular-nums}
.pop-cat{font-size:13px;color:var(--muted);margin-top:6px;margin-bottom:20px}
.btn-ok{background:var(--accent);color:#fff;border:none;border-radius:6px;padding:10px 28px;font-size:14px;font-weight:600;cursor:pointer;width:100%}
.btn-ok:hover{background:var(--accent-hover)}

/* ── FLASH ───────────────────────────────────────────────── */
.flash{animation:flash .7s ease-out}
@keyframes flash{0%{background:#1a3a2a}100%{background:transparent}}

.empty{padding:24px;text-align:center;color:#484f58;font-size:13px}
</style>
</head>
<body>

<!-- ══ LOGIN ══ -->
<div id="login-screen">
  <div class="login-wrap">
    <div class="login-brand">
      <div class="icon">&#128250;</div>
      <h1>Queue Operator Panel</h1>
      <p>Sign in to continue</p>
    </div>
    <div class="login-box">
      <div class="f">
        <label>Your Name</label>
        <input id="inp-name" type="text" placeholder="e.g. Dr. Amina or Front Desk" autocomplete="off"/>
      </div>
      <div class="f">
        <label>Role</label>
        <div class="role-row">
          <div class="role-card active" id="role-reception" onclick="selRole('reception')">
            <div class="ri">&#128203;</div>
            <div class="rl">Reception</div>
            <div class="rs">Issue &amp; manage</div>
          </div>
          <div class="role-card" id="role-room" onclick="selRole('room')">
            <div class="ri">&#128137;</div>
            <div class="rl">Room / Doctor</div>
            <div class="rs">Call patients</div>
          </div>
        </div>
      </div>
      <div class="f" id="window-field">
        <label>Your Room / Window</label>
        <select id="inp-window">
          <option value="">&#8212; Select &#8212;</option>
        </select>
      </div>
      <button class="btn-login" id="btn-enter" onclick="doLogin()" disabled>Enter Panel</button>
    </div>
  </div>
</div>

<!-- ══ APP ══ -->
<div id="app">

  <div class="topbar">
    <div class="topbar-brand"><span>&#128250;</span> Queue Panel</div>
    <div class="topbar-sep"></div>
    <div class="topbar-ctx" id="ctx-label">—</div>
    <div class="topbar-right">
      <div class="conn-pill"><div class="cdot" id="cdot"></div><span id="conn-lbl">Live</span></div>
      <div class="user-chip">
        <div class="av" id="av">?</div>
        <span id="hd-user">—</span>
      </div>
      <button class="btn-out" onclick="doLogout()">Sign out</button>
    </div>
  </div>

  <div class="statsbar">
    <div class="sb w"><div><div class="sb-n" id="s-w">0</div><div class="sb-l">Waiting</div></div></div>
    <div class="sb c"><div><div class="sb-n" id="s-c">0</div><div class="sb-l">Called</div></div></div>
    <div class="sb s"><div><div class="sb-n" id="s-s">0</div><div class="sb-l">Served</div></div></div>
    <div class="sb k"><div><div class="sb-n" id="s-k">0</div><div class="sb-l">Skipped</div></div></div>
  </div>

  <div id="content-area"></div>

</div>

<!-- Ticket issued popup -->
<div id="issue-pop" style="display:none" class="overlay" onclick="closePop()">
  <div class="pop" onclick="event.stopPropagation()">
    <div class="pop-lbl">Ticket Issued</div>
    <div class="pop-num" id="pop-num">—</div>
    <div class="pop-cat" id="pop-cat"></div>
    <button class="btn-ok" onclick="closePop()">&#10003; Done</button>
  </div>
</div>

<script>
const API_TOKEN='${this.apiToken}'
const H={'Content-Type':'application/json','Authorization':'Bearer '+API_TOKEN}
let state={tickets:[],windows:[],categories:[]}
let stats={waiting:0,called:0,served:0,skipped:0}
let session=null, es=null, selRole_='reception'

// ── helpers ──────────────────────────────────────────────────────────────────
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function catFor(id){return state.categories.find(c=>c.id===id)}
function winFor(id){return state.windows.find(w=>w.id===id)}
function waitFor(catId){return state.tickets.filter(t=>t.status==='waiting'&&t.category_id===catId).length}
function ago(iso){if(!iso)return'';const m=Math.floor((Date.now()-new Date(iso).getTime())/60000);return m<1?'now':m+'m'}
function initials(n){return n.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()}

// ── login ─────────────────────────────────────────────────────────────────────
function selRole(r){
  selRole_=r
  document.getElementById('role-reception').classList.toggle('active',r==='reception')
  document.getElementById('role-room').classList.toggle('active',r==='room')
  document.getElementById('window-field').style.display=r==='room'?'block':'none'
  chkLogin()
}
function chkLogin(){
  const n=document.getElementById('inp-name').value.trim()
  const w=document.getElementById('inp-window').value
  document.getElementById('btn-enter').disabled=n.length<2||(selRole_==='room'&&!w)
}
document.getElementById('inp-name').addEventListener('input',chkLogin)
document.getElementById('inp-window').addEventListener('change',chkLogin)

async function loadWins(){
  try{
    const cfg=await fetch('/api/config').then(r=>r.json())
    const sel=document.getElementById('inp-window')
    sel.innerHTML='<option value="">&#8212; Select &#8212;</option>'+
      cfg.windows.filter(w=>w.is_active).map(w=>\`<option value="\${w.id}" data-lbl="\${esc(w.label)}">\${esc(w.label)}</option>\`).join('')
  }catch{}
}
loadWins()

function doLogin(){
  const name=document.getElementById('inp-name').value.trim()
  const sel=document.getElementById('inp-window')
  session={name,role:selRole_,windowId:sel.value,windowLabel:sel.options[sel.selectedIndex]?.dataset.lbl??''}
  localStorage.setItem('op_session',JSON.stringify(session))
  startApp()
}

function doLogout(){
  if(es){es.close();es=null}
  localStorage.removeItem('op_session')
  session=null
  document.getElementById('login-screen').style.display='flex'
  document.getElementById('app').style.display='none'
  loadWins()
}

// ── startup ───────────────────────────────────────────────────────────────────
function startApp(){
  document.getElementById('login-screen').style.display='none'
  document.getElementById('app').style.display='flex'
  const av=document.getElementById('av')
  av.textContent=initials(session.name)
  av.className='av '+session.role
  document.getElementById('hd-user').textContent=session.name
  document.getElementById('ctx-label').innerHTML=
    session.role==='reception'
      ? '<b>Reception</b> — Issue &amp; manage all tickets'
      : '<b>'+esc(session.windowLabel)+'</b> — '+esc(session.name)
  session.role==='reception'?buildReception():buildRoom()
  connectSSE()
  fetch('/api/queue').then(r=>r.json()).then(d=>{state=d;render()})
  fetch('/api/stats').then(r=>r.json()).then(s=>{stats=s;renderStats()})
}

window.addEventListener('DOMContentLoaded',()=>{
  const saved=localStorage.getItem('op_session')
  if(saved){try{session=JSON.parse(saved);document.getElementById('inp-name').value=session.name;selRole(session.role);startApp();return}catch{}}
})

// ── SSE ───────────────────────────────────────────────────────────────────────
function connectSSE(){
  if(es)es.close()
  es=new EventSource('/api/events?token='+API_TOKEN)
  const dot=document.getElementById('cdot'),lbl=document.getElementById('conn-lbl')
  es.onopen=()=>{dot.classList.remove('off');lbl.textContent='Live'}
  es.onerror=()=>{dot.classList.add('off');lbl.textContent='Reconnecting'}
  es.addEventListener('queue',e=>{state=JSON.parse(e.data);render()})
  es.addEventListener('stats',e=>{stats=JSON.parse(e.data);renderStats()})
  es.addEventListener('announce',e=>{
    const d=JSON.parse(e.data)
    if(session?.role==='room'&&d.windowId===session.windowId){
      const el=document.getElementById('cur-panel')
      if(el){el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash')}
    }
  })
}

function renderStats(){
  document.getElementById('s-w').textContent=stats.waiting
  document.getElementById('s-c').textContent=stats.called
  document.getElementById('s-s').textContent=stats.served
  document.getElementById('s-k').textContent=stats.skipped
}
function render(){session?.role==='reception'?renderReception():renderRoom()}

// ══════════════════════════════════════════════════════════════════════════════
// RECEPTION  — 3-column landscape layout
// ══════════════════════════════════════════════════════════════════════════════
function buildReception(){
  document.getElementById('content-area').innerHTML=\`
    <div class="col" style="width:260px;min-width:220px">
      <div class="col-hd"><span class="col-hd-title">&#127915; Issue Ticket</span></div>
      <div class="col-body">
        <div class="cat-grid" id="issue-grid"></div>
        <div class="sec">
          <div class="sec-hd">Call by Name</div>
          <div class="name-box">
            <input class="name-inp" id="rec-name-inp" placeholder="Patient name…" onkeydown="if(event.key==='Enter')recCallName()"/>
            <button class="name-go" onclick="recCallName()">&#128222; Call</button>
          </div>
        </div>
      </div>
    </div>
    <div class="col" style="flex:1;min-width:0">
      <div class="col-hd">
        <span class="col-hd-title">&#9203; Waiting</span>
        <span class="col-hd-badge" id="q-badge"></span>
      </div>
      <div class="col-body" id="waiting-list"></div>
    </div>
    <div class="col" style="width:320px;min-width:260px">
      <div class="col-hd"><span class="col-hd-title">&#128222; Called &amp; Active</span></div>
      <div class="col-body" id="called-list"></div>
    </div>\`
}

function renderReception(){
  // Issue grid
  const ig=document.getElementById('issue-grid')
  if(ig)ig.innerHTML=!state.categories.length
    ?'<div class="empty">No categories</div>'
    :state.categories.map(c=>{
        const w=waitFor(c.id)
        return \`<div class="cat-btn" onclick="issueTicket('\${c.id}')" style="border-color:\${c.color}30">
          <div class="cc" style="color:\${c.color}">\${esc(c.code)}</div>
          <div class="cl">\${esc(c.label)}</div>
          <div class="cn" style="color:\${c.color}">\${w} waiting</div>
        </div>\`
      }).join('')

  // Waiting
  const waiting=state.tickets.filter(t=>t.status==='waiting')
  const qb=document.getElementById('q-badge')
  if(qb)qb.textContent=waiting.length||''
  const wl=document.getElementById('waiting-list')
  if(wl)wl.innerHTML=!waiting.length
    ?'<div class="empty">Queue is empty</div>'
    :waiting.map(t=>{
        const cat=catFor(t.category_id)
        return \`<div class="tr">
          <div class="tr-num" style="color:\${cat?.color??'#58a6ff'}">\${esc(t.display_number)}</div>
          <div class="tr-info">
            <div style="font-size:13px;font-weight:600">\${esc(cat?.label??t.category_id)}</div>
            \${t.callee_name?'<div class="tr-name">'+esc(t.callee_name)+'</div>':''}
            <div class="tr-name">\${ago(t.created_at)} ago</div>
          </div>
        </div>\`
      }).join('')

  // Called
  const called=state.tickets.filter(t=>t.status==='called')
  const cl=document.getElementById('called-list')
  if(cl)cl.innerHTML=!called.length
    ?'<div class="empty">No tickets called yet</div>'
    :called.map(t=>{
        const cat=catFor(t.category_id)
        const win=winFor(t.window_id)
        return \`<div class="tr">
          <div class="tr-num" style="color:\${cat?.color??'#d29922'}">\${esc(t.display_number)}</div>
          <div class="tr-info">
            <div style="font-size:13px;font-weight:600">\${esc(cat?.label??'')}</div>
            \${t.callee_name?'<div class="tr-name">'+esc(t.callee_name)+'</div>':''}
            <div class="tr-cat">\${esc(win?.label??'')} · \${ago(t.called_at)} ago</div>
          </div>
          <div class="tr-acts">
            <button class="btn btn-r" onclick="doRecall('\${t.id}')">&#x21BA;</button>
            <button class="btn btn-s" onclick="doServe('\${t.id}')">&#x2713;</button>
            <button class="btn btn-k" onclick="doSkip('\${t.id}')">&#x23E9;</button>
          </div>
        </div>\`
      }).join('')
}

async function issueTicket(categoryId){
  const btn=event.currentTarget
  btn.style.opacity='0.5';btn.style.pointerEvents='none'
  try{
    const r=await fetch('/api/tickets/issue',{method:'POST',headers:H,body:JSON.stringify({categoryId})})
    const d=await r.json()
    if(d.ticket){
      const cat=state.categories.find(c=>c.id===categoryId)
      document.getElementById('pop-num').textContent=d.ticket.displayNumber
      document.getElementById('pop-num').style.color=cat?.color??'#39d0d8'
      document.getElementById('pop-cat').textContent=cat?.label??''
      document.getElementById('issue-pop').style.display='flex'
    }
  }finally{btn.style.opacity='1';btn.style.pointerEvents=''}
}
function closePop(){document.getElementById('issue-pop').style.display='none'}

async function recCallName(){
  const inp=document.getElementById('rec-name-inp')
  const name=inp.value.trim()
  if(!name)return
  await fetch('/api/call-name',{method:'POST',headers:H,body:JSON.stringify({name,windowId:''})})
  inp.value=''
}

// ══════════════════════════════════════════════════════════════════════════════
// ROOM VIEW  — 2-column landscape layout
// ══════════════════════════════════════════════════════════════════════════════
function buildRoom(){
  document.getElementById('content-area').innerHTML=\`
    <div class="col" style="width:280px;min-width:240px">
      <div class="cur-panel" id="cur-panel">
        <div class="cur-lbl">Now Serving</div>
        <div class="cur-num empty" id="cur-num">&#8212;</div>
        <div class="cur-cat" id="cur-cat">Ready to call</div>
        <div class="cur-name" id="cur-name"></div>
        <div class="cur-acts" id="cur-acts" style="display:none">
          <button class="btn btn-r" onclick="doRecall(curId())">&#x21BA; Recall</button>
          <button class="btn btn-s" onclick="doServe(curId())">&#x2713; Served</button>
          <button class="btn btn-k" onclick="doSkip(curId())">&#x23E9; Skip</button>
        </div>
      </div>
      <div class="col-hd" style="flex-shrink:0"><span class="col-hd-title">&#128222; Call Next</span></div>
      <div class="col-body">
        <div class="cat-grid" id="call-grid"></div>
        <div class="sec">
          <div class="sec-hd">Call by Name</div>
          <div class="name-box">
            <input class="name-inp" id="room-name-inp" placeholder="Patient name…" onkeydown="if(event.key==='Enter')roomCallName()"/>
            <button class="name-go" onclick="roomCallName()">&#128222; Call</button>
          </div>
        </div>
      </div>
    </div>
    <div class="col" style="flex:1;min-width:0">
      <div class="col-hd">
        <span class="col-hd-title">&#9203; Waiting</span>
        <span class="col-hd-badge" id="room-q-badge"></span>
      </div>
      <div class="col-body" id="room-waiting-list"></div>
    </div>\`
}

function curId(){
  const win=state.windows.find(w=>w.id===session?.windowId)
  return win?.current_ticket_id??null
}

function renderRoom(){
  const win=state.windows.find(w=>w.id===session?.windowId)
  const cur=win?.current_ticket_id?state.tickets.find(t=>t.id===win.current_ticket_id):null

  const numEl=document.getElementById('cur-num')
  const catEl=document.getElementById('cur-cat')
  const nameEl=document.getElementById('cur-name')
  const actEl=document.getElementById('cur-acts')
  if(numEl){
    if(cur){
      const cat=catFor(cur.category_id)
      numEl.textContent=cur.display_number
      numEl.className='cur-num'
      numEl.style.color=cat?.color??'#39d0d8'
      catEl.textContent=cat?.label??''
      nameEl.textContent=cur.callee_name??''
      actEl.style.display='flex'
    }else{
      numEl.innerHTML='&#8212;'
      numEl.className='cur-num empty'
      numEl.style.color=''
      catEl.textContent='Ready to call'
      nameEl.textContent=''
      actEl.style.display='none'
    }
  }

  const myCats=state.categories.filter(c=>{try{return JSON.parse(c.window_ids??'[]').includes(session?.windowId)}catch{return false}})
  const cats=myCats.length?myCats:state.categories

  const cg=document.getElementById('call-grid')
  if(cg)cg.innerHTML=!cats.length
    ?'<div class="empty">No categories assigned</div>'
    :cats.map(c=>{
        const w=waitFor(c.id)
        return \`<button class="cat-btn" onclick="callNext('\${c.id}')" \${w===0?'disabled':''} style="border-color:\${c.color}30">
          <div class="cc" style="color:\${c.color}">\${esc(c.code)}</div>
          <div class="cl">\${esc(c.label)}</div>
          <div class="cn" style="color:\${w>0?'#d29922':'#484f58'}">\${w} waiting</div>
        </button>\`
      }).join('')

  const myWaiting=state.tickets.filter(t=>
    t.status==='waiting'&&(myCats.length?myCats.some(c=>c.id===t.category_id):true)
  ).slice(0,30)
  const rwl=document.getElementById('room-waiting-list')
  const rb=document.getElementById('room-q-badge')
  if(rb)rb.textContent=myWaiting.length||''
  if(rwl)rwl.innerHTML=!myWaiting.length
    ?'<div class="empty">No patients waiting &#10003;</div>'
    :myWaiting.map(t=>{
        const cat=catFor(t.category_id)
        return \`<div class="tr">
          <div class="tr-num" style="color:\${cat?.color??'#58a6ff'};font-size:15px;min-width:50px">\${esc(t.display_number)}</div>
          <div class="tr-info">
            <div style="font-size:12px;font-weight:600">\${esc(cat?.label??'')}</div>
            \${t.callee_name?'<div class="tr-name">'+esc(t.callee_name)+'</div>':''}
          </div>
          <div class="tr-time">\${ago(t.created_at)}</div>
        </div>\`
      }).join('')
}

async function callNext(categoryId){
  if(!session?.windowId)return
  await fetch('/api/tickets/next/'+session.windowId+'/'+categoryId,{method:'POST',headers:H})
}

async function roomCallName(){
  const inp=document.getElementById('room-name-inp')
  const name=inp.value.trim()
  if(!name||!session?.windowId)return
  await fetch('/api/call-name',{method:'POST',headers:H,body:JSON.stringify({name,windowId:session.windowId})})
  inp.value=''
}

// ─── Shared ───────────────────────────────────────────────────────────────────
async function doRecall(id){if(id)await fetch('/api/tickets/'+id+'/recall',{method:'POST',headers:H})}
async function doServe(id){if(id)await fetch('/api/tickets/'+id+'/serve',{method:'POST',headers:H})}
async function doSkip(id){if(id)await fetch('/api/tickets/'+id+'/skip',{method:'POST',headers:H})}
</script>
</body>
</html>`
  }
}
