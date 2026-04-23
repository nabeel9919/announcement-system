/**
 * LAN HTTP Server — serves a web-based operator panel on the local network.
 * Staff on other computers open http://<SERVER_IP>:4000 in their browser.
 * No new npm dependencies — uses Node.js built-ins only.
 */
import * as http from 'http'
import * as os from 'os'
import * as fs from 'fs'
import * as nodePath from 'path'
import { randomUUID, createHash } from 'crypto'
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

function buildAnnouncementText(
  displayNumber: string,
  windowLabel: string,
  lang: string,
  mode: 'ticket' | 'card' | 'name',
  phrases?: { ticket: string; card: string; name: string },
): string {
  if (phrases) {
    const expanded = expandNumber(displayNumber)
    const tmpl = mode === 'name' ? phrases.name : mode === 'card' ? phrases.card : phrases.ticket
    if (tmpl) return tmpl
      .replace('{number}', mode === 'name' ? displayNumber : expanded)
      .replace('{name}', displayNumber)
      .replace('{window}', windowLabel)
  }
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
  private floorPlansDir: string = ''

  // ── Security ─────────────────────────────────────────────────────────────
  private apiToken: string = ''
  /** Separate token for kiosk tablets — lower privilege than operator token */
  private kioskToken: string = ''
  /** ip → { failures, windowStart } */
  private rateLimiter = new Map<string, { failures: number; windowStart: number }>()
  private readonly RATE_MAX = 10
  private readonly RATE_WINDOW_MS = 5 * 60 * 1000   // 5 min sliding window
  private readonly RATE_BLOCK_MS  = 15 * 60 * 1000  // 15 min block after max failures

  constructor(getDb: GetDb, getOperatorWindow: GetWindow, port = 4000, floorPlansDir = '') {
    this.getDb = getDb
    this.getOperatorWindow = getOperatorWindow
    this.port = port
    this.floorPlansDir = floorPlansDir
  }

  getUrl(): string | null {
    if (this.actualPort === null) return null
    return `http://${getLocalIp()}:${this.actualPort}`
  }

  getToken(): string { return this.apiToken }
  getKioskToken(): string { return this.kioskToken }
  getPort(): number { return this.actualPort ?? this.port }

  // ── Token persistence ────────────────────────────────────────────────────
  private initToken(): void {
    const config = readLocalConfig() as any
    const stored = config.lanApiToken
    // Accept only a clean hex token — regenerate if missing, wrong type, too short, or has non-hex chars
    if (stored && typeof stored === 'string' && stored.length >= 32 && /^[0-9a-f]+$/i.test(stored)) {
      this.apiToken = stored
    } else {
      // Generate a 40-character hex token
      this.apiToken = Array.from({ length: 5 }, () => randomUUID().replace(/-/g, '')).join('').slice(0, 40)
      writeLocalConfig({ lanApiToken: this.apiToken } as any)
      console.log('[LAN] New API token generated and saved.')
    }
    console.log(`[LAN] API token: ${this.apiToken.slice(0, 8)}…${this.apiToken.slice(-4)}`)
  }

  private initKioskToken(): void {
    const config = readLocalConfig() as any
    const stored = config.kioskToken
    if (stored && typeof stored === 'string' && stored.length >= 32 && /^[0-9a-f]+$/i.test(stored)) {
      this.kioskToken = stored
    } else {
      this.kioskToken = Array.from({ length: 5 }, () => randomUUID().replace(/-/g, '')).join('').slice(0, 40)
      writeLocalConfig({ kioskToken: this.kioskToken } as any)
      console.log('[LAN] New kiosk token generated and saved.')
    }
    console.log(`[LAN] Kiosk token: ${this.kioskToken.slice(0, 8)}…${this.kioskToken.slice(-4)}`)
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

  private checkKioskAuth(req: http.IncomingMessage): boolean {
    const auth = req.headers['authorization'] ?? ''
    return auth === `Bearer ${this.kioskToken}`
  }

  private validKioskToken(t: string | null): boolean {
    return !!t && t === this.kioskToken
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
    this.initKioskToken()
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

    // ── Bearer-token check for operator write endpoints ──────────────────────
    // Kiosk POST endpoints (/api/kiosk/*) use the kiosk token — handled separately below.
    const isKioskPost = method === 'POST' && (path === '/api/kiosk/issue' || path === '/api/kiosk/feedback')
    if (method === 'POST' && !isKioskPost) {
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
      const ping = setInterval(() => {
        try { res.write(`event: ping\ndata: {}\n\n`) }
        catch { clearInterval(ping); this.sseClients.delete(res) }
      }, 25000)
      req.socket.on('close', () => { clearInterval(ping); this.sseClients.delete(res) })
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

    // ── POST /api/auth/login ─────────────────────────────────────────────────
    if (method === 'POST' && path === '/api/auth/login') {
      const body = await readBody(req) as { username?: string; password?: string }
      if (!body.username || !body.password) { reply(400, { error: 'Username and password required' }); return }
      try {
        const db   = this.getDb()
        const hash = createHash('sha256').update(body.password).digest('hex')
        const row  = db.prepare('SELECT * FROM users WHERE username=? AND is_active=1').get(body.username) as any
        if (!row || row.password_hash !== hash) {
          this.recordFailure(ip)
          reply(401, { error: 'Invalid username or password' })
          return
        }
        this.clearFailures(ip)
        reply(200, { user: { id: row.id, username: row.username, displayName: row.display_name, role: row.role, windowId: row.window_id } })
      } catch (e) { reply(500, { error: String(e) }) }
      return
    }

    // ── POST /api/tickets/:id/no-show ────────────────────────────────────────
    const noShowMatch = path.match(/^\/api\/tickets\/([^/]+)\/no-show$/)
    if (method === 'POST' && noShowMatch) {
      const ticketId = noShowMatch[1]
      try {
        const db = this.getDb()
        const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId) as any
        if (ticket?.window_id) db.prepare('UPDATE windows SET current_ticket_id=NULL WHERE id=?').run(ticket.window_id)
        db.prepare('UPDATE tickets SET status=? WHERE id=?').run('no_show', ticketId)
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

    // ── GET /kiosk — serve the tablet kiosk page ─────────────────────────────
    if (method === 'GET' && path === '/kiosk') {
      const t = url.searchParams.get('token')
      if (!this.validKioskToken(t)) {
        this.recordFailure(ip)
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<html><body style="font-family:sans-serif;text-align:center;padding:4rem;background:#0a0a0f;color:#ef4444"><h2>Access Denied</h2><p>Invalid or missing kiosk token.</p></body></html>')
        return
      }
      this.clearFailures(ip)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(this.buildKioskPage())
      return
    }

    // ── GET /api/kiosk/config — categories + kiosk questions + feedback qs ───
    if (method === 'GET' && path === '/api/kiosk/config') {
      const t = url.searchParams.get('token')
      if (!this.validKioskToken(t)) {
        this.recordFailure(ip)
        console.warn(`[KIOSK] /api/kiosk/config: token mismatch from ${ip}. Got: ${t?.slice(0,8) ?? 'null'}…  Expected: ${this.kioskToken.slice(0,8)}…`)
        reply(401, { error: 'Invalid kiosk token. Regenerate the kiosk URL from Settings → Kiosk Tablets.' })
        return
      }
      this.clearFailures(ip)
      try {
        const db = this.getDb()
        const categories = db.prepare('SELECT * FROM categories ORDER BY code ASC').all()
        const kioskQuestions = db.prepare(`
          SELECT * FROM kiosk_questions WHERE is_enabled = 1
          ORDER BY order_index ASC, created_at ASC
        `).all()
        const feedbackQuestions = db.prepare(`
          SELECT * FROM feedback_questions WHERE is_enabled = 1
          ORDER BY order_index ASC, created_at ASC
        `).all()
        const orgName = (() => {
          try { return (readLocalConfig() as any).installationConfig?.organizationName ?? '' } catch { return '' }
        })()
        const hoursConfig = (() => {
          try {
            const lc = readLocalConfig() as any
            return lc.kioskHoursConfig ?? null
          } catch { return null }
        })()
        // Per-category waiting count + estimated wait for display on kiosk buttons
        const today = new Date().toISOString().slice(0, 10)
        const waitingByCat: Record<string, { waiting: number; estimatedMinutes: number }> = {}
        for (const cat of categories as any[]) {
          const waiting = (db.prepare(
            `SELECT COUNT(*) as c FROM tickets WHERE status='waiting' AND category_id=? AND created_at LIKE ?`
          ).get(cat.id, `${today}%`) as any).c
          const avgRow = db.prepare(
            `SELECT AVG((julianday(served_at)-julianday(called_at))*86400) as avg
             FROM tickets WHERE status='served' AND category_id=? AND created_at LIKE ? AND served_at IS NOT NULL`
          ).get(cat.id, `${today}%`) as any
          const avgSeconds = avgRow?.avg ?? null
          waitingByCat[cat.id] = {
            waiting,
            estimatedMinutes: waiting > 0 && avgSeconds
              ? Math.ceil((waiting * avgSeconds) / 60)
              : 0,
          }
        }
        reply(200, { categories, kioskQuestions, feedbackQuestions, orgName, hoursConfig, waitingByCat })
      } catch (e) { reply(500, { error: String(e) }) }
      return
    }

    // ── GET /api/kiosk/help — enabled help items for tablet ──────────────────
    if (method === 'GET' && path === '/api/kiosk/help') {
      const t = new URL('http://x' + req.url!).searchParams.get('token') ?? ''
      if (!this.validKioskToken(t)) { reply(401, { error: 'Unauthorized' }); return }
      try {
        const db = this.getDb()
        const items = db.prepare(
          `SELECT id, question, answer, category, icon, order_index FROM help_items WHERE is_enabled=1 ORDER BY order_index ASC`
        ).all()
        reply(200, { items })
      } catch (e) { reply(500, { error: String(e) }) }
      return
    }

    // ── GET /api/kiosk/floor-plans — floor plan list + pins for tablet ────────
    if (method === 'GET' && path === '/api/kiosk/floor-plans') {
      const t = new URL('http://x' + req.url!).searchParams.get('token') ?? ''
      if (!this.validKioskToken(t)) { reply(401, { error: 'Unauthorized' }); return }
      try {
        const db = this.getDb()
        const rows = db.prepare(`SELECT id, label, image_file, pins FROM floor_plans ORDER BY created_at ASC`).all() as { id: string; label: string; image_file: string; pins: string }[]
        const plans = rows.map(r => ({
          id: r.id,
          label: r.label,
          imageUrl: `/api/kiosk/floor-image/${encodeURIComponent(r.image_file)}?token=${t}`,
          pins: JSON.parse(r.pins || '[]'),
        }))
        const localCfg = readLocalConfig() as any
        const instCfg = localCfg?.installationConfig ?? localCfg ?? {}
        reply(200, { plans, currentFloorPlanId: instCfg?.currentFloorPlanId ?? '', currentPinId: instCfg?.currentPinId ?? '' })
      } catch (e) { reply(500, { error: String(e) }) }
      return
    }

    // ── GET /api/kiosk/floor-image/:filename — serve floor plan image ─────────
    if (method === 'GET' && path.startsWith('/api/kiosk/floor-image/')) {
      const t = new URL('http://x' + req.url!).searchParams.get('token') ?? ''
      if (!this.validKioskToken(t)) { res.writeHead(401); res.end(); return }
      const filename = decodeURIComponent(path.slice('/api/kiosk/floor-image/'.length))
      if (!filename || filename.includes('..') || filename.includes('/')) { res.writeHead(400); res.end(); return }
      const filePath = this.floorPlansDir ? nodePath.join(this.floorPlansDir, filename) : ''
      if (!filePath || !fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return }
      const ext = filename.split('.').pop()?.toLowerCase() ?? 'png'
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : 'image/png'
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'max-age=3600' })
      fs.createReadStream(filePath).pipe(res)
      return
    }

    // ── POST /api/kiosk/issue — issue a ticket from a tablet ─────────────────
    if (method === 'POST' && path === '/api/kiosk/issue') {
      if (!this.checkKioskAuth(req)) {
        this.recordFailure(ip)
        reply(401, { error: 'Unauthorized' })
        return
      }
      this.clearFailures(ip)
      const body = await readBody(req) as { categoryId: string; kioskId?: string; answers?: unknown[] }
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
        db.prepare(`
          INSERT INTO tickets (id,display_number,sequence_number,category_id,status,created_at,recall_count,answers)
          VALUES (?,?,?,?,'waiting',?,0,?)
        `).run(id, displayNumber, seq, body.categoryId, now, JSON.stringify(body.answers ?? []))
        this.broadcastSSE('queue', this.getQueue())
        this.broadcastSSE('stats', this.getStats())
        reply(200, { success: true, ticket: { id, displayNumber, sequenceNumber: seq, categoryId: body.categoryId, categoryLabel: cat.label, categoryColor: cat.color } })
      } catch (e) { reply(500, { error: String(e) }) }
      return
    }

    // ── POST /api/kiosk/feedback — submit feedback from a tablet ─────────────
    if (method === 'POST' && path === '/api/kiosk/feedback') {
      if (!this.checkKioskAuth(req)) {
        this.recordFailure(ip)
        reply(401, { error: 'Unauthorized' })
        return
      }
      this.clearFailures(ip)
      const body = await readBody(req) as { ticketId?: string; kioskId?: string; categoryId?: string; categoryLabel?: string; answers?: unknown[] }
      try {
        const db  = this.getDb()
        const id  = randomUUID()
        const now = new Date().toISOString()
        db.prepare(`
          INSERT INTO feedback_responses (id, submitted_at, category_id, category_label, answers)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, now, body.categoryId ?? null, body.categoryLabel ?? null, JSON.stringify(body.answers ?? []))
        reply(200, { success: true, id })
      } catch (e) { reply(500, { error: String(e) }) }
      return
    }

    reply(404, { error: 'Not found' })
  }

  private triggerAnnounce(displayNumber: string, windowLabel: string, windowId: string, mode: 'ticket' | 'card' | 'name' = 'ticket') {
    const win = this.getOperatorWindow()
    if (!win || win.isDestroyed()) return
    const lang = this.getLanguage()
    const phrases = this.getPhrases()
    const text = buildAnnouncementText(displayNumber, windowLabel, lang, mode, phrases)
    win.webContents.send('lan:announce', { text, displayNumber, windowId })
  }

  private getPhrases(): { ticket: string; card: string; name: string } | undefined {
    try {
      const cfg = readLocalConfig()
      return (cfg.installationConfig as any)?.announcementPhrases
    } catch { return undefined }
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

  private buildKioskPage(): string {
    // NOTE: all JS strings inside this template literal must use "double quotes"
    // Single-quote escapes (\'  ) are consumed by the template literal engine,
    // which would break the browser-side JS parser.
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Self Service Kiosk</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{height:100%;overflow:hidden;background:#0a0a0f;color:#f4f4f5;font-family:system-ui,-apple-system,sans-serif;touch-action:manipulation;user-select:none}
.screen{display:none;height:100vh;overflow:hidden}
.screen.active{display:flex;flex-direction:column}

/* ── Header ── */
.hdr{display:flex;align-items:center;justify-content:space-between;padding:20px 28px 16px;border-bottom:1px solid #27272a}
.hdr-org{font-size:clamp(14px,2.5vw,18px);font-weight:700;color:#f4f4f5;letter-spacing:.01em}
.hdr-sub{font-size:12px;color:#71717a;margin-top:2px}
.hdr-tag{display:flex;align-items:center;gap:6px;font-size:12px;color:#52525b;background:#18181b;border:1px solid #27272a;border-radius:20px;padding:4px 12px}
.hdr-dot{width:7px;height:7px;border-radius:50%;background:#22c55e}

/* ── Category grid ── */
.cats-body{flex:1;overflow-y:auto;padding:28px}
.cats-title{font-size:clamp(20px,4vw,32px);font-weight:800;color:#f4f4f5;text-align:center;margin-bottom:6px}
.cats-hint{font-size:clamp(13px,2vw,16px);color:#71717a;text-align:center;margin-bottom:28px}
.cats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;max-width:900px;margin:0 auto}
.cat-btn{position:relative;border:2px solid #27272a;border-radius:20px;background:#18181b;padding:28px 20px;text-align:left;cursor:pointer;transition:transform .12s,border-color .12s,background .12s;display:flex;flex-direction:column;gap:10px;min-height:140px}
.cat-btn:active{transform:scale(.97)}
.cat-code{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:14px;font-size:18px;font-weight:800;letter-spacing:.03em}
.cat-label{font-size:clamp(15px,2.5vw,18px);font-weight:700;color:#f4f4f5;line-height:1.25}
.cat-wait{font-size:12px;color:#71717a;margin-top:auto}
.cat-arrow{position:absolute;top:16px;right:18px;font-size:20px;color:#3f3f46}

/* ── Questions ── */
.qs-body{flex:1;overflow-y:auto;padding:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px}
.qs-prog{display:flex;gap:6px;justify-content:center}
.qs-prog-dot{width:8px;height:8px;border-radius:50%;background:#27272a;transition:background .2s}
.qs-prog-dot.done{background:#4f46e5}
.qs-prog-dot.active{background:#6366f1;width:24px;border-radius:4px}
.qs-text{font-size:clamp(18px,3.5vw,28px);font-weight:700;color:#f4f4f5;text-align:center;max-width:700px;line-height:1.35}
.qs-opts{display:flex;flex-direction:column;gap:12px;width:100%;max-width:600px}
.qs-opt{border:2px solid #27272a;border-radius:16px;background:#18181b;padding:18px 24px;font-size:clamp(15px,2.5vw,19px);font-weight:600;color:#d4d4d8;cursor:pointer;text-align:left;transition:border-color .12s,background .12s,color .12s}
.qs-opt:active{transform:scale(.98)}
.qs-opt.sel{border-color:#4f46e5;background:rgba(79,70,229,0.1);color:#818cf8}
.qs-text-inp{width:100%;max-width:600px;border:2px solid #27272a;border-radius:16px;background:#18181b;padding:18px 22px;font-size:18px;color:#f4f4f5;outline:none;transition:border-color .2s}
.qs-text-inp:focus{border-color:#4f46e5}
.qs-nav{display:flex;gap:12px;width:100%;max-width:600px}
.btn{border:none;border-radius:14px;padding:16px 28px;font-size:16px;font-weight:700;cursor:pointer;transition:opacity .12s,transform .1s}
.btn:active{transform:scale(.97)}
.btn-pri{background:linear-gradient(135deg,#4f46e5,#6366f1);color:#fff;flex:1}
.btn-sec{background:#18181b;border:2px solid #27272a;color:#a1a1aa}
.btn:disabled{opacity:.4;pointer-events:none}

/* ── Issuing ── */
.issuing-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px}
.spinner{width:56px;height:56px;border:4px solid #27272a;border-top-color:#6366f1;border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.issuing-txt{font-size:20px;font-weight:600;color:#a1a1aa}

/* ── Ticket ── */
.ticket-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px}
.ticket-card{border:2px solid #27272a;border-radius:28px;background:#18181b;padding:40px 60px;text-align:center;position:relative;overflow:hidden;width:100%;max-width:480px}
.ticket-card::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 50% 0%,#4f46e520 0%,transparent 60%);pointer-events:none}
.ticket-org{font-size:13px;color:#71717a;letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px}
.ticket-cat{font-size:18px;font-weight:700;margin-bottom:20px}
.ticket-label{font-size:14px;color:#71717a;letter-spacing:.05em;text-transform:uppercase;margin-bottom:6px}
.ticket-num{font-size:clamp(64px,14vw,100px);font-weight:900;line-height:1;letter-spacing:-.02em;background:linear-gradient(135deg,#818cf8,#c084fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:12px}
.ticket-hint{font-size:14px;color:#52525b;margin-top:8px}
.ticket-bar{width:100%;max-width:480px;height:4px;background:#27272a;border-radius:2px;overflow:hidden;margin-top:4px}
.ticket-bar-fill{height:100%;background:linear-gradient(90deg,#4f46e5,#6366f1);border-radius:2px;transition:width .5s linear}
.ticket-actions{display:flex;gap:12px;width:100%;max-width:480px;margin-top:8px}

/* ── Feedback ── */
.fb-body{flex:1;overflow-y:auto;padding:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px}
.fb-step{font-size:13px;color:#71717a;letter-spacing:.04em;text-transform:uppercase}
.fb-q{font-size:clamp(17px,3vw,26px);font-weight:700;color:#f4f4f5;text-align:center;max-width:620px;line-height:1.35}
.stars{display:flex;gap:12px;justify-content:center;margin:4px 0}
.star-btn{font-size:44px;cursor:pointer;transition:transform .1s,filter .1s;filter:grayscale(1) opacity(.5)}
.star-btn.sel{filter:none;transform:scale(1.15)}
.star-btn:active{transform:scale(1.05)}
.emojis{display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
.emoji-btn{display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;padding:12px;border-radius:16px;border:2px solid #27272a;background:#18181b;transition:border-color .12s,background .12s;min-width:70px}
.emoji-btn .em{font-size:36px}
.emoji-btn .el{font-size:12px;color:#71717a}
.emoji-btn.sel{border-color:#4f46e5;background:rgba(79,70,229,0.1)}
.emoji-btn:active{transform:scale(.97)}
.fb-opts{display:flex;flex-direction:column;gap:10px;width:100%;max-width:560px}
.fb-opt{border:2px solid #27272a;border-radius:14px;background:#18181b;padding:16px 20px;font-size:16px;font-weight:600;color:#d4d4d8;cursor:pointer;text-align:left;transition:border-color .12s,background .12s,color .12s}
.fb-opt.sel{border-color:#4f46e5;background:rgba(79,70,229,0.1);color:#818cf8}
.fb-opt:active{transform:scale(.98)}
.fb-text-inp{width:100%;max-width:560px;border:2px solid #27272a;border-radius:14px;background:#18181b;padding:16px 18px;font-size:16px;color:#f4f4f5;outline:none;resize:none;height:100px;transition:border-color .2s}
.fb-text-inp:focus{border-color:#4f46e5}
.fb-nav{display:flex;gap:12px;width:100%;max-width:560px}

/* ── Thanks ── */
.thanks-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center}
.thanks-icon{font-size:72px;animation:popIn .4s cubic-bezier(.34,1.56,.64,1) both}
@keyframes popIn{from{transform:scale(0) rotate(-10deg);opacity:0}to{transform:scale(1) rotate(0);opacity:1}}
.thanks-title{font-size:clamp(28px,5vw,42px);font-weight:800;color:#f4f4f5}
.thanks-sub{font-size:clamp(15px,2.5vw,18px);color:#71717a;max-width:500px}
.thanks-reset{font-size:13px;color:#52525b;margin-top:8px}

/* ── Closed ── */
.closed-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:24px}
.closed-icon{font-size:64px;margin-bottom:4px}
.closed-title{font-size:clamp(26px,5vw,44px);font-weight:800;color:#f4f4f5}
.closed-msg{font-size:clamp(15px,2.5vw,18px);color:#71717a;max-width:520px;line-height:1.5}
.closed-hours{display:inline-flex;align-items:center;gap:8px;background:#18181b;border:1px solid #27272a;border-radius:12px;padding:10px 22px;font-size:14px;color:#52525b;margin-top:4px}

/* ── Error ── */
.err-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px}
.err-icon{font-size:56px}
.err-title{font-size:24px;font-weight:700;color:#ef4444}
.err-msg{font-size:15px;color:#71717a;max-width:420px}
.err-retry{background:#18181b;border:2px solid #27272a;color:#a1a1aa;border-radius:12px;padding:12px 28px;font-size:15px;font-weight:600;cursor:pointer;margin-top:8px}

/* ── Home ── */
.home-body{flex:1;overflow-y:auto;padding:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px}
.home-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;width:100%;max-width:600px}
.home-btn{border-radius:24px;border:2px solid;padding:32px 20px;display:flex;flex-direction:column;align-items:center;gap:14px;cursor:pointer;transition:transform .12s;text-align:center;width:100%;background:inherit}
.home-btn:active{transform:scale(.97)}
.home-btn-icon{width:64px;height:64px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0}
.home-btn-title{font-size:clamp(16px,2.5vw,20px);font-weight:700;color:#f4f4f5}
.home-btn-desc{font-size:13px;color:#71717a}
.home-help-btn{width:100%;max-width:600px;border-radius:24px;border:2px solid #10b98140;background:#10b98110;padding:20px 28px;display:flex;align-items:center;gap:20px;cursor:pointer;text-align:left}
.home-help-btn:active{transform:scale(.98)}

/* ── Help ── */
.help-title-bar{font-size:clamp(20px,4vw,30px);font-weight:800;color:#f4f4f5;text-align:center;padding:16px 28px 0;flex-shrink:0}
.help-body{flex:1;overflow-y:auto;padding:12px 28px 28px}
.help-cat-label{font-size:11px;font-weight:700;color:#52525b;text-transform:uppercase;letter-spacing:.08em;padding:16px 0 8px}
.help-card{border:1px solid #27272a;border-radius:16px;background:#18181b;overflow:hidden;cursor:pointer;margin-bottom:8px}
.help-card-hdr{display:flex;align-items:center;gap:12px;padding:16px 18px}
.help-card-icon{font-size:22px;flex-shrink:0}
.help-card-q{flex:1;font-size:clamp(14px,2vw,16px);font-weight:600;color:#f4f4f5;text-align:left}
.help-card-chev{font-size:18px;color:#52525b;transition:transform .2s;flex-shrink:0}
.help-card.open .help-card-chev{transform:rotate(180deg)}
.help-card-ans{display:none;padding:0 18px 16px 52px;font-size:14px;color:#a1a1aa;line-height:1.6}
.help-card.open .help-card-ans{display:block}
.back-btn{display:flex;align-items:center;gap:6px;background:none;border:none;color:#71717a;font-size:14px;cursor:pointer;padding:12px 28px;margin:0 auto;font-weight:500;flex-shrink:0}
/* ── Map ── */
.map-body{flex:1;overflow-y:auto;padding:8px 12px 12px;display:flex;flex-direction:column;gap:8px}
.map-plan-sel{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;padding:0 4px;flex-shrink:0}
.map-plan-tab{border-radius:20px;border:2px solid #27272a;background:#18181b;color:#a1a1aa;font-size:13px;font-weight:600;padding:6px 16px;cursor:pointer;transition:all .15s}
.map-plan-tab.active{border-color:#4f46e5;background:#4f46e510;color:#818cf8}
.map-img-wrap{position:relative;width:100%;border-radius:12px;overflow:hidden;border:1px solid #27272a;background:#09090b;flex-shrink:0}
.map-img-wrap img{width:100%;display:block}
.map-img-wrap svg{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none}
.map-pin-label{position:absolute;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer}
.map-pin-bubble{font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.4)}
.map-pin-dot{width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)}
.map-dest-info{border-radius:16px;border:1px solid #27272a;background:#18181b;padding:16px 18px;text-align:center;font-size:14px;color:#a1a1aa}
.map-dest-info strong{color:#f4f4f5;font-size:16px;display:block;margin-bottom:4px}
</style>
</head>
<body>

<!-- Home -->
<div id="s-home" class="screen">
  <div class="hdr">
    <div>
      <div class="hdr-org" id="home-hdr-org">Queue System</div>
      <div class="hdr-sub">Self Service</div>
    </div>
    <div class="hdr-tag"><div class="hdr-dot"></div><span id="home-hdr-kid"></span></div>
  </div>
  <div class="home-body">
    <div class="home-hint" style="font-size:clamp(14px,2.5vw,18px);color:#71717a;text-align:center">What would you like to do?</div>
    <div class="home-grid">
      <button class="home-btn" style="border-color:#4f46e540;background:#4f46e510" onclick="show('s-cats')">
        <div class="home-btn-icon" style="background:#4f46e5">🎫</div>
        <div class="home-btn-title">Get Ticket</div>
        <div class="home-btn-desc">Join the queue</div>
      </button>
      <button class="home-btn" style="border-color:#f59e0b40;background:#f59e0b10" onclick="startFeedbackFromHome()">
        <div class="home-btn-icon" style="background:#d97706">⭐</div>
        <div class="home-btn-title">Give Feedback</div>
        <div class="home-btn-desc">Rate our service</div>
      </button>
    </div>
    <button class="home-help-btn" onclick="showHelp()">
      <div class="home-btn-icon" style="background:#059669">❓</div>
      <div>
        <div class="home-btn-title">Help &amp; Information</div>
        <div class="home-btn-desc">Find answers and navigate the facility</div>
      </div>
    </button>
    <button class="home-help-btn" style="border-color:#3b82f640;background:#3b82f610" onclick="showMap()">
      <div class="home-btn-icon" style="background:#2563eb">🗺️</div>
      <div>
        <div class="home-btn-title">Floor Map</div>
        <div class="home-btn-desc">Find rooms and navigate the building</div>
      </div>
    </button>
  </div>
</div>

<!-- Help -->
<div id="s-help" class="screen">
  <div class="hdr">
    <div>
      <div class="hdr-org" id="help-hdr-org">Queue System</div>
      <div class="hdr-sub">Help &amp; Information</div>
    </div>
    <div class="hdr-tag"><div class="hdr-dot"></div><span id="help-hdr-kid"></span></div>
  </div>
  <div class="help-title-bar">Help &amp; FAQ</div>
  <div class="help-body" id="help-body">
    <p style="color:#52525b;text-align:center;padding:40px">Loading…</p>
  </div>
  <button class="back-btn" onclick="show('s-home')">‹ Back to Home</button>
</div>

<!-- Map -->
<div id="s-map" class="screen">
  <div class="hdr">
    <div>
      <div class="hdr-org" id="map-hdr-org">Queue System</div>
      <div class="hdr-sub">Floor Map</div>
    </div>
    <div class="hdr-tag"><div class="hdr-dot"></div><span id="map-hdr-kid"></span></div>
  </div>
  <div class="map-body">
    <div class="map-plan-sel" id="map-plan-sel"></div>
    <div class="map-img-wrap" id="map-img-wrap">
      <p style="color:#52525b;text-align:center;padding:40px">Loading map…</p>
    </div>
    <div class="map-dest-info" id="map-dest-info" style="display:none"></div>
  </div>
  <button class="back-btn" onclick="show(&quot;s-home&quot;)">&#8249; Back to Home</button>
</div>

<!-- Loading -->
<div id="s-loading" class="screen active">
  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px">
    <div class="spinner"></div>
    <p style="font-size:16px;color:#71717a">Loading…</p>
  </div>
</div>

<!-- Closed -->
<div id="s-closed" class="screen">
  <div class="closed-body">
    <div class="closed-icon">🕐</div>
    <div class="closed-title">We Are Closed</div>
    <div class="closed-msg" id="closed-msg">We are currently closed. Please visit us during our operating hours.</div>
    <div class="closed-hours" id="closed-hours" style="display:none"></div>
  </div>
</div>

<!-- Error -->
<div id="s-err" class="screen">
  <div class="err-body">
    <div class="err-icon">⚠️</div>
    <div class="err-title">Connection Error</div>
    <div class="err-msg" id="err-msg">Could not connect to the server.</div>
    <button class="err-retry" onclick="init()">Retry</button>
  </div>
</div>

<!-- Categories -->
<div id="s-cats" class="screen">
  <div class="hdr">
    <div>
      <div class="hdr-org" id="hdr-org">Queue System</div>
      <div class="hdr-sub">Self Service</div>
    </div>
    <div class="hdr-tag"><div class="hdr-dot"></div><span id="hdr-kid"></span></div>
  </div>
  <div class="cats-body">
    <div class="cats-title">Select a Service</div>
    <div class="cats-hint">Tap the service you need</div>
    <div class="cats-grid" id="cats-grid"></div>
  </div>
  <button class="back-btn" onclick="show('s-home')">‹ Back to Home</button>
</div>

<!-- Questions -->
<div id="s-qs" class="screen">
  <div class="hdr">
    <div>
      <div class="hdr-org" id="qs-hdr-org">Queue System</div>
      <div class="hdr-sub" id="qs-hdr-cat"></div>
    </div>
    <div class="hdr-tag"><div class="hdr-dot"></div><span id="qs-hdr-kid"></span></div>
  </div>
  <div class="qs-body">
    <div class="qs-prog" id="qs-prog"></div>
    <div class="qs-text" id="qs-text"></div>
    <div id="qs-input-area"></div>
    <div class="qs-nav">
      <button class="btn btn-sec" id="qs-back" onclick="qsBack()">Back</button>
      <button class="btn btn-pri" id="qs-next" onclick="qsNext()" disabled>Next</button>
    </div>
  </div>
</div>

<!-- Issuing -->
<div id="s-issuing" class="screen">
  <div class="issuing-body">
    <div class="spinner"></div>
    <div class="issuing-txt">Issuing your ticket…</div>
  </div>
</div>

<!-- Ticket -->
<div id="s-ticket" class="screen">
  <div class="hdr">
    <div>
      <div class="hdr-org" id="tk-hdr-org">Queue System</div>
      <div class="hdr-sub">Your ticket</div>
    </div>
    <div class="hdr-tag"><div class="hdr-dot"></div><span id="tk-hdr-kid"></span></div>
  </div>
  <div class="ticket-body">
    <div class="ticket-card">
      <div class="ticket-org" id="tk-org"></div>
      <div class="ticket-cat" id="tk-cat-label"></div>
      <div class="ticket-label">Your number</div>
      <div class="ticket-num" id="tk-num"></div>
      <div class="ticket-hint">Please wait until your number is called</div>
    </div>
    <div class="ticket-bar"><div class="ticket-bar-fill" id="tk-bar" style="width:100%"></div></div>
    <div class="ticket-actions">
      <button class="btn btn-sec" onclick="resetKiosk()" style="flex:1">Done</button>
      <button class="btn btn-pri" id="tk-feedback-btn" onclick="startFeedback()" style="flex:1">Give Feedback</button>
    </div>
  </div>
</div>

<!-- Feedback -->
<div id="s-fb" class="screen">
  <div class="hdr">
    <div>
      <div class="hdr-org" id="fb-hdr-org">Queue System</div>
      <div class="hdr-sub">Feedback</div>
    </div>
    <div class="hdr-tag"><div class="hdr-dot"></div><span id="fb-hdr-kid"></span></div>
  </div>
  <div class="fb-body">
    <div class="fb-step" id="fb-step"></div>
    <div class="fb-q" id="fb-q"></div>
    <div id="fb-input-area"></div>
    <div class="fb-nav">
      <button class="btn btn-sec" id="fb-skip" onclick="fbSkip()">Skip</button>
      <button class="btn btn-pri" id="fb-next" onclick="fbNext()" disabled>Next</button>
    </div>
  </div>
</div>

<!-- Thanks -->
<div id="s-thanks" class="screen">
  <div class="thanks-body">
    <div class="thanks-icon">🎉</div>
    <div class="thanks-title">Thank You!</div>
    <div class="thanks-sub">Your feedback helps us serve you better.</div>
    <div class="thanks-reset" id="thanks-reset-txt"></div>
  </div>
</div>

<script>
// ── Bootstrap ────────────────────────────────────────────────────────────────
var params = new URLSearchParams(location.search)
var TOKEN = params.get("token") || ""
var KIOSK_ID = params.get("kid") || ""
var KIOSK_LABEL = params.get("label") ? decodeURIComponent(params.get("label")) : (KIOSK_ID ? "Kiosk " + KIOSK_ID : "Kiosk")

// ── State ────────────────────────────────────────────────────────────────────
var categories = [], kioskQuestions = [], feedbackQuestions = [], orgName = ""
var hoursConfig = null, waitingByCat = {}, hoursCheckInterval = null
var selCat = null
var visibleQs = [], qIdx = 0, qAnswers = []
var visibleFbQs = [], fbIdx = 0, fbAnswers = []
var issuedTicket = null
var resetTimer = null

// ── Helpers ──────────────────────────────────────────────────────────────────
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") }

function isWithinHours(cfg) {
  if (!cfg || !cfg.enabled) return true
  var now = new Date()
  var day = now.getDay()
  var days = cfg.days || [0,1,2,3,4,5,6]
  if (days.indexOf(day) === -1) return false
  var op = (cfg.openTime || "00:00").split(":").map(Number)
  var cl = (cfg.closeTime || "23:59").split(":").map(Number)
  var nowM = now.getHours() * 60 + now.getMinutes()
  return nowM >= (op[0] * 60 + op[1]) && nowM < (cl[0] * 60 + cl[1])
}

function showClosedScreen() {
  if (hoursConfig) {
    var msgEl = document.getElementById("closed-msg")
    if (msgEl && hoursConfig.closedMessage) msgEl.textContent = hoursConfig.closedMessage
    var hoursEl = document.getElementById("closed-hours")
    if (hoursEl && hoursConfig.openTime && hoursConfig.closeTime) {
      var DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
      var openDays = (hoursConfig.days || []).map(function(d) { return DAY_NAMES[d] }).join(", ")
      hoursEl.textContent = "🕒  " + hoursConfig.openTime + " – " + hoursConfig.closeTime + (openDays ? "   |   " + openDays : "")
      hoursEl.style.display = ""
    }
  }
  show("s-closed")
}
function show(id) {
  document.querySelectorAll(".screen").forEach(function(el) { el.classList.remove("active") })
  document.getElementById(id).classList.add("active")
}
function post(path, body) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
    body: JSON.stringify(body)
  }).then(function(r) { return r.json() })
}
function setKidLabels() {
  var kidIds = ["hdr-kid","qs-hdr-kid","tk-hdr-kid","fb-hdr-kid","home-hdr-kid","help-hdr-kid"]
  kidIds.forEach(function(id) { var el = document.getElementById(id); if (el) el.textContent = KIOSK_LABEL })
  var orgIds = ["hdr-org","qs-hdr-org","tk-hdr-org","fb-hdr-org","home-hdr-org","help-hdr-org"]
  orgIds.forEach(function(id) { var el = document.getElementById(id); if (el) el.textContent = orgName || "Queue System" })
}
function clearResetTimer() { if (resetTimer) { clearTimeout(resetTimer); resetTimer = null } }
function scheduleReset(ms) {
  clearResetTimer()
  resetTimer = setTimeout(function() { resetKiosk() }, ms)
}

// ── Init / Load ──────────────────────────────────────────────────────────────
function init() {
  show("s-loading")
  if (!TOKEN) {
    document.getElementById("err-msg").textContent = "No kiosk token in URL. Open the URL from Settings \u2192 Kiosk Tablets."
    show("s-err")
    return
  }
  fetch("/api/kiosk/config?token=" + encodeURIComponent(TOKEN))
    .then(function(r) {
      if (!r.ok) {
        return r.json().then(function(body) {
          throw new Error("HTTP " + r.status + ": " + (body.error || r.statusText))
        }).catch(function() {
          throw new Error("HTTP " + r.status + " " + r.statusText)
        })
      }
      return r.json()
    })
    .then(function(cfg) {
      categories        = cfg.categories || []
      kioskQuestions    = cfg.kioskQuestions || []
      feedbackQuestions = cfg.feedbackQuestions || []
      orgName           = cfg.orgName || ""
      hoursConfig       = cfg.hoursConfig || null
      waitingByCat      = cfg.waitingByCat || {}
      setKidLabels()
      buildCategoryGrid()
      // Check operating hours — show closed screen if outside hours
      if (hoursConfig && hoursConfig.enabled && !isWithinHours(hoursConfig)) {
        showClosedScreen()
      } else {
        show("s-home")
      }
      // Periodically re-check hours (e.g. kiosk opens at 08:00 while tablet is already on)
      if (hoursCheckInterval) clearInterval(hoursCheckInterval)
      hoursCheckInterval = setInterval(function() {
        if (hoursConfig && hoursConfig.enabled) {
          var open = isWithinHours(hoursConfig)
          var curScreen = document.querySelector(".screen.active")
          var isClosed = curScreen && curScreen.id === "s-closed"
          if (!open && !isClosed) { showClosedScreen() }
          if (open && isClosed) { show("s-home") }
        }
      }, 60000)
    })
    .catch(function(e) {
      document.getElementById("err-msg").textContent = e.message || "Could not connect to server."
      show("s-err")
    })
}

// ── Category screen ──────────────────────────────────────────────────────────
function buildCategoryGrid() {
  var grid = document.getElementById("cats-grid")
  grid.innerHTML = ""
  if (categories.length === 0) {
    grid.innerHTML = "<p style='color:#52525b;text-align:center;padding:40px;grid-column:1/-1'>No services configured. Please contact staff.</p>"
    return
  }
  categories.forEach(function(cat) {
    var btn = document.createElement("button")
    btn.className = "cat-btn"
    var waitInfo = waitingByCat[cat.id]
    var waitText = "Tap to get ticket"
    if (waitInfo && waitInfo.waiting > 0) {
      waitText = waitInfo.estimatedMinutes > 0
        ? waitInfo.waiting + " waiting · ~" + waitInfo.estimatedMinutes + " min"
        : waitInfo.waiting + " people waiting"
    }
    btn.innerHTML =
      "<div class=\\"cat-code\\" style=\\"background:" + esc(cat.color) + "20;color:" + esc(cat.color) + "\\">" + esc(cat.code) + "</div>" +
      "<div class=\\"cat-label\\">" + esc(cat.label) + "</div>" +
      "<div class=\\"cat-wait\\">" + esc(waitText) + "</div>" +
      "<div class=\\"cat-arrow\\">&#8250;</div>"
    btn.style.setProperty("--c", cat.color)
    btn.addEventListener("click", function() { selectCategory(cat) })
    grid.appendChild(btn)
  })
}

function selectCategory(cat) {
  selCat = cat
  qAnswers = []
  visibleQs = computeVisibleQs([])
  qIdx = 0
  if (visibleQs.length === 0) {
    issueTicket()
    return
  }
  renderQuestion()
  show("s-qs")
  var orgEl = document.getElementById("qs-hdr-org")
  if (orgEl) orgEl.textContent = orgName || "Queue System"
  var catEl = document.getElementById("qs-hdr-cat")
  if (catEl) catEl.textContent = cat.label
}

// ── Kiosk questions ──────────────────────────────────────────────────────────
function computeVisibleQs(answers) {
  // Filter questions: global (null categoryId) + category-specific, with branching
  return kioskQuestions.filter(function(q) {
    if (q.category_id !== null && q.category_id !== selCat.id) return false
    if (!q.depends_on_question_id) return true
    var dep = answers.find(function(a) { return a.questionId === q.depends_on_question_id })
    if (!dep) return false
    if (!q.depends_on_option_id) return true
    return dep.optionId === q.depends_on_option_id
  })
}

function renderQuestion() {
  var visVis = computeVisibleQs(qAnswers)
  visibleQs = visVis
  var prog = document.getElementById("qs-prog")
  prog.innerHTML = visibleQs.map(function(q, i) {
    var cls = i < qIdx ? "done" : i === qIdx ? "active" : ""
    return "<div class=\\"qs-prog-dot " + cls + "\\"></div>"
  }).join("")
  var q = visibleQs[qIdx]
  if (!q) { issueTicket(); return }
  document.getElementById("qs-text").textContent = q.question
  var area = document.getElementById("qs-input-area")
  area.innerHTML = ""
  var nextBtn = document.getElementById("qs-next")
  var backBtn = document.getElementById("qs-back")
  backBtn.style.display = qIdx === 0 ? "none" : ""
  nextBtn.disabled = true
  var opts = JSON.parse(q.options || "[]")
  if (q.type === "single") {
    var div = document.createElement("div")
    div.className = "qs-opts"
    opts.forEach(function(opt) {
      var btn = document.createElement("button")
      btn.className = "qs-opt"
      btn.textContent = opt.label || opt
      btn.onclick = function() {
        div.querySelectorAll(".qs-opt").forEach(function(b) { b.classList.remove("sel") })
        btn.classList.add("sel")
        btn._optId  = opt.id || opt.label || opt
        btn._optLabel = opt.label || opt
        btn._routesTo = opt.routesToWindowId || null
        nextBtn.disabled = false
        nextBtn._selectedBtn = btn
      }
      div.appendChild(btn)
    })
    area.appendChild(div)
  } else {
    var inp = document.createElement("input")
    inp.type = "text"
    inp.className = "qs-text-inp"
    inp.placeholder = "Type your answer…"
    inp.oninput = function() { nextBtn.disabled = inp.value.trim() === "" }
    area.appendChild(inp)
  }
}

function qsBack() {
  if (qIdx === 0) { show("s-cats"); return }
  // Remove last answer and go back
  qAnswers = qAnswers.slice(0, -1)
  qIdx--
  renderQuestion()
}

function qsNext() {
  var q = visibleQs[qIdx]
  if (!q) return
  var nextBtn = document.getElementById("qs-next")
  var opts = JSON.parse(q.options || "[]")
  if (q.type === "single") {
    var btn = nextBtn._selectedBtn
    if (!btn) return
    qAnswers.push({ questionId: q.id, question: q.question, optionId: btn._optId, value: btn._optLabel, routesToWindowId: btn._routesTo || undefined })
  } else {
    var inp = document.querySelector(".qs-text-inp")
    if (!inp || inp.value.trim() === "") return
    qAnswers.push({ questionId: q.id, question: q.question, value: inp.value.trim() })
  }
  // Recompute visible questions with updated answers
  var newVis = computeVisibleQs(qAnswers)
  visibleQs = newVis
  if (qIdx + 1 < newVis.length) {
    qIdx++
    renderQuestion()
  } else {
    issueTicket()
  }
}

// ── Issue ticket ─────────────────────────────────────────────────────────────
function issueTicket() {
  show("s-issuing")
  post("/api/kiosk/issue", {
    categoryId: selCat.id,
    kioskId: KIOSK_ID,
    answers: qAnswers
  }).then(function(res) {
    if (!res.ticket) throw new Error(res.error || "Issue failed")
    issuedTicket = res.ticket
    showTicket(res.ticket)
  }).catch(function(e) {
    document.getElementById("err-msg").textContent = "Failed to issue ticket. (" + e.message + ")"
    show("s-err")
  })
}

// ── Ticket screen ─────────────────────────────────────────────────────────────
var tkCountdown = null
function showTicket(ticket) {
  document.getElementById("tk-org").textContent  = orgName || ""
  document.getElementById("tk-num").textContent  = ticket.displayNumber
  var catEl = document.getElementById("tk-cat-label")
  if (catEl) { catEl.textContent = ticket.categoryLabel || ""; catEl.style.color = ticket.categoryColor || "#818cf8" }
  // Feedback button: only if there are feedback questions
  var fbBtn = document.getElementById("tk-feedback-btn")
  fbBtn.style.display = feedbackQuestions.length > 0 ? "" : "none"
  show("s-ticket")
  // Countdown bar: 20 seconds auto-reset
  var BAR_MS = 20000
  var bar = document.getElementById("tk-bar")
  var start = Date.now()
  if (tkCountdown) clearInterval(tkCountdown)
  tkCountdown = setInterval(function() {
    var elapsed = Date.now() - start
    var pct = Math.max(0, 100 - (elapsed / BAR_MS * 100))
    bar.style.width = pct + "%"
    if (elapsed >= BAR_MS) {
      clearInterval(tkCountdown)
      if (feedbackQuestions.length > 0) startFeedback()
      else resetKiosk()
    }
  }, 100)
}

// ── Feedback ─────────────────────────────────────────────────────────────────
var EMOJI_OPTS = [
  { score: 1, em: "😞", label: "Very Bad" },
  { score: 2, em: "😕", label: "Bad" },
  { score: 3, em: "😐", label: "Okay" },
  { score: 4, em: "😊", label: "Good" },
  { score: 5, em: "😄", label: "Excellent" }
]

function computeVisibleFbQs(answers) {
  return feedbackQuestions.filter(function(q) {
    if (!q.depends_on_question_id) return true
    var dep = answers.find(function(a) { return a.questionId === q.depends_on_question_id })
    if (!dep) return false
    if (!q.depends_on_answer_value) return true
    var v = q.depends_on_answer_value
    var m = v.match(/^(lte|gte|eq):(\d+)$/)
    if (m && dep.score !== undefined) {
      var thr = parseInt(m[2])
      if (m[1] === "lte") return dep.score <= thr
      if (m[1] === "gte") return dep.score >= thr
      if (m[1] === "eq")  return dep.score === thr
    }
    return dep.value === v
  })
}

function startFeedback() {
  clearInterval(tkCountdown)
  fbAnswers = []
  visibleFbQs = computeVisibleFbQs([])
  fbIdx = 0
  if (visibleFbQs.length === 0) { submitFeedback(); return }
  renderFbQuestion()
  show("s-fb")
  var fbHdrIds = ["fb-hdr-org","fb-hdr-kid"]
  fbHdrIds.forEach(function(id) {
    var el = document.getElementById(id)
    if (el) el.textContent = id.includes("org") ? (orgName || "Queue System") : KIOSK_LABEL
  })
}

function renderFbQuestion() {
  visibleFbQs = computeVisibleFbQs(fbAnswers)
  var q = visibleFbQs[fbIdx]
  if (!q) { submitFeedback(); return }
  var total = visibleFbQs.length
  document.getElementById("fb-step").textContent = "Question " + (fbIdx + 1) + " of " + total
  document.getElementById("fb-q").textContent    = q.question
  var nextBtn = document.getElementById("fb-next")
  var skipBtn = document.getElementById("fb-skip")
  nextBtn.disabled = true
  skipBtn.style.display = q.is_required ? "none" : ""
  var area = document.getElementById("fb-input-area")
  area.innerHTML = ""
  var opts = JSON.parse(q.options || "[]")
  if (q.type === "star") {
    var wrap = document.createElement("div")
    wrap.className = "stars"
    for (var s = 1; s <= 5; s++) {
      (function(score) {
        var b = document.createElement("button")
        b.className = "star-btn"
        b.textContent = "★"
        b.dataset.score = score
        b.onclick = function() {
          wrap.querySelectorAll(".star-btn").forEach(function(x, i) {
            x.classList.toggle("sel", i < score)
          })
          nextBtn.disabled = false
          nextBtn._fbVal = { score: score }
        }
        wrap.appendChild(b)
      })(s)
    }
    area.appendChild(wrap)
  } else if (q.type === "emoji") {
    var ew = document.createElement("div")
    ew.className = "emojis"
    EMOJI_OPTS.forEach(function(eo) {
      var b = document.createElement("button")
      b.className = "emoji-btn"
      b.innerHTML = "<span class=\\"em\\">" + eo.em + "</span><span class=\\"el\\">" + esc(eo.label) + "</span>"
      b.onclick = function() {
        ew.querySelectorAll(".emoji-btn").forEach(function(x) { x.classList.remove("sel") })
        b.classList.add("sel")
        nextBtn.disabled = false
        nextBtn._fbVal = { score: eo.score, value: eo.label }
      }
      ew.appendChild(b)
    })
    area.appendChild(ew)
  } else if (q.type === "choice") {
    var cd = document.createElement("div")
    cd.className = "fb-opts"
    opts.forEach(function(opt) {
      var b = document.createElement("button")
      b.className = "fb-opt"
      b.textContent = opt
      b.onclick = function() {
        cd.querySelectorAll(".fb-opt").forEach(function(x) { x.classList.remove("sel") })
        b.classList.add("sel")
        nextBtn.disabled = false
        nextBtn._fbVal = { value: opt }
      }
      cd.appendChild(b)
    })
    area.appendChild(cd)
  } else {
    var ta = document.createElement("textarea")
    ta.className = "fb-text-inp"
    ta.placeholder = "Write your thoughts…"
    ta.oninput = function() { nextBtn.disabled = ta.value.trim() === ""; nextBtn._fbVal = { value: ta.value.trim() } }
    area.appendChild(ta)
  }
}

function fbSkip() {
  var q = visibleFbQs[fbIdx]
  if (!q) return
  fbAnswers.push({ questionId: q.id, question: q.question, type: q.type })
  var newVis = computeVisibleFbQs(fbAnswers)
  visibleFbQs = newVis
  if (fbIdx + 1 < newVis.length) { fbIdx++; renderFbQuestion() }
  else submitFeedback()
}

function fbNext() {
  var q = visibleFbQs[fbIdx]
  var nextBtn = document.getElementById("fb-next")
  var val = nextBtn._fbVal || {}
  fbAnswers.push(Object.assign({ questionId: q.id, question: q.question, type: q.type }, val))
  nextBtn._fbVal = null
  var newVis = computeVisibleFbQs(fbAnswers)
  visibleFbQs = newVis
  if (fbIdx + 1 < newVis.length) { fbIdx++; renderFbQuestion() }
  else submitFeedback()
}

function submitFeedback() {
  var ticket = issuedTicket || {}
  post("/api/kiosk/feedback", {
    ticketId:      ticket.id || null,
    kioskId:       KIOSK_ID,
    categoryId:    ticket.categoryId || null,
    categoryLabel: ticket.categoryLabel || null,
    answers:       fbAnswers
  }).then(function() { showThanks() }).catch(function() { showThanks() })
}

// ── Thanks ───────────────────────────────────────────────────────────────────
function showThanks() {
  show("s-thanks")
  var cd = 5, el = document.getElementById("thanks-reset-txt")
  el.textContent = "Returning to start in " + cd + " seconds…"
  var t = setInterval(function() {
    cd--
    if (cd <= 0) { clearInterval(t); resetKiosk() }
    else el.textContent = "Returning to start in " + cd + " seconds…"
  }, 1000)
}

// ── Reset ────────────────────────────────────────────────────────────────────
function resetKiosk() {
  clearResetTimer()
  if (tkCountdown) { clearInterval(tkCountdown); tkCountdown = null }
  selCat = null; qAnswers = []; fbAnswers = []
  issuedTicket = null; qIdx = 0; fbIdx = 0
  buildCategoryGrid()
  show("s-home")
}

// ── Help ─────────────────────────────────────────────────────────────────────
var helpItems = [], helpLoaded = false

function showHelp() {
  show("s-help")
  if (!helpLoaded) { loadHelp() } else { renderHelp() }
}

function loadHelp() {
  fetch("/api/kiosk/help?token=" + encodeURIComponent(TOKEN))
    .then(function(r) { return r.json() })
    .then(function(data) {
      helpItems = data.items || []
      helpLoaded = true
      renderHelp()
    })
    .catch(function() {
      var body = document.getElementById("help-body")
      if (body) body.innerHTML = "<p style='color:#52525b;text-align:center;padding:40px'>Could not load help items.</p>"
    })
}

function renderHelp() {
  var body = document.getElementById("help-body")
  if (!body) return
  if (helpItems.length === 0) {
    body.innerHTML = "<p style='color:#52525b;text-align:center;padding:40px'>No help items available.</p>"
    return
  }
  var cats = [], catMap = {}
  helpItems.forEach(function(it) {
    if (!catMap[it.category]) { catMap[it.category] = []; cats.push(it.category) }
    catMap[it.category].push(it)
  })
  body.innerHTML = cats.map(function(cat) {
    return "<div class='help-cat-label'>" + esc(cat) + "</div>" +
      catMap[cat].map(function(it) {
        return "<div class='help-card' onclick='toggleHelp(this)'>" +
          "<div class='help-card-hdr'>" +
          "<div class='help-card-icon'>" + esc(it.icon || "❓") + "</div>" +
          "<div class='help-card-q'>" + esc(it.question) + "</div>" +
          "<div class='help-card-chev'>⌄</div>" +
          "</div>" +
          "<div class='help-card-ans'>" + esc(it.answer) + "</div>" +
          "</div>"
      }).join("")
  }).join("")
}

function toggleHelp(card) {
  var wasOpen = card.classList.contains("open")
  document.querySelectorAll(".help-card").forEach(function(c) { c.classList.remove("open") })
  if (!wasOpen) card.classList.add("open")
}

// ── Floor Map ────────────────────────────────────────────────────────────────
var mapPlans = [], mapCurrentFloorId = "", mapCurrentPinId = "", mapLoaded = false
var mapActivePlanId = null, mapSelectedPinId = null

function showMap() {
  show("s-map")
  var el = document.getElementById("map-hdr-org"); if (el) el.textContent = orgName || "Queue System"
  var el2 = document.getElementById("map-hdr-kid"); if (el2) el2.textContent = KIOSK_LABEL
  if (!mapLoaded) { loadMap() } else { renderMap() }
}

function loadMap() {
  fetch("/api/kiosk/floor-plans?token=" + encodeURIComponent(TOKEN))
    .then(function(r) { return r.json() })
    .then(function(data) {
      mapPlans = data.plans || []
      mapCurrentFloorId = data.currentFloorPlanId || ""
      mapCurrentPinId = data.currentPinId || ""
      mapLoaded = true
      if (!mapActivePlanId && mapCurrentFloorId) mapActivePlanId = mapCurrentFloorId
      if (!mapActivePlanId && mapPlans.length > 0) mapActivePlanId = mapPlans[0].id
      renderMap()
    })
    .catch(function() {
      var w = document.getElementById("map-img-wrap")
      if (w) w.innerHTML = "<p style='color:#ef4444;text-align:center;padding:40px'>Failed to load maps.</p>"
    })
}

function renderMap() {
  var selEl = document.getElementById("map-plan-sel")
  var wrap = document.getElementById("map-img-wrap")
  var info = document.getElementById("map-dest-info")
  if (!selEl || !wrap) return
  if (mapPlans.length === 0) {
    wrap.innerHTML = "<p style='color:#52525b;text-align:center;padding:40px'>No floor plans available.</p>"
    selEl.innerHTML = ""
    return
  }
  selEl.innerHTML = mapPlans.map(function(p) {
    var cls = p.id === mapActivePlanId ? "map-plan-tab active" : "map-plan-tab"
    return "<button class='" + cls + "' onclick='switchPlan(&quot;" + p.id + "&quot;)'>" + esc(p.label) + "</button>"
  }).join("")
  var plan = mapPlans.find(function(p) { return p.id === mapActivePlanId }) || mapPlans[0]
  if (!plan) return
  var pins = plan.pins || []
  var herePinId = (plan.id === mapCurrentFloorId) ? mapCurrentPinId : ""
  var herePin = pins.find(function(p) { return p.id === herePinId }) || null
  var destPin = mapSelectedPinId ? pins.find(function(p) { return p.id === mapSelectedPinId }) : null
  var pinsHtml = pins.map(function(pin) {
    var isHere = pin.id === herePinId
    var bg = isHere ? "#10b981" : (pin.id === mapSelectedPinId ? "#f59e0b" : "#4f46e5")
    return "<div class='map-pin-label' style='left:" + pin.x + "%;top:" + pin.y + "%' onclick='selectMapPin(&quot;" + pin.id + "&quot;)'>" +
      "<div class='map-pin-bubble' style='background:" + bg + ";color:white'>" + esc(pin.label) + (isHere ? " &#x1F4CD;" : "") + "</div>" +
      "<div class='map-pin-dot' style='background:" + bg + "'></div>" +
      "</div>"
  }).join("")
  var svgPath = ""
  if (herePin && destPin) {
    var pts = (destPin.path && destPin.path.length > 1)
      ? destPin.path.map(function(p) { return p.x + "," + p.y }).join(" ")
      : (herePin.x + "," + herePin.y + " " + destPin.x + "," + destPin.y)
    svgPath = "<polyline points='" + pts + "' stroke='#10b981' stroke-width='1.5' stroke-dasharray='3 1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/>" +
      "<circle cx='" + destPin.x + "' cy='" + destPin.y + "' r='2.5' fill='#10b981' opacity='.7'/>"
  }
  wrap.innerHTML = "<img src='" + esc(plan.imageUrl) + "' alt='" + esc(plan.label) + "'/>" +
    "<svg viewBox='0 0 100 100' preserveAspectRatio='none'>" + svgPath + "</svg>" +
    pinsHtml
  if (info) {
    if (destPin) {
      info.style.display = ""
      info.innerHTML = (herePin ? "<strong>" + esc(herePin.label) + "</strong> &rarr; <strong>" + esc(destPin.label) + "</strong>" : "<strong>" + esc(destPin.label) + "</strong>") +
        "<div style='margin-top:6px;font-size:12px'>Follow the green path on the map above</div>"
    } else {
      info.style.display = "none"
    }
  }
}

function switchPlan(planId) {
  mapActivePlanId = planId
  mapSelectedPinId = null
  renderMap()
}

function selectMapPin(pinId) {
  mapSelectedPinId = mapSelectedPinId === pinId ? null : pinId
  renderMap()
}

// ── Standalone feedback (from Home) ──────────────────────────────────────────
function startFeedbackFromHome() {
  issuedTicket = null
  fbAnswers = []
  visibleFbQs = computeVisibleFbQs([])
  fbIdx = 0
  if (visibleFbQs.length === 0) {
    document.getElementById("err-msg").textContent = "No feedback questions configured yet."
    show("s-err")
    return
  }
  renderFbQuestion()
  show("s-fb")
  var el = document.getElementById("fb-hdr-org"); if (el) el.textContent = orgName || "Queue System"
  var el2 = document.getElementById("fb-hdr-kid"); if (el2) el2.textContent = KIOSK_LABEL
}

// ── Start ────────────────────────────────────────────────────────────────────
init()
</script>
</body>
</html>`
  }

  private buildPanel(): string {
    const orgName = (() => {
      try {
        const cfg = readLocalConfig() as any
        const n = cfg.installationConfig?.organizationName ?? 'Announcement System'
        return n.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;')
      } catch { return 'Announcement System' }
    })()

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${orgName} — Queue Panel</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;-webkit-tap-highlight-color:transparent}
:root{
  --sb:#1a2744;--sb2:#22305a;--sb-bd:#2d3f5f;--sb-tx:#e2e8f0;--sb-mt:#94a3b8;--sb-dm:#64748b;
  --bg:#f1f5f9;--white:#ffffff;--bd:#e2e8f0;--tx:#1e293b;--mt:#64748b;--dm:#94a3b8;
  --pr:#4f46e5;--ph:#4338ca;--pl:#818cf8;
  --em:#10b981;--am:#f59e0b;--rd:#ef4444;--bl:#3b82f6;
}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;display:flex;height:100vh;overflow:hidden}
input,select,button{font-family:inherit;font-size:inherit}

/* ── Screens ── */
.scr{display:none;width:100%;height:100vh;overflow:hidden}
.scr.active{display:flex}

/* ── LOGIN ── */
#s-login{align-items:center;justify-content:center;background:var(--bg);padding:20px}
.l-wrap{width:100%;max-width:360px}
.l-brand{text-align:center;margin-bottom:28px}
.l-logo{width:56px;height:56px;border-radius:16px;background:var(--pr);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:24px;box-shadow:0 8px 24px rgba(79,70,229,.3)}
.l-brand h1{font-size:20px;font-weight:800;color:var(--tx)}
.l-brand p{font-size:13px;color:var(--mt);margin-top:4px}
.l-card{background:var(--white);border:1px solid var(--bd);border-radius:16px;padding:28px;box-shadow:0 4px 20px rgba(0,0,0,.07)}
.lbl{display:block;font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.6px;margin-bottom:7px}
.inp{width:100%;background:var(--bg);border:1.5px solid var(--bd);border-radius:10px;padding:11px 14px;color:var(--tx);outline:none;transition:border-color .15s}
.inp:focus{border-color:var(--pr)}
.inp::placeholder{color:var(--dm)}
.pw-wrap{position:relative}
.pw-wrap .inp{padding-right:40px}
.pw-eye{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--dm);cursor:pointer;padding:4px;font-size:14px;line-height:1}
.pw-eye:hover{color:var(--mt)}
.l-err{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:9px 13px;font-size:12px;color:#dc2626;margin-top:10px}
.f-gap{margin-top:14px}
.btn-pr{background:var(--pr);color:#fff;border:none;border-radius:10px;padding:13px 20px;font-weight:700;cursor:pointer;transition:background .15s;width:100%;margin-top:18px;font-size:15px}
.btn-pr:hover{background:var(--ph)}
.btn-pr:disabled{background:var(--dm);color:#fff;cursor:not-allowed}
.btn-ghost{background:transparent;border:1.5px solid var(--bd);border-radius:10px;padding:13px 20px;color:var(--mt);cursor:pointer;transition:all .15s;width:100%}
.btn-ghost:hover{background:var(--bg);border-color:var(--dm);color:var(--tx)}
.btn-sm{background:var(--white);border:1.5px solid var(--bd);border-radius:8px;padding:7px 13px;color:var(--mt);cursor:pointer;transition:all .15s;font-size:12px;white-space:nowrap}
.btn-sm:hover{color:var(--tx);border-color:var(--dm)}

/* ── DEPT PICKER ── */
#s-dept{background:var(--bg);align-items:flex-start;justify-content:center;overflow-y:auto}
.d-wrap{width:100%;max-width:480px;padding:40px 20px;margin:0 auto}
.d-hdr{text-align:center;margin-bottom:32px}
.d-logo{width:56px;height:56px;border-radius:16px;background:var(--pr);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:24px;box-shadow:0 8px 24px rgba(79,70,229,.3)}
.d-hdr h2{font-size:20px;font-weight:800;color:var(--tx)}
.d-hdr p{font-size:13px;color:var(--mt);margin-top:5px}
.dept-card{width:100%;display:flex;align-items:center;gap:14px;background:var(--white);border:1.5px solid var(--bd);border-radius:14px;padding:16px 18px;cursor:pointer;transition:all .15s;text-align:left;margin-bottom:10px;color:var(--tx);box-shadow:0 1px 4px rgba(0,0,0,.04)}
.dept-card:hover{border-color:var(--pr);box-shadow:0 4px 12px rgba(79,70,229,.12)}
.dept-badge{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;flex-shrink:0}
.dept-info{flex:1;min-width:0}
.dept-name{font-size:15px;font-weight:700;color:var(--tx)}
.dept-wait{font-size:12px;color:var(--mt);margin-top:3px}
.dept-arrow{color:var(--dm);font-size:20px;flex-shrink:0}

/* ── MAIN PANEL ── */
#s-main{flex-direction:row}

/* Sidebar */
.sidebar{width:220px;min-width:220px;background:var(--sb);display:flex;flex-direction:column;height:100vh;border-right:1px solid var(--sb-bd)}
.sb-brand{padding:20px 18px 16px}
.sb-logo-row{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.sb-logo{width:36px;height:36px;border-radius:10px;background:var(--pr);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.sb-org{font-size:13px;font-weight:800;color:var(--sb-tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb-sub{font-size:11px;color:var(--sb-mt);letter-spacing:.3px}
.sb-divider{height:1px;background:var(--sb-bd);margin:0 18px}
.sb-section{padding:14px 18px}
.sb-sec-title{font-size:9px;font-weight:700;color:var(--sb-dm);text-transform:uppercase;letter-spacing:.9px;margin-bottom:10px}
.sb-stat{display:flex;align-items:center;justify-content:space-between;padding:5px 0}
.sb-stat-label{font-size:12px;color:var(--sb-mt)}
.sb-stat-val{font-size:20px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}
.n-am{color:var(--am)}.n-bl{color:var(--bl)}.n-em{color:var(--em)}.n-mt{color:var(--sb-dm)}
.win-sel{width:100%;background:var(--sb2);border:1px solid var(--sb-bd);border-radius:8px;padding:9px 10px;color:var(--sb-tx);font-size:12px;outline:none;cursor:pointer}
.win-sel option{background:var(--sb)}
.dept-pill{border-radius:20px;padding:4px 12px;font-size:11px;font-weight:700;display:inline-flex;white-space:nowrap}
.sb-dept-wrap{padding:2px 18px 14px}
.sb-spacer{flex:1}
.sb-footer{padding:14px 18px;border-top:1px solid var(--sb-bd)}
.sb-conn{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.conn-dot{width:8px;height:8px;border-radius:50%;background:var(--sb-dm);flex-shrink:0;transition:background .3s}
.conn-dot.on{background:var(--em)}
.sb-conn-label{font-size:11px;color:var(--sb-mt)}
.sb-signout{width:100%;background:rgba(255,255,255,.07);border:1px solid var(--sb-bd);border-radius:8px;padding:10px;color:var(--sb-mt);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;text-align:center}
.sb-signout:hover{background:rgba(239,68,68,.18);border-color:rgba(239,68,68,.35);color:#fca5a5}

/* Content area */
.content{flex:1;display:flex;flex-direction:column;height:100vh;overflow:hidden;background:var(--bg)}
.topbar{height:52px;min-height:52px;background:var(--white);border-bottom:1.5px solid var(--bd);display:flex;align-items:center;padding:0 20px;gap:10px;flex-shrink:0;box-shadow:0 1px 4px rgba(0,0,0,.04)}
.tb-bread{font-size:13px;font-weight:600;color:var(--mt)}
.tb-sep{font-size:14px;color:var(--dm);margin:0 2px}
.tb-dept-wrap{display:flex;align-items:center}
.tb-gap{flex:1}
.tb-user{font-size:12px;color:var(--mt);display:flex;align-items:center;gap:6px}
.tb-user-name{font-weight:700;color:var(--tx)}

/* Body */
.main-body{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:14px}
.main-body::-webkit-scrollbar{width:4px}
.main-body::-webkit-scrollbar-thumb{background:var(--bd);border-radius:2px}

/* Hero card */
.hero{background:var(--white);border:1.5px solid var(--bd);border-left:4px solid var(--pr);border-radius:16px;padding:22px;box-shadow:0 2px 8px rgba(0,0,0,.05)}
.hero-lbl{font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px}
.hero-num{font-size:72px;font-weight:900;line-height:1;letter-spacing:2px;font-variant-numeric:tabular-nums;color:var(--tx);transition:color .2s}
.hero-num.empty{color:var(--dm);font-size:48px}
.hero-meta{font-size:13px;color:var(--mt);margin-top:8px;min-height:20px}
.hero-meta .hm-cat{color:var(--pr);font-weight:600}
.hero-meta .hm-age{color:var(--dm)}
.hero-actions{display:flex;gap:10px;margin-top:18px}
.btn-call{flex:2;background:var(--pr);color:#fff;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;transition:all .15s;box-shadow:0 4px 14px rgba(79,70,229,.25)}
.btn-call:hover:not(:disabled){background:var(--ph);transform:translateY(-1px)}
.btn-call:disabled{background:var(--dm);color:#fff;cursor:not-allowed;box-shadow:none;transform:none}
.btn-recall{flex:1;background:var(--white);border:1.5px solid var(--bd);border-radius:10px;padding:14px;color:var(--mt);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s}
.btn-recall:hover:not(:disabled){background:#fffbeb;border-color:#fcd34d;color:var(--am)}
.btn-recall:disabled{opacity:.4;cursor:not-allowed}

/* Sections */
.section{background:var(--white);border:1.5px solid var(--bd);border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.04)}
.sec-hd{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--bd)}
.sec-hd-title{font-size:12px;font-weight:700;color:var(--tx);text-transform:uppercase;letter-spacing:.4px}
.sec-badge{font-size:12px;font-weight:800;background:var(--bg);border:1px solid var(--bd);border-radius:20px;padding:2px 10px;color:var(--pr)}
.sec-badge.am{color:var(--am)}
.empty-msg{padding:24px;text-align:center;font-size:13px;color:var(--dm)}

/* Called rows */
.trow{display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--bd);transition:background .1s}
.trow:last-child{border-bottom:none}
.trow:hover{background:var(--bg)}
.trow-num{font-size:18px;font-weight:800;min-width:56px;font-variant-numeric:tabular-nums;flex-shrink:0}
.trow-info{flex:1;min-width:0}
.trow-cat{font-size:12px;color:var(--mt);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.trow-meta{font-size:11px;color:var(--dm);margin-top:2px}
.trow-acts{display:flex;gap:5px;flex-shrink:0}
.act{border:none;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;transition:all .1s}
.act-s{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0}.act-s:hover{background:#dcfce7}
.act-r{background:#fffbeb;color:#d97706;border:1px solid #fde68a}.act-r:hover{background:#fef3c7}
.act-n{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}.act-n:hover{background:#fee2e2}
.act-k{background:var(--bg);color:var(--dm);border:1px solid var(--bd)}.act-k:hover{background:#e2e8f0}

/* Waiting rows */
.wrow{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--bd);transition:background .1s}
.wrow:last-child{border-bottom:none}
.wrow.next{background:#f5f3ff;border-left:3px solid var(--pr)}
.wrow:hover{background:var(--bg)}
.wrow-pos{font-size:11px;font-weight:700;color:var(--dm);min-width:20px;text-align:center}
.wrow.next .wrow-pos{color:var(--pr)}
.wrow-num{font-size:15px;font-weight:800;min-width:54px;font-variant-numeric:tabular-nums;color:var(--tx)}
.wrow.next .wrow-num{color:var(--pr)}
.wrow-info{flex:1;min-width:0}
.wrow-cat{font-size:12px;color:var(--mt);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wrow-age{font-size:11px;color:var(--dm);margin-top:2px}
.next-badge{font-size:9px;font-weight:700;color:var(--pr);background:#ede9fe;border:1px solid #c4b5fd;border-radius:4px;padding:2px 6px;flex-shrink:0}

/* Name call */
.name-row{display:flex;gap:10px;padding:14px 16px}
.name-inp{flex:1;background:var(--bg);border:1.5px solid var(--bd);border-radius:10px;padding:11px 14px;color:var(--tx);outline:none;transition:border-color .15s;min-width:0}
.name-inp:focus{border-color:var(--pr)}
.name-inp::placeholder{color:var(--dm)}
.btn-announce{background:var(--pr);border:none;border-radius:10px;padding:11px 18px;color:#fff;font-weight:700;cursor:pointer;transition:all .15s;white-space:nowrap;flex-shrink:0}
.btn-announce:hover{background:var(--ph)}
.btn-announce:disabled{opacity:.4;cursor:not-allowed}

/* Flash */
@keyframes flash{0%{box-shadow:0 0 0 5px rgba(79,70,229,.3)}100%{box-shadow:0 2px 8px rgba(0,0,0,.05)}}
.flash{animation:flash .8s ease-out}
</style>
</head>
<body>

<!-- ══ LOGIN ══════════════════════════════════════════════════════════════ -->
<div id="s-login" class="scr active">
  <div class="l-wrap">
    <div class="l-brand">
      <div class="l-logo">&#9654;</div>
      <h1>${orgName}</h1>
      <p>Queue Operator Panel</p>
    </div>
    <div class="l-card">
      <label class="lbl">Username</label>
      <input id="i-user" class="inp" type="text" placeholder="e.g. dr.amina" autocomplete="username">
      <div class="f-gap">
        <label class="lbl">Password</label>
        <div class="pw-wrap">
          <input id="i-pass" class="inp" type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" autocomplete="current-password">
          <button class="pw-eye" id="pw-eye" type="button" onclick="togglePw()">&#128065;</button>
        </div>
      </div>
      <div id="l-err" class="l-err" style="display:none"></div>
      <button id="b-login" class="btn-pr" onclick="doLogin()">Sign In &#8594;</button>
    </div>
  </div>
</div>

<!-- ══ DEPT PICKER ════════════════════════════════════════════════════════ -->
<div id="s-dept" class="scr">
  <div class="d-wrap">
    <div class="d-hdr">
      <div class="d-logo">&#9654;</div>
      <h2 id="d-greet">Karibu</h2>
      <p>Chagua idara yako kuendelea</p>
    </div>
    <div id="d-grid"></div>
    <button id="b-all" class="btn-ghost" style="display:none;margin-top:10px" onclick="selectDept(null)">
      &#9745; Angalia idara zote (supervisor mode)
    </button>
  </div>
</div>

<!-- ══ MAIN PANEL ═════════════════════════════════════════════════════════ -->
<div id="s-main" class="scr">

  <!-- ── Sidebar ── -->
  <aside class="sidebar">
    <div class="sb-brand">
      <div class="sb-logo-row">
        <div class="sb-logo">&#9654;</div>
        <span class="sb-org">${orgName}</span>
      </div>
      <div class="sb-sub">Queue Operator Panel</div>
    </div>

    <div class="sb-divider"></div>

    <!-- Department -->
    <div class="sb-dept-wrap" id="sb-dept-wrap" style="display:none">
      <div class="sb-sec-title" style="padding:14px 0 8px">DEPARTMENT</div>
      <div id="tb-dept" class="dept-pill"></div>
    </div>

    <div class="sb-divider"></div>

    <!-- Stats -->
    <div class="sb-section">
      <div class="sb-sec-title">TODAY&rsquo;S STATS</div>
      <div class="sb-stat"><span class="sb-stat-label">Waiting</span><span id="sv-w" class="sb-stat-val n-am">0</span></div>
      <div class="sb-stat"><span class="sb-stat-label">Called</span><span id="sv-c" class="sb-stat-val n-bl">0</span></div>
      <div class="sb-stat"><span class="sb-stat-label">Served</span><span id="sv-s" class="sb-stat-val n-em">0</span></div>
      <div class="sb-stat"><span class="sb-stat-label">Skipped</span><span id="sv-k" class="sb-stat-val n-mt">0</span></div>
    </div>

    <div class="sb-divider"></div>

    <!-- Window selector -->
    <div class="sb-section">
      <div class="sb-sec-title">YOUR WINDOW</div>
      <select id="win-sel" class="win-sel"></select>
    </div>

    <div class="sb-spacer"></div>

    <!-- Footer -->
    <div class="sb-footer">
      <div class="sb-conn">
        <div id="conn" class="conn-dot"></div>
        <span class="sb-conn-label" id="conn-label">Connecting&hellip;</span>
      </div>
      <button class="sb-signout" onclick="signOut()">&#10005;&nbsp; Sign Out</button>
    </div>
  </aside>

  <!-- ── Content ── -->
  <div class="content">

    <!-- Top bar -->
    <div class="topbar">
      <span class="tb-bread">Queue Panel</span>
      <span class="tb-sep">›</span>
      <span class="tb-bread" id="tb-bread-dept" style="color:var(--tx);font-weight:700">All Departments</span>
      <div class="tb-gap"></div>
      <div class="tb-user">&#128100;&nbsp;<span class="tb-user-name" id="tb-username"></span></div>
    </div>

    <!-- Scrollable body -->
    <div class="main-body">

      <!-- Hero: Next ticket -->
      <div class="hero" id="hero-card">
        <div class="hero-lbl">Next in Queue</div>
        <div id="h-num" class="hero-num empty">&#8212;</div>
        <div id="h-meta" class="hero-meta">Queue is empty</div>
        <div class="hero-actions">
          <button id="b-next" class="btn-call" onclick="callNext()" disabled>&#128276;&nbsp; Call Next</button>
          <button id="b-recall" class="btn-recall" onclick="recallLast()" disabled>&#8635;&nbsp; Recall</button>
        </div>
      </div>

      <!-- Active Calls -->
      <div class="section" id="sec-called" style="display:none">
        <div class="sec-hd">
          <span class="sec-hd-title">Active Calls</span>
          <span id="called-ct" class="sec-badge">0</span>
        </div>
        <div id="called-list"></div>
      </div>

      <!-- Waiting Queue -->
      <div class="section">
        <div class="sec-hd">
          <span class="sec-hd-title">Waiting Queue</span>
          <span id="wait-ct" class="sec-badge am">0</span>
        </div>
        <div id="wait-list"></div>
      </div>

      <!-- Call by Name -->
      <div class="section">
        <div class="sec-hd">
          <span class="sec-hd-title">&#127897;&nbsp; Call by Name</span>
        </div>
        <div class="name-row">
          <input id="i-name" class="name-inp" type="text" placeholder="Type patient or visitor name&hellip;">
          <button id="b-announce" class="btn-announce" onclick="callName()">Announce</button>
        </div>
      </div>

    </div>
  </div>
</div>

<script>
const TOKEN=${JSON.stringify(this.apiToken||'')}
let user=null,dept=null,cats=[],wins=[],tickets=[],es=null

// ── helpers ──────────────────────────────────────────────────────────────────
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function ago(iso){if(!iso)return'';var m=Math.floor((Date.now()-new Date(iso).getTime())/60000);return m<1?'<1m':m+'m'}
function catOf(id){return cats.find(function(c){return c.id===id})||null}
function winOf(id){return wins.find(function(w){return w.id===id})||null}
function myTickets(){return dept?tickets.filter(function(t){return t.category_id===dept.id}):tickets}
function post(path,body){return fetch(path,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+TOKEN},body:JSON.stringify(body)}).then(function(r){return r.json()})}
function show(id){document.querySelectorAll('.scr').forEach(function(s){s.classList.remove('active')});document.getElementById(id).classList.add('active')}
function selWin(){var s=document.getElementById('win-sel');return s?s.value:''}

// ── login ─────────────────────────────────────────────────────────────────────
function togglePw(){var i=document.getElementById('i-pass');i.type=i.type==='password'?'text':'password'}

async function doLogin(){
  var u=document.getElementById('i-user').value.trim()
  var p=document.getElementById('i-pass').value
  var btn=document.getElementById('b-login')
  var err=document.getElementById('l-err')
  if(!u||!p)return
  btn.disabled=true;btn.textContent='Signing in\u2026'
  err.style.display='none'
  try{
    var res=await post('/api/auth/login',{username:u,password:p})
    if(!res.user){
      err.textContent=res.error||'Invalid credentials'
      err.style.display='block'
      btn.disabled=false;btn.innerHTML='Sign In &#8594;'
      return
    }
    user=res.user
    var cfg=await fetch('/api/config').then(function(r){return r.json()})
    cats=cfg.categories||[];wins=cfg.windows||[]
    buildDeptPicker()
    show('s-dept')
  }catch(e){
    err.textContent='Connection error. Try again.'
    err.style.display='block'
    btn.disabled=false;btn.innerHTML='Sign In &#8594;'
  }
}

// ── dept picker ───────────────────────────────────────────────────────────────
function buildDeptPicker(){
  document.getElementById('d-greet').textContent='Karibu, '+(user.displayName||user.username)
  var grid=document.getElementById('d-grid')
  grid.innerHTML=''
  cats.forEach(function(cat){
    var wc=tickets.filter(function(t){return t.status==='waiting'&&t.category_id===cat.id}).length
    var card=document.createElement('button')
    card.className='dept-card'
    card.innerHTML='<div class="dept-badge" style="background:'+cat.color+'20;border:1px solid '+cat.color+'40;color:'+cat.color+'">'+esc(cat.code)+'</div>'
      +'<div class="dept-info"><div class="dept-name">'+esc(cat.label)+'</div>'
      +'<div class="dept-wait">'+(wc>0?'<span style="color:var(--am)">'+wc+' wanasubiri</span>':'Hakuna wanasubiri')+'</div></div>'
      +'<div class="dept-arrow">&#8250;</div>'
    card.onclick=function(){selectDept(cat)}
    grid.appendChild(card)
  })
  var bAll=document.getElementById('b-all')
  bAll.style.display=(user.role==='admin'||user.role==='supervisor')?'block':'none'
}

function selectDept(cat){
  dept=cat
  populateWinSel()
  connectSSE()
  show('s-main')
  // username in topbar
  var unameEl=document.getElementById('tb-username')
  if(unameEl&&user) unameEl.textContent=user.displayName||user.username
  // dept pill in sidebar
  var pill=document.getElementById('tb-dept')
  var wrap=document.getElementById('sb-dept-wrap')
  var bread=document.getElementById('tb-bread-dept')
  if(cat){
    pill.textContent=cat.label
    pill.style.cssText='display:inline-flex;background:'+cat.color+'25;border:1px solid '+cat.color+'50;color:'+cat.color
    if(wrap) wrap.style.display='block'
    if(bread) bread.textContent=cat.label
  }else{
    pill.textContent='All Departments'
    pill.style.cssText='display:inline-flex;background:rgba(255,255,255,.08);border:1px solid var(--sb-bd);color:var(--sb-mt)'
    if(wrap) wrap.style.display='block'
    if(bread) bread.textContent='All Departments'
  }
  renderAll()
}

// ── window selector ───────────────────────────────────────────────────────────
function populateWinSel(){
  var sel=document.getElementById('win-sel')
  sel.innerHTML=wins.map(function(w){
    return '<option value="'+esc(w.id)+'"'+(user.windowId===w.id?' selected':'')+'>'+esc(w.label)+'</option>'
  }).join('')
}

// ── SSE ───────────────────────────────────────────────────────────────────────
function connectSSE(){
  if(es){try{es.close()}catch(e){}}
  es=new EventSource('/api/events?token='+encodeURIComponent(TOKEN))
  es.addEventListener('queue',function(e){
    var d=JSON.parse(e.data)
    tickets=d.tickets||[];cats=d.categories||cats;wins=d.windows||wins
    renderAll()
  })
  es.addEventListener('stats',function(e){
    var d=JSON.parse(e.data)
    renderStats(d)
  })
  es.onopen=function(){document.getElementById('conn').className='conn-dot on';var l=document.getElementById('conn-label');if(l)l.textContent='Connected'}
  es.onerror=function(){document.getElementById('conn').className='conn-dot';var l=document.getElementById('conn-label');if(l)l.textContent='Reconnecting\u2026'}
}

// ── render ────────────────────────────────────────────────────────────────────
function renderAll(){renderHero();renderCalled();renderWaiting();renderStats(null)}

function renderStats(s){
  var mt=myTickets()
  document.getElementById('sv-w').textContent=mt.filter(function(t){return t.status==='waiting'}).length
  document.getElementById('sv-c').textContent=mt.filter(function(t){return t.status==='called'}).length
  document.getElementById('sv-s').textContent=(s&&!dept)?s.served:mt.filter(function(t){return t.status==='served'}).length
  document.getElementById('sv-k').textContent=(s&&!dept)?s.skipped:mt.filter(function(t){return t.status==='skipped'||t.status==='no_show'}).length
}

function renderHero(){
  var waiting=myTickets().filter(function(t){return t.status==='waiting'})
  var called=myTickets().filter(function(t){return t.status==='called'})
  var nEl=document.getElementById('h-num'),mEl=document.getElementById('h-meta')
  var bNext=document.getElementById('b-next'),bRec=document.getElementById('b-recall')
  if(waiting.length>0){
    var t=waiting[0],cat=catOf(t.category_id)
    nEl.textContent=t.display_number;nEl.className='hero-num'
    mEl.innerHTML='<span class="hm-cat">'+(cat?esc(cat.label):'')+'</span> &nbsp;<span class="hm-age">'+ago(t.created_at)+' waiting</span>'
    bNext.disabled=false
  }else{
    nEl.innerHTML='&#8212;';nEl.className='hero-num empty'
    mEl.textContent='Queue is empty';bNext.disabled=true
  }
  bRec.disabled=called.length===0
}

function renderCalled(){
  var called=myTickets().filter(function(t){return t.status==='called'}).slice().reverse()
  var sec=document.getElementById('sec-called')
  var list=document.getElementById('called-list')
  document.getElementById('called-ct').textContent=called.length
  if(called.length===0){sec.style.display='none';return}
  sec.style.display='block'
  list.innerHTML=called.map(function(t){
    var cat=catOf(t.category_id),win=winOf(t.window_id)
    var age=t.called_at?ago(t.called_at):''
    return '<div class="trow" id="tr-'+t.id+'">'
      +'<div class="trow-num" style="color:'+(cat?cat.color:'var(--pl)')+'">'+esc(t.display_number)+'</div>'
      +'<div class="trow-info"><div class="trow-cat">'+(cat?esc(cat.label):'')+'</div>'
      +'<div class="trow-meta">'+(win?'&#8594; '+esc(win.label):'')+(age?' &middot; '+age:'')+'</div></div>'
      +'<div class="trow-acts">'
      +'<button class="act act-s" onclick="doServe(\\''+t.id+'\\')">&#10003;</button>'
      +'<button class="act act-r" onclick="doRecall(\\''+t.id+'\\')">&#8635;</button>'
      +'<button class="act act-n" onclick="doNoShow(\\''+t.id+'\\')">&#10005;</button>'
      +'<button class="act act-k" onclick="doSkip(\\''+t.id+'\\')">&#9197;</button>'
      +'</div></div>'
  }).join('')
}

function renderWaiting(){
  var waiting=myTickets().filter(function(t){return t.status==='waiting'})
  document.getElementById('wait-ct').textContent=waiting.length
  var el=document.getElementById('wait-list')
  if(waiting.length===0){el.innerHTML='<div class="empty-msg">&#10003; Queue is empty</div>';return}
  el.innerHTML=waiting.map(function(t,i){
    var cat=catOf(t.category_id)
    return '<div class="wrow'+(i===0?' next':'')+'">'
      +'<div class="wrow-pos">'+(i+1)+'</div>'
      +'<div class="wrow-num">'+esc(t.display_number)+'</div>'
      +'<div class="wrow-info"><div class="wrow-cat">'+(cat?esc(cat.label):'')+'</div>'
      +'<div class="wrow-age">'+ago(t.created_at)+'</div></div>'
      +(i===0?'<div class="next-badge">NEXT</div>':'')
      +'</div>'
  }).join('')
}

// ── actions ───────────────────────────────────────────────────────────────────
async function callNext(){
  var waiting=myTickets().filter(function(t){return t.status==='waiting'})
  if(!waiting.length)return
  var t=waiting[0],wid=selWin()
  if(!wid)return
  document.getElementById('b-next').disabled=true
  var row=document.getElementById('hero-card')
  if(row){row.classList.remove('flash');void row.offsetWidth;row.classList.add('flash')}
  await post('/api/tickets/'+t.id+'/call',{windowId:wid})
}

async function recallLast(){
  var called=myTickets().filter(function(t){return t.status==='called'})
  if(!called.length)return
  await post('/api/tickets/'+called[called.length-1].id+'/recall',{})
}

async function doServe(id){await post('/api/tickets/'+id+'/serve',{})}
async function doRecall(id){await post('/api/tickets/'+id+'/recall',{})}
async function doSkip(id){await post('/api/tickets/'+id+'/skip',{})}
async function doNoShow(id){await post('/api/tickets/'+id+'/no-show',{})}

async function callName(){
  var inp=document.getElementById('i-name')
  var name=inp.value.trim()
  if(!name)return
  var btn=document.getElementById('b-announce')
  btn.disabled=true
  await post('/api/call-name',{name:name,windowId:selWin()})
  inp.value='';btn.disabled=false;inp.focus()
}

function signOut(){
  user=null;dept=null
  if(es){try{es.close()}catch(e){};es=null}
  document.getElementById('i-user').value=''
  document.getElementById('i-pass').value=''
  document.getElementById('l-err').style.display='none'
  document.getElementById('b-login').disabled=false
  document.getElementById('b-login').innerHTML='Sign In &#8594;'
  show('s-login')
}

// ── keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown',function(e){
  var tag=e.target.tagName
  if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return
  if(e.key==='F1'){e.preventDefault();callNext()}
  if(e.key==='F2'){e.preventDefault();recallLast()}
})

// ── init ─────────────────────────────────────────────────────────────────────
document.getElementById('i-user').addEventListener('keydown',function(e){if(e.key==='Enter')doLogin()})
document.getElementById('i-pass').addEventListener('keydown',function(e){if(e.key==='Enter')doLogin()})
document.getElementById('i-name').addEventListener('keydown',function(e){if(e.key==='Enter')callName()})
</script>
</body>
</html>`
  }
}
