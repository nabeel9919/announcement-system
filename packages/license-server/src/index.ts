import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { PrismaClient } from '@prisma/client'
import 'dotenv/config'

import { licensesRoutes } from './routes/licenses'
import { billingRoutes } from './routes/billing'

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
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN ?? '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  })

  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'CHANGE_THIS_IN_PRODUCTION',
  })

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  })

  // Auth decorator
  fastify.decorate('authenticate', async function (request: any, reply: any) {
    try {
      await request.jwtVerify()
    } catch {
      reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  // Admin login
  fastify.post('/api/auth/login', async (request, reply) => {
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

  const port = parseInt(process.env.PORT ?? '3001')
  await fastify.listen({ port, host: '0.0.0.0' })
  console.log(`License server running on port ${port}`)
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
