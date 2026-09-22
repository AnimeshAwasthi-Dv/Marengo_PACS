import crypto from 'node:crypto'
import express from 'express'
import { z } from 'zod'
import { requireAuth, requireRadiologist } from './auth'
import { prisma } from './db'
import { enqueueCallBookingNotification } from './whatsapp'

export const operationsRouter = express.Router()

operationsRouter.get('/queries', requireAuth, async (req, res) => {
  if (!['SUPER_ADMIN', 'PROVIDER_ADMIN', 'PROVIDER_MANAGER'].includes(req.user!.role)) return res.status(403).json({ message: 'Query access denied' })
  const items = await prisma.supportTicket.findMany({
    where: req.user!.role === 'SUPER_ADMIN' ? {} : { assignedTeam: 'RENEWIST' },
    include: { client: { select: { id: true, code: true, name: true } }, messages: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
    take: 300,
  })
  res.json(items)
})

operationsRouter.patch('/queries/:id/status', requireAuth, async (req, res) => {
  if (req.user!.role !== 'SUPER_ADMIN') return res.status(403).json({ message: 'Dectrocel query management permission required' })
  const body = z.object({ status: z.enum(['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']), assignedAgentId: z.string().optional().nullable() }).parse(req.body)
  const existing = await prisma.supportTicket.findUnique({ where: { id: String(req.params.id) } })
  if (!existing) return res.status(404).json({ message: 'Query not found' })
  const updated = await prisma.supportTicket.update({ where: { id: existing.id }, data: body })
  await prisma.auditLog.create({ data: { clientId: existing.clientId, actorUserId: req.user!.sub, action: 'QUERY_STATUS_CHANGED', metadata: { queryId: existing.id, previousStatus: existing.status, status: updated.status } } })
  res.json(updated)
})

operationsRouter.get('/demo-requests', requireAuth, async (req, res) => {
  if (req.user!.role !== 'SUPER_ADMIN') return res.status(403).json({ message: 'Dectrocel demo request access required' })
  const status = String(req.query.status ?? '').trim().toUpperCase()
  const q = String(req.query.q ?? '').trim()
  res.json(await prisma.demoRequest.findMany({
    where: { ...(status ? { status } : {}), ...(q ? { OR: [{ requestNumber: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }, { organization: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}) },
    include: { client: { select: { id: true, code: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 300,
  }))
})

operationsRouter.patch('/demo-requests/:id', requireAuth, async (req, res) => {
  if (req.user!.role !== 'SUPER_ADMIN') return res.status(403).json({ message: 'Dectrocel demo request management required' })
  const body = z.object({ status: z.enum(['NEW', 'CONTACTED', 'SCHEDULED', 'COMPLETED', 'CANCELLED']).optional(), assignedUserId: z.string().optional().nullable(), notes: z.string().max(4000).optional().nullable(), scheduledAt: z.coerce.date().optional().nullable() }).parse(req.body)
  const existing = await prisma.demoRequest.findUnique({ where: { id: String(req.params.id) } })
  if (!existing) return res.status(404).json({ message: 'Demo request not found' })
  const now = new Date()
  const updated = await prisma.demoRequest.update({ where: { id: existing.id }, data: { ...body, contactedAt: body.status === 'CONTACTED' ? existing.contactedAt ?? now : undefined, completedAt: body.status === 'COMPLETED' ? now : undefined, cancelledAt: body.status === 'CANCELLED' ? now : undefined } })
  await prisma.auditLog.create({ data: { actorUserId: req.user!.sub, action: 'DEMO_REQUEST_UPDATED', metadata: { demoRequestId: existing.id, previousStatus: existing.status, status: updated.status } } })
  res.json(updated)
})

operationsRouter.get('/call-requests', requireAuth, async (req, res) => {
  let where = {}
  if (req.user!.role === 'RADIOLOGIST') {
    const profile = await prisma.radiologistProfile.findUnique({ where: { userId: req.user!.sub }, select: { id: true } })
    where = { radiologistId: profile?.id ?? '__none__' }
  } else if (req.user!.role === 'CLIENT_USER') where = { clientId: req.user!.clientId ?? '__none__' }
  else if (['PROVIDER_ADMIN', 'PROVIDER_MANAGER'].includes(req.user!.role)) where = { radiologist: { providerCode: req.user!.providerCode } }
  else if (req.user!.role !== 'SUPER_ADMIN') return res.status(403).json({ message: 'Call request access denied' })
  res.json(await prisma.reportCallBooking.findMany({ where, include: { report: true, client: { select: { id: true, code: true, name: true } }, radiologist: true }, orderBy: { createdAt: 'desc' }, take: 300 }))
})

operationsRouter.post('/call-requests', requireAuth, requireRadiologist, async (req, res) => {
  const body = z.object({ reportId: z.string().min(1), reason: z.string().min(3).max(2000), preferredAt: z.coerce.date(), message: z.string().max(2000).optional(), urgency: z.enum(['ROUTINE', 'PRIORITY', 'URGENT']).default('ROUTINE') }).parse(req.body)
  if (body.preferredAt <= new Date()) return res.status(400).json({ message: 'Preferred call time must be in the future' })
  const profile = await prisma.radiologistProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } })
  const report = await prisma.reportReview.findFirst({ where: { id: body.reportId, OR: [{ radiologistId: profile.id }, { radiologistId: null }] } })
  if (!report) return res.status(403).json({ message: 'Report is not available to this radiologist' })
  const slotEnd = new Date(body.preferredAt.getTime() + 15 * 60 * 1000)
  const room = `Dectrocel-${report.id}-${crypto.randomBytes(4).toString('hex')}`
  const booking = await prisma.reportCallBooking.create({ data: { reportId: report.id, clientId: report.clientId, radiologistId: profile.id, slotStart: body.preferredAt, slotEnd, status: 'REQUESTED', reason: body.reason, requestMessage: body.message, urgency: body.urgency, createdByUserId: req.user!.sub, meetingRoom: room, meetingUrl: `https://meet.jit.si/${room}` } })
  await enqueueCallBookingNotification(prisma, { eventType: 'CALL_REQUEST_CREATED', bookingId: booking.id, clientId: booking.clientId, reportId: booking.reportId, radiologistId: booking.radiologistId, status: booking.status, slotStart: booking.slotStart, slotEnd: booking.slotEnd, meetingUrl: booking.meetingUrl, communicationMode: booking.communicationMode, phoneNumber: booking.phoneNumber, idempotencyKey: `call:${booking.id}:requested` })
  await prisma.auditLog.create({ data: { clientId: booking.clientId, actorUserId: req.user!.sub, action: 'CALL_REQUEST_CREATED', metadata: { bookingId: booking.id, reportId: booking.reportId, urgency: booking.urgency } } })
  res.status(201).json(booking)
})

operationsRouter.post('/call-requests/:id/confirm', requireAuth, requireRadiologist, async (req, res) => {
  const profile = await prisma.radiologistProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } })
  const existing = await prisma.reportCallBooking.findFirst({ where: { id: String(req.params.id), radiologistId: profile.id } })
  if (!existing) return res.status(404).json({ message: 'Call request not found' })
  if (!['REQUESTED', 'RESCHEDULED'].includes(existing.status)) return res.status(409).json({ message: 'Call request cannot be confirmed in its current status' })
  const updated = await prisma.reportCallBooking.update({ where: { id: existing.id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), radiologistAcceptedAt: new Date(), radiologistAcceptedByUserId: req.user!.sub } })
  await enqueueCallBookingNotification(prisma, { eventType: 'CALL_REQUEST_CONFIRMED', bookingId: updated.id, clientId: updated.clientId, reportId: updated.reportId, radiologistId: updated.radiologistId, status: updated.status, slotStart: updated.slotStart, slotEnd: updated.slotEnd, meetingUrl: updated.meetingUrl, communicationMode: updated.communicationMode, phoneNumber: updated.phoneNumber, idempotencyKey: `call:${updated.id}:confirmed` })
  await prisma.auditLog.create({ data: { clientId: updated.clientId, actorUserId: req.user!.sub, action: 'CALL_REQUEST_CONFIRMED', metadata: { bookingId: updated.id, previousStatus: existing.status } } })
  res.json(updated)
})

