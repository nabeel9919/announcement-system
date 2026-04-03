import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const updatePlanSchema = z.object({
  name: z.string().optional(),
  price: z.number().int().positive().optional(),
  currency: z.string().length(3).optional(),
  interval: z.enum(['MONTHLY', 'YEARLY']).optional(),
  features: z.array(z.string()).optional(),
  maxWindows: z.number().int().positive().optional(),
  maxSites: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  isHighlighted: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  yearlyDiscountPercent: z.number().int().min(0).max(100).optional(),
})

const createPlanSchema = updatePlanSchema.extend({
  name: z.string(),
  price: z.number().int().positive(),
  currency: z.string().length(3).default('TZS'),
  interval: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY'),
  features: z.array(z.string()).default([]),
  maxWindows: z.number().int().positive(),
  maxSites: z.number().int().positive(),
})

export const billingRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /api/billing/plans — public, used by desktop app and landing page */
  fastify.get('/plans', async (_request, reply) => {
    const plans = await (fastify as any).prisma.pricingPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    })
    return reply.send(plans)
  })

  /** GET /api/billing/plans/all — admin only, includes inactive */
  fastify.get('/plans/all', { onRequest: [(fastify as any).authenticate] }, async (_request, reply) => {
    const plans = await (fastify as any).prisma.pricingPlan.findMany({
      orderBy: { sortOrder: 'asc' },
    })
    return reply.send(plans)
  })

  /** POST /api/billing/plans — admin: create a new plan */
  fastify.post('/plans', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const body = createPlanSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() })
    }

    const plan = await (fastify as any).prisma.pricingPlan.create({ data: body.data })
    return reply.code(201).send(plan)
  })

  /** PATCH /api/billing/plans/:id — admin: update plan (price, features, etc.) */
  fastify.patch('/plans/:id', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = updatePlanSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() })
    }

    const plan = await (fastify as any).prisma.pricingPlan.update({
      where: { id },
      data: body.data,
    })
    return reply.send(plan)
  })

  /** DELETE /api/billing/plans/:id — admin: deactivate a plan */
  fastify.delete('/plans/:id', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await (fastify as any).prisma.pricingPlan.update({
      where: { id },
      data: { isActive: false },
    })
    return reply.send({ success: true })
  })

  /** GET /api/billing/clients — admin: list all clients with subscription status */
  fastify.get('/clients', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const clients = await (fastify as any).prisma.client.findMany({
      include: {
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 },
        licenses: { select: { formattedKey: true, tier: true, expiresAt: true, isRevoked: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send(clients)
  })

  /** GET /api/billing/invoices — admin: all invoices */
  fastify.get('/invoices', { onRequest: [(fastify as any).authenticate] }, async (_request, reply) => {
    const invoices = await (fastify as any).prisma.invoice.findMany({
      include: { client: { select: { organizationName: true, contactEmail: true } } },
      orderBy: { issuedAt: 'desc' },
    })
    return reply.send(invoices)
  })
}
