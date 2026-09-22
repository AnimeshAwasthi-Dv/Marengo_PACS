import crypto from 'node:crypto'
import express from 'express'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from './auth'
import { prisma } from './db'
import { createDomainNotification } from './notificationService'

export const supportRouter = express.Router()

supportRouter.use(requireAuth)

supportRouter.get('/tickets', async (req, res) => {
  const tickets = await prisma.supportTicket.findMany({
    where: await ticketScope(req.user!),
    include: { client: { select: { id: true, code: true, name: true } }, messages: { orderBy: { createdAt: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  })
  res.json(tickets.map((ticket) => ({
    ...ticket,
    messages: ticket.messages.filter((message) => canSeeMessage(req.user!.role, message.visibility)),
  })))
})

supportRouter.post('/tickets', async (req, res) => {
  const body = z.object({
    clientId: z.string().optional(),
    relatedStudyId: z.string().optional(),
    category: z.string().min(2).max(80),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
    subject: z.string().min(3).max(160),
    description: z.string().min(3).max(4000),
    assignedTeam: z.enum(['DECTROCEL', 'RENEWIST']).optional(),
  }).parse(req.body)
  const clientId = req.user!.role === 'CLIENT_USER' ? await supportClientId(req.user!, body.clientId) : body.clientId
  if (req.user!.role === 'CLIENT_USER' && !clientId) return res.status(403).json({ message: 'Client support tickets require a client scope' })
  if (req.user!.role === 'RADIOLOGIST') return res.status(403).json({ message: 'Radiologists cannot create support tickets directly' })

  const ticketNumber = await nextTicketNumber()
  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.supportTicket.create({
      data: {
        ticketNumber,
        clientId: clientId ?? null,
        relatedStudyId: body.relatedStudyId,
        category: body.category,
        priority: body.priority,
        subject: body.subject,
        description: body.description,
        assignedTeam: body.assignedTeam ?? (req.user!.providerCode ? 'RENEWIST' : 'DECTROCEL'),
        createdByUserId: req.user!.sub,
        whatsappDemo: process.env.WHATSAPP_DEMO_MODE !== 'false',
      },
    })
    await tx.supportTicketMessage.create({
      data: {
        ticketId: created.id,
        authorUserId: req.user!.sub,
        authorRole: req.user!.role,
        body: body.description,
      },
    })
    await tx.auditLog.create({
      data: {
        clientId: clientId ?? null,
        actorUserId: req.user!.sub,
        action: 'SUPPORT_TICKET_CREATED',
        metadata: { ticketId: created.id, ticketNumber, category: body.category, priority: body.priority, assignedTeam: body.assignedTeam },
        ipAddress: req.ip,
      },
    })
    return created
  })
  await createDomainNotification(prisma, {
    eventType: 'QUERY_CREATED', aggregateType: 'SupportTicket', aggregateId: ticket.id,
    idempotencyKey: `query:${ticket.id}:created`, clientId: ticket.clientId,
    status: ticket.status, title: `New query ${ticket.ticketNumber}`,
    message: `${ticket.category}: ${ticket.subject}`, category: 'QUERY', organizations: ['DECTROCEL'],
    metadata: { priority: ticket.priority, assignedTeam: ticket.assignedTeam },
  })
  res.status(201).json(ticket)
})

supportRouter.post('/tickets/:ticketId/messages', async (req, res) => {
  const body = z.object({
    body: z.string().min(1).max(4000),
    visibility: z.enum(['PUBLIC', 'INTERNAL']).default('PUBLIC'),
  }).parse(req.body)
  const ticket = await prisma.supportTicket.findFirst({ where: { id: String(req.params.ticketId), ...await ticketScope(req.user!) } })
  if (!ticket) return res.status(404).json({ message: 'Support ticket not found' })
  if (req.user!.role === 'CLIENT_USER' && body.visibility === 'INTERNAL') return res.status(403).json({ message: 'Client users cannot create internal notes' })
  const message = await prisma.supportTicketMessage.create({
    data: {
      ticketId: ticket.id,
      authorUserId: req.user!.sub,
      authorRole: req.user!.role,
      visibility: body.visibility,
      body: body.body,
    },
  })
  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: { firstResponseAt: ticket.firstResponseAt ?? (req.user!.role === 'CLIENT_USER' ? null : new Date()) },
  })
  await prisma.auditLog.create({
    data: { clientId: ticket.clientId, actorUserId: req.user!.sub, action: 'SUPPORT_TICKET_MESSAGE_CREATED', metadata: { ticketId: ticket.id, visibility: body.visibility }, ipAddress: req.ip },
  })
  res.status(201).json(message)
})

