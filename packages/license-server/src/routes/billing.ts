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

const createClientSchema = z.object({
  organizationName: z.string().min(1),
  contactEmail: z.string().email(),
  contactPhone: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  sector: z.string().optional(),
  notes: z.string().optional(),
})

const updateClientSchema = createClientSchema.partial()

export const billingRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Pricing Plans ──────────────────────────────────────────────────────────

  /** GET /api/billing/plans — public, used by desktop app */
  fastify.get('/plans', async (_request, reply) => {
    const plans = await (fastify as any).prisma.pricingPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    })
    return reply.send(plans)
  })

  /** GET /api/billing/plans/all — admin: includes inactive */
  fastify.get('/plans/all', { onRequest: [(fastify as any).authenticate] }, async (_request, reply) => {
    const plans = await (fastify as any).prisma.pricingPlan.findMany({
      orderBy: { sortOrder: 'asc' },
    })
    return reply.send(plans)
  })

  /** POST /api/billing/plans — admin: create plan */
  fastify.post('/plans', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const body = createPlanSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() })
    }
    const plan = await (fastify as any).prisma.pricingPlan.create({ data: body.data })
    return reply.code(201).send(plan)
  })

  /** PATCH /api/billing/plans/:id — admin: update plan */
  fastify.patch('/plans/:id', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = updatePlanSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() })
    }
    const plan = await (fastify as any).prisma.pricingPlan.update({ where: { id }, data: body.data })
    return reply.send(plan)
  })

  /** DELETE /api/billing/plans/:id — admin: deactivate plan */
  fastify.delete('/plans/:id', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await (fastify as any).prisma.pricingPlan.update({ where: { id }, data: { isActive: false } })
    return reply.send({ success: true })
  })

  // ── Clients ────────────────────────────────────────────────────────────────

  /** GET /api/billing/clients — admin: all clients with subscriptions + licenses */
  fastify.get('/clients', { onRequest: [(fastify as any).authenticate] }, async (_request, reply) => {
    const clients = await (fastify as any).prisma.client.findMany({
      include: {
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { plan: { select: { name: true, price: true, currency: true, interval: true } } },
        },
        licenses: {
          select: {
            id: true,
            formattedKey: true,
            tier: true,
            maxWindows: true,
            expiresAt: true,
            isRevoked: true,
            machineId: true,
            activatedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send(clients)
  })

  /** POST /api/billing/clients — admin: create client */
  fastify.post('/clients', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const body = createClientSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() })
    }
    const client = await (fastify as any).prisma.client.create({ data: body.data })
    return reply.code(201).send(client)
  })

  /** PATCH /api/billing/clients/:id — admin: update client */
  fastify.patch('/clients/:id', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = updateClientSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() })
    }
    const client = await (fastify as any).prisma.client.update({ where: { id }, data: body.data })
    return reply.send(client)
  })

  /** DELETE /api/billing/clients/:id — admin: remove client */
  fastify.delete('/clients/:id', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await (fastify as any).prisma.client.delete({ where: { id } })
    return reply.send({ success: true })
  })

  // ── Invoices ───────────────────────────────────────────────────────────────

  /** GET /api/billing/invoices — admin: all invoices */
  fastify.get('/invoices', { onRequest: [(fastify as any).authenticate] }, async (_request, reply) => {
    const invoices = await (fastify as any).prisma.invoice.findMany({
      include: {
        client: { select: { organizationName: true, contactEmail: true } },
        subscription: { include: { plan: { select: { name: true } } } },
      },
      orderBy: { issuedAt: 'desc' },
    })
    return reply.send(invoices)
  })
}
