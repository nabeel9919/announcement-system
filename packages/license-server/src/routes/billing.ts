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

  /** GET /api/billing/clients — admin: all clients with subscriptions, licenses + invoices */
  fastify.get('/clients', { onRequest: [(fastify as any).authenticate] }, async (_request, reply) => {
    const clients = await (fastify as any).prisma.client.findMany({
      include: {
        subscriptions: {
          orderBy: { createdAt: 'desc' },
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
        invoices: {
          orderBy: { issuedAt: 'desc' },
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

  // ── Subscriptions ──────────────────────────────────────────────────────────

  const createSubSchema = z.object({
    clientId: z.string(),
    planId: z.string(),
    status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID', 'PAUSED']).default('TRIALING'),
    currentPeriodStart: z.string().datetime(),
    currentPeriodEnd: z.string().datetime(),
    trialEndsAt: z.string().datetime().optional(),
  })

  fastify.post('/subscriptions', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const body = createSubSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() })

    const sub = await (fastify as any).prisma.subscription.create({
      data: {
        clientId: body.data.clientId,
        planId: body.data.planId,
        status: body.data.status,
        currentPeriodStart: new Date(body.data.currentPeriodStart),
        currentPeriodEnd: new Date(body.data.currentPeriodEnd),
        trialEndsAt: body.data.trialEndsAt ? new Date(body.data.trialEndsAt) : undefined,
      },
    })
    return reply.code(201).send(sub)
  })

  fastify.patch('/subscriptions/:id', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = createSubSchema.partial().safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid request' })

    const data: any = { ...body.data }
    if (data.currentPeriodStart) data.currentPeriodStart = new Date(data.currentPeriodStart)
    if (data.currentPeriodEnd) data.currentPeriodEnd = new Date(data.currentPeriodEnd)
    if (data.trialEndsAt) data.trialEndsAt = new Date(data.trialEndsAt)

    const sub = await (fastify as any).prisma.subscription.update({ where: { id }, data })
    return reply.send(sub)
  })

  // ── Invoices ───────────────────────────────────────────────────────────────

  const createInvoiceSchema = z.object({
    clientId: z.string(),
    subscriptionId: z.string().optional(),
    amount: z.number().int().positive(),
    currency: z.string().length(3).default('TZS'),
    description: z.string(),
    dueAt: z.string().datetime(),
  })

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

  /** POST /api/billing/invoices — create invoice */
  fastify.post('/invoices', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const body = createInvoiceSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() })

    const invoice = await (fastify as any).prisma.invoice.create({
      data: {
        clientId: body.data.clientId,
        subscriptionId: body.data.subscriptionId,
        amount: body.data.amount,
        currency: body.data.currency,
        description: body.data.description,
        dueAt: new Date(body.data.dueAt),
      },
    })
    return reply.code(201).send(invoice)
  })

  /** POST /api/billing/invoices/:id/pay — mark invoice as paid */
  fastify.post('/invoices/:id/pay', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const invoice = await (fastify as any).prisma.invoice.update({
      where: { id },
      data: { status: 'PAID', paidAt: new Date() },
    })
    return reply.send(invoice)
  })
}