supportRouter.patch('/tickets/:ticketId/status', async (req, res) => {
  const body = z.object({ status: z.enum(['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING_FOR_MARENGO', 'WAITING_FOR_RENEWIST', 'WAITING_FOR_DECTROCEL', 'RESOLVED', 'CLOSED', 'REOPENED']) }).parse(req.body)
  const ticket = await prisma.supportTicket.findFirst({ where: { id: String(req.params.ticketId), ...await ticketScope(req.user!) } })
  if (!ticket) return res.status(404).json({ message: 'Support ticket not found' })
  const now = new Date()
  const updated = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      status: body.status,
      resolvedAt: body.status === 'RESOLVED' ? now : ticket.resolvedAt,
      closedAt: body.status === 'CLOSED' ? now : ticket.closedAt,
    },
  })
  await prisma.auditLog.create({
    data: { clientId: ticket.clientId, actorUserId: req.user!.sub, action: 'SUPPORT_TICKET_STATUS_UPDATED', metadata: { ticketId: ticket.id, previousStatus: ticket.status, status: body.status }, ipAddress: req.ip },
  })
  res.json(updated)
})

supportRouter.get('/whatsapp/demo', (_req, res) => {
  const payload = 'marengo-support-demo:whatsapp-cloud-api-not-configured'
  res.json({
    demoMode: process.env.WHATSAPP_DEMO_MODE !== 'false',
    cloudApiEnabled: process.env.WHATSAPP_CLOUD_API_ENABLED === 'true',
    label: 'WhatsApp synchronization demo mode',
    message: 'This QR is a safe placeholder and does not connect to WhatsApp or synchronize messages.',
    qrPayload: payload,
    qrDataUrl: `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(payload)}`,
  })
})

async function ticketScope(user: { role: string; clientId?: string; providerCode?: string }): Promise<Prisma.SupportTicketWhereInput> {
  if (user.role === 'SUPER_ADMIN') return {}
  if (user.role === 'CLIENT_USER') {
    const client = user.clientId ? await prisma.client.findUnique({ where: { id: user.clientId }, select: { kind: true } }) : null
    if (client?.kind === 'GROUP') {
      return {
        OR: [
          { clientId: user.clientId },
          { client: { kind: 'CENTER', parentClientId: user.clientId } },
        ],
      }
    }
    return { clientId: user.clientId }
  }
  if (user.providerCode) return { assignedTeam: 'RENEWIST' }
  return { id: '__deny__' }
}

async function supportClientId(user: { role: string; clientId?: string }, requestedClientId?: string) {
  if (user.role !== 'CLIENT_USER') return requestedClientId
  if (!user.clientId) return null
  const client = await prisma.client.findUnique({ where: { id: user.clientId }, select: { kind: true } })
  if (client?.kind !== 'GROUP') return user.clientId
  if (!requestedClientId) return user.clientId
  const target = await prisma.client.findFirst({
    where: {
      id: requestedClientId,
      OR: [{ id: user.clientId }, { kind: 'CENTER', parentClientId: user.clientId }],
    },
    select: { id: true },
  })
  return target?.id ?? null
}

function canSeeMessage(role: string, visibility: string) {
  return visibility !== 'INTERNAL' || role === 'SUPER_ADMIN' || role === 'PROVIDER_ADMIN' || role === 'PROVIDER_MANAGER'
}

async function nextTicketNumber() {
  const date = new Date()
  const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = crypto.randomBytes(3).toString('hex').toUpperCase()
    const candidate = `MNG-${stamp}-${suffix}`
    const exists = await prisma.supportTicket.findUnique({ where: { ticketNumber: candidate }, select: { id: true } })
    if (!exists) return candidate
  }
  return `MNG-${stamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
}
