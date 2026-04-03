import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { validateLicense } from '../services/key-validator'
import { generateLicenseKey } from '../services/key-generator'

const validateSchema = z.object({
  key: z.string().min(20).max(23),
  machineId: z.string().min(1),
  hostname: z.string().optional(),
})

const generateSchema = z.object({
  clientId: z.string(),
  tier: z.enum(['starter', 'professional', 'enterprise']),
  maxWindows: z.number().int().min(1).max(100),
  maxSites: z.number().int().min(1).max(50),
  features: z.array(z.string()),
  expiresAt: z.string().datetime(),
  organizationName: z.string(),
})

export const licensesRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/licenses/validate
   * Called by the desktop app on startup and every 4 hours.
   */
  fastify.post('/validate', async (request, reply) => {
    const body = validateSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() })
    }

    const { key, machineId } = body.data

    const result = await validateLicense(
      key,
      machineId,
      async (normalizedKey) => {
        const license = await (fastify as any).prisma.license.findUnique({
          where: { key: normalizedKey },
          include: { client: { select: { organizationName: true } } },
        })
        if (!license) return null
        return {
          ...license,
          organizationName: license.client.organizationName,
        }
      }
    )

    // Record machine binding on first activation
    if (result.valid && result.license) {
      const normalizedKey = key.replace(/-/g, '').toUpperCase()
      const existing = await (fastify as any).prisma.license.findUnique({
        where: { key: normalizedKey },
        select: { machineId: true, activatedAt: true },
      })

      if (!existing?.machineId) {
        await (fastify as any).prisma.license.update({
          where: { key: normalizedKey },
          data: {
            machineId,
            activatedAt: new Date(),
            lastValidatedAt: new Date(),
          },
        })
      } else {
        await (fastify as any).prisma.license.update({
          where: { key: normalizedKey },
          data: { lastValidatedAt: new Date() },
        })
      }
    }

    return reply.send(result)
  })

  /**
   * POST /api/licenses/generate
   * Admin-only: generate a new license key for a client.
   */
  fastify.post('/generate', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const body = generateSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() })
    }

    const { clientId, tier, maxWindows, maxSites, features, expiresAt, organizationName } = body.data

    // Verify client exists
    const client = await (fastify as any).prisma.client.findUnique({ where: { id: clientId } })
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' })
    }

    // Generate key
    const formattedKey = generateLicenseKey()
    const normalizedKey = formattedKey.replace(/-/g, '')

    const license = await (fastify as any).prisma.license.create({
      data: {
        key: normalizedKey,
        formattedKey,
        clientId,
        tier: tier.toUpperCase() as any,
        maxWindows,
        maxSites,
        features,
        expiresAt: new Date(expiresAt),
      },
    })

    return reply.code(201).send({ license, formattedKey })
  })

  /**
   * POST /api/licenses/:key/revoke
   * Admin-only: revoke a license immediately.
   */
  fastify.post('/:key/revoke', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const { key } = request.params as { key: string }
    const { reason } = request.body as { reason?: string }

    const normalized = key.replace(/-/g, '').toUpperCase()
    const license = await (fastify as any).prisma.license.findUnique({ where: { key: normalized } })

    if (!license) {
      return reply.code(404).send({ error: 'License not found' })
    }

    await (fastify as any).prisma.license.update({
      where: { key: normalized },
      data: { isRevoked: true, revokedAt: new Date(), revokedReason: reason },
    })

    return reply.send({ success: true })
  })

  /**
   * POST /api/licenses/:key/transfer
   * Admin-only: clear machine binding so key can be activated on a new machine.
   */
  fastify.post('/:key/transfer', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const { key } = request.params as { key: string }
    const normalized = key.replace(/-/g, '').toUpperCase()

    await (fastify as any).prisma.license.update({
      where: { key: normalized },
      data: { machineId: null, activatedAt: null },
    })

    return reply.send({ success: true, message: 'Machine binding cleared. Key can now be activated on a new machine.' })
  })
}