operationsRouter.post('/call-requests/:id/cancel', requireAuth, async (req, res) => {
  const body = z.object({ reason: z.string().max(2000).optional() }).parse(req.body)
  const existing = await prisma.reportCallBooking.findUnique({ where: { id: String(req.params.id) }, include: { radiologist: true } })
  if (!existing) return res.status(404).json({ message: 'Call request not found' })
  const allowed = req.user!.role === 'SUPER_ADMIN' || existing.createdByUserId === req.user!.sub || existing.radiologist?.userId === req.user!.sub
  if (!allowed) return res.status(403).json({ message: 'Call cancellation denied' })
  const updated = await prisma.reportCallBooking.update({ where: { id: existing.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), requestMessage: body.reason ? `${existing.requestMessage ?? ''}\nCancellation: ${body.reason}`.trim() : undefined } })
  await enqueueCallBookingNotification(prisma, { eventType: 'CALL_REQUEST_CANCELLED', bookingId: updated.id, clientId: updated.clientId, reportId: updated.reportId, radiologistId: updated.radiologistId, status: updated.status, slotStart: updated.slotStart, slotEnd: updated.slotEnd, meetingUrl: updated.meetingUrl, communicationMode: updated.communicationMode, phoneNumber: updated.phoneNumber, idempotencyKey: `call:${updated.id}:cancelled` })
  await prisma.auditLog.create({ data: { clientId: updated.clientId, actorUserId: req.user!.sub, action: 'CALL_REQUEST_CANCELLED', metadata: { bookingId: updated.id, previousStatus: existing.status } } })
  res.json(updated)
})

operationsRouter.get('/radiologist/patient-reports', requireAuth, requireRadiologist, async (req, res) => {
  const patientIdentifier = z.string().min(1).max(120).parse(req.query.patientId)
  const profile = await prisma.radiologistProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } })
  const reports = await prisma.reportReview.findMany({ where: { patientProfile: { patientIdentifier: { equals: patientIdentifier, mode: 'insensitive' } }, OR: [{ radiologistId: profile.id }, { radiologistId: null }] }, include: { patientProfile: true, feedback: { where: { radiologistUserId: req.user!.sub }, orderBy: { submissionVersion: 'desc' } } }, orderBy: { generatedAt: 'desc' }, take: 50 })
  res.json(reports)
})
