import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { PrismaClient } from '@prisma/client'
import 'dotenv/config'

import { licensesRoutes } from './routes/licenses'
import { billingRoutes } from './routes/billing'
import { sendSMS, licenseExpiryMessage, invoiceDueMessage } from './services/sms'
import { startCron, stopCron } from './services/cron'

const prisma = new PrismaClient()

async function bootstrap() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty' }
        : undefined,
    },
  })

  // Attach prisma to fastify instance
  fastify.decorate('prisma', prisma)

  // Plugins
  const corsOrigin = process.env.CORS_ORIGIN
  await fastify.register(cors, {
    // In production set CORS_ORIGIN to your Vercel domain.
    // '*' is fine for the desktop app (Electron has no origin header).
    origin: corsOrigin ? corsOrigin.split(',').map((s) => s.trim()) : '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
  })

  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'CHANGE_THIS_IN_PRODUCTION_USE_64_CHAR_HEX',
  })

  // Tighter rate limits on auth endpoints
  await fastify.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    // Auth routes: tighter limit to prevent brute force
    keyGenerator: (request) => request.ip,
  })

  // Auth decorator
  fastify.decorate('authenticate', async function (request: any, reply: any) {
    try {
      await request.jwtVerify()
    } catch {
      reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  // Admin login — strict rate limit: 10 attempts per 5 minutes per IP
  fastify.post('/api/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string }
    const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@announcement.local'
    const adminPassword = process.env.ADMIN_PASSWORD ?? 'CHANGE_IN_PRODUCTION'

    if (email !== adminEmail || password !== adminPassword) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }

    const token = fastify.jwt.sign({ role: 'admin', email }, { expiresIn: '24h' })
    return reply.send({ token })
  })

  // Routes
  await fastify.register(licensesRoutes, { prefix: '/api/licenses' })
  await fastify.register(billingRoutes, { prefix: '/api/billing' })

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // Settings stub — stored in env, real persistence via restart
  fastify.patch('/api/settings', { onRequest: [(fastify as any).authenticate] }, async (_request, reply) => {
    return reply.send({ success: true })
  })

  // Export — basic JSON dump of all data
  fastify.get('/api/export', { onRequest: [(fastify as any).authenticate] }, async (_request, reply) => {
    const [clients, plans, invoices] = await Promise.all([
      (fastify as any).prisma.client.findMany({ include: { licenses: true, subscriptions: true } }),
      (fastify as any).prisma.pricingPlan.findMany(),
      (fastify as any).prisma.invoice.findMany(),
    ])
    return reply.send({ exportedAt: new Date().toISOString(), clients, plans, invoices })
  })

  // Emergency revoke-all
  fastify.post('/api/licenses/revoke-all', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const { reason } = (request.body as any) ?? {}
    const { count } = await (fastify as any).prisma.license.updateMany({
      where: { isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date(), revokedReason: reason ?? 'Emergency revoke' },
    })
    return reply.send({ success: true, revokedCount: count })
  })

  // ── SMS endpoints ─────────────────────────────────────────────────────────

  /** POST /api/sms/send — admin: manual SMS to a client phone */
  fastify.post('/api/sms/send', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const { to, message } = request.body as { to: string; message: string }
    if (!to || !message) return reply.code(400).send({ error: 'to and message required' })
    const result = await sendSMS(to, message)
    return reply.send(result)
  })

  /** POST /api/sms/notify-expiry — send expiry SMS to all licenses expiring within N days */
  fastify.post('/api/sms/notify-expiry', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const { daysAhead = 7 } = (request.body as any) ?? {}
    const cutoff = new Date(Date.now() + daysAhead * 86400000)

    const licenses = await (fastify as any).prisma.license.findMany({
      where: { isRevoked: false, expiresAt: { lte: cutoff, gte: new Date() } },
      include: { client: { select: { organizationName: true, contactPhone: true } } },
    })

    const results = []
    for (const lic of licenses) {
      if (!lic.client.contactPhone) continue
      const daysLeft = Math.ceil((new Date(lic.expiresAt).getTime() - Date.now()) / 86400000)
      const msg = licenseExpiryMessage(lic.client.organizationName, daysLeft)
      const result = await sendSMS(lic.client.contactPhone, msg)
      results.push({ license: lic.formattedKey, phone: lic.client.contactPhone, ...result })
    }

    return reply.send({ sent: results.length, results })
  })

  /** POST /api/sms/notify-invoice — SMS reminder for all open overdue invoices */
  fastify.post('/api/sms/notify-invoice', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const now = new Date()
    const invoices = await (fastify as any).prisma.invoice.findMany({
      where: { status: 'OPEN', dueAt: { lt: now } },
      include: { client: { select: { organizationName: true, contactPhone: true } } },
    })

    const results = []
    for (const inv of invoices) {
      if (!inv.client.contactPhone) continue
      const msg = invoiceDueMessage(
        inv.client.organizationName, inv.amount, inv.currency,
        new Date(inv.dueAt).toLocaleDateString('en-TZ', { day: '2-digit', month: 'short', year: 'numeric' })
      )
      const result = await sendSMS(inv.client.contactPhone, msg)
      results.push({ invoiceId: inv.id, phone: inv.client.contactPhone, ...result })
    }

    return reply.send({ sent: results.length, results })
  })

  // TTS proxy (keeps Google TTS API key server-side)
  fastify.post('/api/tts/synthesize', async (request, reply) => {
    const { text, language, voiceName, speakingRate, pitch } = request.body as any
    const apiKey = process.env.GOOGLE_TTS_API_KEY

    if (!apiKey) {
      return reply.code(503).send({ error: 'TTS not configured' })
    }

    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: language, name: voiceName },
          audioConfig: { audioEncoding: 'MP3', speakingRate, pitch },
        }),
      }
    )

    if (!response.ok) {
      return reply.code(502).send({ error: 'TTS upstream error' })
    }

    const data = (await response.json()) as { audioContent: string }
    const buffer = Buffer.from(data.audioContent, 'base64')
    return reply.type('audio/mpeg').send(buffer)
  })

  // ── Cron scheduler ────────────────────────────────────────────────────────
  startCron(prisma)

  fastify.addHook('onClose', async () => {
    stopCron()
    await prisma.$disconnect()
  })

  const port = parseInt(process.env.PORT ?? '3001')
  await fastify.listen({ port, host: '0.0.0.0' })
  console.log(`License server running on port ${port}`)
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
