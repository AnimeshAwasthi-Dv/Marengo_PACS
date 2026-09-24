import crypto from 'node:crypto'
import { enqueuePhysicianReports, PHYSICIAN_REPORT_READY, PHYSICIAN_CALL_REQUESTED, PHYSICIAN_ROLE, physicianDelivery, physicianWhatsappReady, reportReadyTemplate, requestPhysicianCall } from './physicianWhatsapp'
import express from 'express'
import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from './auth'
import { prisma } from './db'
import { getDeploymentFeatures } from './deploymentProfile'
import { createDomainNotification } from './notificationService'
import { getBillingStatistics, getCenterStatistics, getReportingStatistics, getStudyUsageStatistics } from './statisticsService'

type DbClient = PrismaClient | Prisma.TransactionClient

type NotificationPayload = {
  category: string
  message: string
  clientId?: string | null
  to?: string[]
  reportId?: string | null
  processingJobId?: string | null
  bookingId?: string | null
  metadata?: Record<string, unknown>
  notificationEventId?: string | null
}

export function normalizeWhatsappPhone(value: unknown) {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`
  return trimmed
}
const phoneSchema = z.preprocess(normalizeWhatsappPhone, z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid phone number with country code'))
const recipientSchema = z.object({
  name: z.string().min(2).max(120),
  role: z.string().min(2).max(80),
  organization: z.enum(['DECTROCEL', 'RENEWIST', 'MARENGO_MANAGEMENT']).optional(),
  clientId: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
  phoneE164: phoneSchema,
  notificationCategories: z.array(z.enum(['ALL', 'INTERNAL_TEAM', 'STUDY_STATUS', 'CALL_BOOKING', 'QUERY', 'DEMO_REQUEST', 'AI_FEEDBACK', 'BILLING'])).default(['STUDY_STATUS']),
  active: z.boolean().default(true),
  consentStatus: z.enum(['PENDING', 'OPTED_IN', 'APPROVED', 'ACTIVE', 'OPTED_OUT']).default('PENDING'),
  consentConfirmed: z.literal(true),
  consentSource: z.string().min(3).max(160),
  verificationStatus: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).default('PENDING'),
  accessCategories: z.array(z.enum(['ALL', 'NOTIFICATIONS', 'BILLING', 'STATISTICS', 'MANAGEMENT_BOT'])).default(['NOTIFICATIONS']),
})
let outboxWorkerRunning = false
type BotFlow = {
  step: 'TECHNICAL_DESCRIPTION' | 'REPORTING_DESCRIPTION' | 'PRODUCT_QUERY' | 'HUMAN_DESCRIPTION' | 'DEMO_NAME' | 'DEMO_EMAIL' | 'DEMO_ORGANIZATION' | 'DEMO_PURPOSE'
  data: Record<string, string>
  updatedAt: number
}
type BotReply = { kind: 'text'; body: string } | { kind: 'support_menu' }
const botFlows = new Map<string, BotFlow>()
const processedIncomingMessages = new Map<string, number>()

export const whatsappRouter = express.Router()

whatsappRouter.get('/webhook', (req, res) => {
  const mode = String(req.query['hub.mode'] ?? '')
  const token = String(req.query['hub.verify_token'] ?? '')
  const challenge = String(req.query['hub.challenge'] ?? '')
  if (mode === 'subscribe' && token && token === whatsappWebhookVerifyToken()) {
    return res.status(200).send(challenge)
  }
  return res.sendStatus(403)
})

whatsappRouter.post('/webhook', async (req, res) => {
  if (!process.env.WHATSAPP_APP_SECRET?.trim() && extractIncomingMessages(req.body).some(message => message.text.startsWith('physician_call:'))) return res.sendStatus(401)
  if (!verifyWhatsappWebhookSignature(req)) return res.sendStatus(401)
  try {
    await handleIncomingWhatsapp(req.body)
    res.sendStatus(200)
  } catch (error) {
    console.error('WhatsApp webhook handling failed', error)
    res.sendStatus(503)
  }
})

whatsappRouter.use(requireAuth)

whatsappRouter.get('/config', async (req, res) => {
  if (!canManageWhatsapp(req.user!)) return res.status(403).json({ message: 'WhatsApp bot management requires admin access' })
  const scope = whatsappScope(req.user!)
  const [recipients, outbox, pendingCount, sentCount, failedCount] = await Promise.all([
    prisma.notificationRecipient.findMany({ where: recipientScopeWhere(scope), orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }], take: 100 }),
    prisma.notificationOutbox.findMany({ where: scope.global ? {} : { eventType: { not: PHYSICIAN_REPORT_READY } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.notificationOutbox.count({ where: { status: 'PENDING' } }),
    prisma.notificationOutbox.count({ where: { status: 'SENT' } }),
    prisma.notificationOutbox.count({ where: { status: { in: ['FAILED', 'DEAD'] } } }),
  ])
  res.json({
    physicianReportReady: physicianWhatsappReady(),
    physicianReportTemplateName: process.env.WHATSAPP_REPORT_READY_TEMPLATE_NAME?.trim() || '',
    callRequests: scope.global ? await prisma.notificationEvent.findMany({ where: { eventType: PHYSICIAN_CALL_REQUESTED }, orderBy: { createdAt: 'desc' }, take: 100 }) : [],
    cloudApiEnabled: process.env.WHATSAPP_CLOUD_API_ENABLED === 'true',
    demoMode: process.env.WHATSAPP_CLOUD_API_ENABLED !== 'true',
    hasCloudApiToken: Boolean(process.env.WHATSAPP_CLOUD_API_TOKEN),
    hasPhoneNumberId: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    hasWebhookVerifyToken: Boolean(whatsappWebhookVerifyToken()),
    webhookUrl: `${publicBaseUrl()}/api/v1/whatsapp/webhook`,
    callbackUrl: `${publicBaseUrl()}/api/v1/whatsapp/webhook`,
    webhookVerifyToken: whatsappWebhookVerifyToken(),
    hasAppSecret: Boolean(process.env.WHATSAPP_APP_SECRET?.trim()),
    hasUtilityTemplate: Boolean(whatsappUtilityTemplateName()),
    outboundReady: whatsappOutboundReady() || physicianWhatsappReady(),
    commandExample: 'Patient-related actions are available only in the secure portal.',
    recipients,
    outbox: outbox.map(item => ({ ...item, payload: { message: normalizePayload(item.payload).message } })),
    summary: { pendingCount, sentCount, failedCount },
  })
})

whatsappRouter.post('/recipients', async (req, res) => {
  if (!canManageWhatsapp(req.user!)) return res.status(403).json({ message: 'WhatsApp bot management requires admin access' })
  const scope = whatsappScope(req.user!)
  const body = recipientSchema.parse(req.body)
  if (body.role === PHYSICIAN_ROLE && !scope.global) return res.status(403).json({ message: 'Only Superadmin can configure referring physicians' })
  if (body.clientId && !(await prisma.client.findUnique({ where: { id: body.clientId }, select: { id: true } }))) return res.status(400).json({ message: 'Center was not found' })
  const duplicate = await prisma.notificationRecipient.findUnique({ where: { phoneE164: body.phoneE164 }, select: { id: true } })
  if (duplicate) return res.status(409).json({ message: 'This WhatsApp number is already on the whitelist.' })
  if (body.userId && !(await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } }))) return res.status(400).json({ message: 'The assigned user ID was not found.' })
  const recipient = await prisma.notificationRecipient.create({
    data: {
      name: body.name,
      role: body.role,
      organization: scope.global ? body.organization ?? 'DECTROCEL' : scope.organization,
      clientId: body.clientId || null,
      userId: body.userId || null,
      phoneE164: body.phoneE164,
      notificationCategories: body.notificationCategories,
      active: body.active,
      consentStatus: body.consentStatus,
      consentAt: new Date(),
      consentSource: body.consentSource,
      consentText: body.role === PHYSICIAN_ROLE ? 'Agreed to receive referred-study report links and call-request updates on WhatsApp, with opt-out available.' : whatsappConsentText(),
      optOutAt: null,
      verificationStatus: body.verificationStatus,
      verifiedAt: body.verificationStatus === 'VERIFIED' ? new Date() : null,
      accessCategories: body.accessCategories,
    },
  })
  await prisma.auditLog.create({
    data: { actorUserId: req.user!.sub, action: 'WHATSAPP_RECIPIENT_CREATED', metadata: { recipientId: recipient.id, organization: recipient.organization, phoneE164: recipient.phoneE164 } },
  })
  res.status(201).json(recipient)
})

whatsappRouter.patch('/recipients/:recipientId', async (req, res) => {
  if (!canManageWhatsapp(req.user!)) return res.status(403).json({ message: 'WhatsApp bot management requires admin access' })
  const scope = whatsappScope(req.user!)
  const existing = await prisma.notificationRecipient.findFirst({ where: { id: String(req.params.recipientId), ...recipientScopeWhere(scope) } })
  if (!existing) return res.status(404).json({ message: 'Recipient not found' })
  const body = recipientSchema.partial().parse(req.body)
  if ((existing.role === PHYSICIAN_ROLE || body.role === PHYSICIAN_ROLE) && !scope.global) return res.status(403).json({ message: 'Only Superadmin can configure referring physicians' })
  const updated = await prisma.notificationRecipient.update({
    where: { id: existing.id },
    data: {
      name: body.name,
      role: body.role,
      organization: scope.global ? body.organization : undefined,
      clientId: body.clientId === undefined ? undefined : body.clientId || null,
      userId: body.userId === undefined ? undefined : body.userId || null,
      phoneE164: body.phoneE164,
      notificationCategories: body.notificationCategories,
      active: body.active,
      consentStatus: body.consentStatus,
      consentAt: body.consentConfirmed ? existing.consentAt ?? new Date() : undefined,
      consentSource: body.consentSource,
      consentText: body.consentConfirmed ? (body.role ?? existing.role) === PHYSICIAN_ROLE ? 'Agreed to receive referred-study report links and call-request updates on WhatsApp, with opt-out available.' : whatsappConsentText() : undefined,
      optOutAt: body.consentStatus === 'OPTED_OUT' ? new Date() : body.consentStatus ? null : undefined,
      verificationStatus: body.verificationStatus,
      verifiedAt: body.verificationStatus === undefined ? undefined : body.verificationStatus === 'VERIFIED' ? existing.verifiedAt ?? new Date() : null,
      accessCategories: body.accessCategories,
    },
  })
  await prisma.auditLog.create({
    data: { actorUserId: req.user!.sub, action: 'WHATSAPP_RECIPIENT_UPDATED', metadata: { recipientId: updated.id, organization: updated.organization } },
  })
  res.json(updated)
})

whatsappRouter.post('/outbox/process', async (req, res) => {
  if (!canManageWhatsapp(req.user!)) return res.status(403).json({ message: 'WhatsApp bot management requires admin access' })
  await processWhatsappOutbox()
  res.json({ processed: true })
})

whatsappRouter.patch('/physician-calls/:id', async (req, res) => {
  if (req.user!.role !== 'SUPER_ADMIN') return res.status(403).json({ message: 'Superadmin access required' })
  const body = z.object({ status: z.enum(['PENDING', 'COMPLETED']) }).parse(req.body)
  const result = await prisma.notificationEvent.updateMany({ where: { id: String(req.params.id), eventType: PHYSICIAN_CALL_REQUESTED }, data: { status: body.status } })
  if (!result.count) return res.status(404).json({ message: 'Call request not found' })
  res.json({ updated: true })
})

whatsappRouter.delete('/recipients/:recipientId', async (req, res) => {
  if (!canManageWhatsapp(req.user!)) return res.status(403).json({ message: 'WhatsApp whitelist management requires admin access' })
  const scope = whatsappScope(req.user!)
  const existing = await prisma.notificationRecipient.findFirst({ where: { id: String(req.params.recipientId), ...recipientScopeWhere(scope) } })
  if (!existing) return res.status(404).json({ message: 'Whitelist entry not found' })
  await prisma.notificationRecipient.delete({ where: { id: existing.id } })
  await prisma.auditLog.create({ data: { actorUserId: req.user!.sub, action: 'WHATSAPP_WHITELIST_REMOVED', metadata: { recipientId: existing.id, organization: existing.organization } } })
  res.status(204).send()
})

export async function enqueueStudyStatusNotification(db: DbClient, input: {
  eventType: string
  clientId: string
  reportId?: string | null
  processingJobId?: string | null
  status: string
  patientName?: string | null
  patientId?: string | null
  accession?: string | null
  modality?: string | null
  serviceName?: string | null
  radiologistName?: string | null
  error?: string | null
  idempotencyKey: string
}) {
  const features = getDeploymentFeatures()
  if (!features.notifications && !features.whatsapp) return
  await enqueueNotification(db, {
    eventType: input.eventType,
    aggregateType: input.reportId ? 'ReportReview' : 'ProcessingJob',
    aggregateId: input.reportId ?? input.processingJobId ?? input.idempotencyKey,
    idempotencyKey: input.idempotencyKey,
    payload: {
      category: 'STUDY_STATUS',
      clientId: input.clientId,
      reportId: input.reportId,
      processingJobId: input.processingJobId,
      message: 'A workflow status changed. Sign in to the secure Dectrocel portal to view the details. Do not share patient information on WhatsApp.',
      metadata: { eventType: input.eventType, status: input.status, category: 'STUDY_STATUS' },
    },
  })
  await createDomainNotification(db, {
    eventType: input.eventType,
    aggregateType: input.reportId ? 'ReportReview' : 'ProcessingJob',
    aggregateId: input.reportId ?? input.processingJobId ?? input.idempotencyKey,
    idempotencyKey: `domain:${input.idempotencyKey}`,
    clientId: input.clientId,
    patientRef: input.patientId,
    stage: input.status,
    status: input.status,
    title: 'Study processing update',
    message: `Study ${input.processingJobId ?? input.reportId ?? 'reference'}: ${humanStatus(input.status)}${input.error ? `. ${input.error}` : ''}`,
    category: 'STUDY_STATUS',
    organizations: ['DECTROCEL', 'RENEWIST'],
    metadata: { reportId: input.reportId, processingJobId: input.processingJobId, modality: input.modality, serviceName: input.serviceName, error: input.error },
  })
}

export async function enqueueCallBookingNotification(db: DbClient, input: {
  eventType: string
  bookingId: string
  clientId: string
  reportId: string
  radiologistId?: string | null
  status: string
  slotStart: Date
  slotEnd: Date
  meetingUrl: string
  communicationMode: string
  phoneNumber?: string | null
  idempotencyKey: string
}) {
  const features = getDeploymentFeatures()
  if (!features.notifications && !features.whatsapp) return
  const radiologistPhones = input.radiologistId ? await radiologistPhoneRecipients(db, input.radiologistId) : []
  const administrators = await db.notificationRecipient.findMany({ where: { active: true, organization: 'DECTROCEL', role: { not: PHYSICIAN_ROLE }, verificationStatus: 'VERIFIED', consentStatus: { in: ['OPTED_IN', 'APPROVED', 'ACTIVE'] }, OR: [{ notificationCategories: { has: 'ALL' } }, { notificationCategories: { has: 'CALL_BOOKING' } }] }, select: { phoneE164: true } })
  const recipients = [...radiologistPhones, ...administrators.flatMap(person => person.phoneE164 ? [person.phoneE164] : [])]
  const when = formatIndiaDateTime(input.slotStart)
  const contact = input.communicationMode === 'PHONE_CALL' ? 'Phone call: ' + input.phoneNumber : 'Screen call: ' + input.meetingUrl
  const radiologist = input.radiologistId ? await db.radiologistProfile.findUnique({ where: { id: input.radiologistId }, select: { userId: true } }) : null
  await enqueueNotification(db, {
    eventType: input.eventType,
    aggregateType: 'ReportCallBooking',
    aggregateId: input.bookingId,
    idempotencyKey: input.idempotencyKey,
    payload: {
      category: 'CALL_BOOKING',
      clientId: input.clientId,
      reportId: input.reportId,
      bookingId: input.bookingId,
      to: recipients,
      message: `Consultation requested for ${when}. ${contact}. Confirm the preferred window in the portal.`,
      metadata: { eventType: input.eventType, status: input.status, category: 'CALL_BOOKING' },
    },
  })
  await createDomainNotification(db, {
    eventType: input.eventType,
    aggregateType: 'ReportCallBooking',
    aggregateId: input.bookingId,
    idempotencyKey: `domain:${input.idempotencyKey}`,
    clientId: input.clientId,
    status: input.status,
    title: `Radiologist call ${humanStatus(input.status)}`,
    message: `Call request: ${humanStatus(input.status)} at ${when}. ${contact}`,
    category: 'CALL_BOOKING',
    organizations: ['DECTROCEL'],
    recipientUserIds: radiologist?.userId ? [radiologist.userId] : [],
    metadata: { phoneNumber: input.phoneNumber, meetingUrl: input.meetingUrl, bookingId: input.bookingId, reportId: input.reportId, slotStart: input.slotStart.toISOString(), communicationMode: input.communicationMode },
  })
}

export async function processWhatsappOutbox(limit = 25) {
  if (!getDeploymentFeatures().whatsapp) return
  if (outboxWorkerRunning) return
  outboxWorkerRunning = true
  try {
    if (physicianWhatsappReady()) await enqueuePhysicianReports(prisma)
    const due = await prisma.notificationOutbox.findMany({
      where: { eventType: { notIn: ['TELEGRAM_STUDY_PROCESSING', 'TELEGRAM_TAT_ALERT'] }, status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })
    for (const item of due) {
      try {
        if (item.eventType === PHYSICIAN_REPORT_READY) {
          // Never route a patient-specific link through the general recipient resolver.
          if (!physicianWhatsappReady()) continue
          const delivery = await physicianDelivery(prisma, item.payload)
          if (!delivery) {
            await prisma.notificationOutbox.update({ where: { id: item.id }, data: { status: 'DEAD' } })
            continue
          }
          await sendWhatsappPayload(delivery.recipient.phoneE164!, reportReadyTemplate(delivery.recipient.phoneE164!, delivery.url, item.id,
            process.env.WHATSAPP_REPORT_READY_TEMPLATE_NAME!.trim(), process.env.WHATSAPP_REPORT_READY_TEMPLATE_LANGUAGE?.trim() || 'en'))
          await prisma.notificationOutbox.update({ where: { id: item.id }, data: { status: 'SENT', attempts: { increment: 1 }, processedAt: new Date() } })
          await prisma.notificationRecipient.update({ where: { id: delivery.recipient.id }, data: { lastNotificationAt: new Date() } })
          continue
        }
        const payload = normalizePayload(item.payload)
        const recipients = await resolveRecipients(payload)
        if (!recipients.length) {
          await markOutboxFailed(item.id, item.attempts, 'No WhatsApp recipients configured for this notification')
          continue
        }
        if (process.env.WHATSAPP_CLOUD_API_ENABLED !== 'true') {
          console.log(`[WhatsApp demo] ${item.eventType} -> ${recipients.join(', ')}\n${payload.message}`)
          await prisma.notificationOutbox.update({
            where: { id: item.id },
            data: { status: 'SENT', attempts: { increment: 1 }, processedAt: new Date(), payload: toPrismaJsonObject({ ...payload, demo: true, recipients }) },
          })
          continue
        }
        if (!whatsappOutboundReady()) throw new Error('Proactive WhatsApp delivery is disabled until the app secret and approved utility template are configured')
        await Promise.all(recipients.map((phone) => sendWhatsappUtilityTemplate(phone)))
        await prisma.notificationOutbox.update({
          where: { id: item.id },
          data: { status: 'SENT', attempts: { increment: 1 }, processedAt: new Date(), payload: toPrismaJsonObject({ ...payload, recipients }) },
        })
        if (payload.notificationEventId) {
          await prisma.notificationDelivery.updateMany({
            where: { eventId: payload.notificationEventId, channel: 'WHATSAPP', recipientKey: { in: recipients.map((phone) => `phone:${phone}`) } },
            data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } },
          })
          await prisma.notificationRecipient.updateMany({ where: { phoneE164: { in: recipients } }, data: { lastNotificationAt: new Date() } })
        }
      } catch (error) {
        await markOutboxFailed(item.id, item.attempts, error instanceof Error ? error.message : 'WhatsApp send failed')
      }
    }
  } finally {
    outboxWorkerRunning = false
  }
}

export function startWhatsappOutboxWorker() {
  if (!getDeploymentFeatures().whatsapp) return
  void processWhatsappOutbox()
  const interval = Number(process.env.WHATSAPP_OUTBOX_INTERVAL_MS ?? 15000)
  setInterval(() => void processWhatsappOutbox(), Number.isFinite(interval) && interval >= 5000 ? interval : 15000).unref()
}

async function enqueueNotification(db: DbClient, input: {
  eventType: string
  aggregateType: string
  aggregateId: string
  idempotencyKey: string
  payload: NotificationPayload
}) {
  await db.notificationOutbox.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: toPrismaJsonObject(input.payload),
      status: 'PENDING',
      nextAttemptAt: new Date(),
    },
    create: {
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: toPrismaJsonObject(input.payload),
      idempotencyKey: input.idempotencyKey,
    },
  })
}

async function handleIncomingWhatsapp(body: unknown) {
  for (const delivery of extractDeliveryStatuses(body)) {
    await prisma.auditLog.create({
      data: {
        action: `WHATSAPP_MESSAGE_${delivery.status.toUpperCase()}`,
        metadata: toPrismaJsonObject({ messageId: delivery.id, contact: delivery.recipient.slice(-4), status: delivery.status, errors: delivery.errors }),
      },
    })
  }
  const messages = extractIncomingMessages(body)
  for (const message of messages) {
    if (message.id && processedIncomingMessages.has(message.id)) continue
    const reply = await handleBotText(message.from, message.text)
    if (reply) {
      try {
        await sendOrDemoReply(message.from, reply)
        await prisma.auditLog.create({
          data: {
            action: 'WHATSAPP_BOT_REPLY_SENT',
            metadata: { messageId: message.id ?? null, contact: message.from.slice(-4), replyType: reply.kind },
          },
        })
      } catch (error) {
        await prisma.auditLog.create({
          data: {
            action: 'WHATSAPP_BOT_REPLY_FAILED',
            metadata: { messageId: message.id ?? null, contact: message.from.slice(-4), replyType: reply.kind, error: error instanceof Error ? error.message : 'Unknown send error' },
          },
        })
        throw error
      }
    }
    if (message.id) processedIncomingMessages.set(message.id, Date.now())
  }
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const [id, receivedAt] of processedIncomingMessages) if (receivedAt < cutoff) processedIncomingMessages.delete(id)
  for (const [phone, flow] of botFlows) if (flow.updatedAt < cutoff) botFlows.delete(phone)
}

function extractDeliveryStatuses(body: unknown) {
  const statuses: Array<{ id: string; recipient: string; status: string; errors: unknown[] }> = []
  const entries = (body as { entry?: unknown[] })?.entry ?? []
  for (const entry of entries) {
    for (const change of (entry as { changes?: unknown[] }).changes ?? []) {
      const value = (change as { value?: { statuses?: unknown[] } }).value
      for (const raw of value?.statuses ?? []) {
        const item = raw as { id?: string; recipient_id?: string; status?: string; errors?: unknown[] }
        if (item.id && item.status) statuses.push({ id: item.id, recipient: item.recipient_id ?? '', status: item.status, errors: item.errors ?? [] })
      }
    }
  }
  return statuses
}

async function handleBotText(from: string, text: string): Promise<BotReply> {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (normalized.startsWith('physician_call:')) {
    const accepted = await requestPhysicianCall(prisma, normalizeIncomingPhone(from), normalized.slice('physician_call:'.length))
    return textReply(accepted ? 'Your call request has been sent to Superadmin and the assigned radiologist. The team will contact you.' : 'This call request is unavailable. Please contact the hospital.')
  }
  if (/^(?:stop|unsubscribe|opt\s*out|cancel\s+messages)$/i.test(normalized)) {
    botFlows.delete(from)
    await prisma.notificationRecipient.updateMany({
      where: { phoneE164: normalizeIncomingPhone(from) },
      data: { active: false, consentStatus: 'OPTED_OUT', optOutAt: new Date() },
    })
    return textReply('You have been unsubscribed from proactive WhatsApp messages. You can still contact Dectrocel here for assistance. Do not send patient or clinical information in this chat.')
  }
  if (/^(?:hi|hello|hey|hii+|hlo|namaste|good\s+(?:morning|afternoon|evening)|start)(?:[!.\s].*)?$/i.test(normalized)) {
    botFlows.delete(from)
    return { kind: 'support_menu' }
  }
  if (/^(?:menu|help|support|back|cancel)$/i.test(normalized)) {
    botFlows.delete(from)
    return { kind: 'support_menu' }
  }

  const managementReply = await handleManagementQuestion(from, normalized)
  if (managementReply) return managementReply

  if (normalized === 'support_technical') {
    botFlows.set(from, { step: 'TECHNICAL_DESCRIPTION', data: {}, updatedAt: Date.now() })
    return textReply('Please describe the technical issue, including the screen or feature affected and any non-clinical error message. Do not send patient names, IDs, images, reports, or clinical information.')
  }
  if (normalized === 'support_reporting') {
    botFlows.set(from, { step: 'REPORTING_DESCRIPTION', data: {}, updatedAt: Date.now() })
    return textReply('Please describe the workflow issue without including a patient name, patient ID, study/report ID, image, report content, diagnosis, or clinical information. Our team will use the secure portal for case details.')
  }
  if (normalized === 'product_query') {
    botFlows.set(from, { step: 'PRODUCT_QUERY', data: {}, updatedAt: Date.now() })
    return textReply('What would you like to know about our radiology, PACS, AI-assisted reporting, or teleradiology products?')
  }
  if (normalized === 'request_demo') {
    botFlows.set(from, { step: 'DEMO_NAME', data: {}, updatedAt: Date.now() })
    return textReply('Great! Let us arrange a product demo. What is your full name?')
  }
  if (normalized === 'speak_to_person') {
    botFlows.set(from, { step: 'HUMAN_DESCRIPTION', data: {}, updatedAt: Date.now() })
    return textReply('Please briefly describe how our team can help. Do not include patient names, IDs, images, reports, or other clinical information. A team member will follow up.')
  }

  const flow = botFlows.get(from)
  if (flow) return handleGuidedFlow(from, normalized, flow)

  return { kind: 'support_menu' }
}

async function handleManagementQuestion(from: string, question: string): Promise<BotReply | null> {
  if (!/(?:stud(?:y|ies)|ct|processing|report|billing|revenue|center|volume|turnaround|tat|completion|failed)/i.test(question)) return null
  const recipient = await prisma.notificationRecipient.findUnique({ where: { phoneE164: normalizeIncomingPhone(from) }, include: { user: true, client: true } })
  const allowed = recipient?.active && recipient.verificationStatus === 'VERIFIED'
    && ['OPTED_IN', 'APPROVED', 'ACTIVE'].includes(recipient.consentStatus)
    && (recipient.accessCategories.includes('ALL') || recipient.accessCategories.includes('MANAGEMENT_BOT'))
    && (recipient.role === 'MARENGO_MANAGEMENT' || recipient.organization === 'MARENGO_MANAGEMENT')
  if (!allowed) return textReply('Management statistics are available only to verified, authorised WhatsApp numbers. Please contact your portal administrator.')
  const rootClientId = recipient.clientId ?? recipient.user?.clientId
  if (!rootClientId) return textReply('Your WhatsApp access is verified, but no authorised organisation is assigned. Please contact your portal administrator.')
  const root = await prisma.client.findUnique({ where: { id: rootClientId }, select: { id: true, kind: true, childClients: { select: { id: true } } } })
  if (!root) return textReply('The assigned organisation is not available.')
  const clientIds = root.kind === 'GROUP' ? [root.id, ...root.childClients.map((item) => item.id)] : [root.id]
  const now = new Date()
  const start = /today/i.test(question) ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    : /last\s+30\s+days/i.test(question) ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const scope = { clientIds, start, end: new Date(now.getTime() + 1), modality: /\bct\b/i.test(question) ? 'CT' : undefined }
  let response: string
  if (/billing|revenue/i.test(question)) {
    if (!recipient.accessCategories.includes('ALL') && !recipient.accessCategories.includes('BILLING')) return textReply('Billing access is not enabled for this WhatsApp number.')
    if (/center/i.test(question)) {
      const rows = await getCenterStatistics(prisma, scope)
      response = rows.map((row) => `${row.client.name}: ${formatCurrency(row.billing.amountMinor, row.billing.currency)}`).join('\n') || 'No billing data is available.'
    } else {
      const data = await getBillingStatistics(prisma, scope)
      response = `Overall billing: ${formatCurrency(data.amountMinor, data.currency)}\nTransactions: ${data.transactionCount}\nUnits: ${data.units}`
    }
  } else if (/report|turnaround|\btat\b/i.test(question)) {
    const data = await getReportingStatistics(prisma, scope)
    response = `Reports generated: ${data.generated}\nCompleted: ${data.completed}\nPending: ${data.pending}\nAverage reporting TAT: ${data.averageReportingTatMinutes ?? 'not available'} minutes`
  } else if (/center/i.test(question)) {
    const rows = await getCenterStatistics(prisma, scope)
    response = rows.map((row) => `${row.client.name}: ${row.usage.totalStudies} studies (${row.usage.completed} completed, ${row.usage.failed} failed)`).join('\n') || 'No study data is available.'
  } else {
    const data = await getStudyUsageStatistics(prisma, scope)
    response = `Studies processed: ${data.totalStudies}\nCompleted: ${data.completed}\nFailed: ${data.failed}\nCompletion rate: ${data.completionRate}%\nAverage processing time: ${data.averageProcessingMinutes ?? 'not available'} minutes`
  }
  await prisma.auditLog.create({ data: { actorUserId: recipient.userId, clientId: root.id, action: 'WHATSAPP_MANAGEMENT_STATISTICS_ACCESSED', metadata: { recipientId: recipient.id, start: start.toISOString(), end: now.toISOString(), modality: scope.modality ?? null } } })
  return textReply(`Authorised statistics for ${start.toISOString().slice(0, 10)} to ${now.toISOString().slice(0, 10)}${scope.modality ? ` (${scope.modality})` : ''}:\n\n${response}`)
}

function formatCurrency(amountMinor: number, currency: string) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amountMinor / 100)
}

function textReply(body: string): BotReply {
  return { kind: 'text', body }
}

async function handleGuidedFlow(from: string, answer: string, flow: BotFlow): Promise<BotReply> {
  flow.updatedAt = Date.now()
  if (flow.step === 'DEMO_NAME') {
    if (answer.length < 2) return textReply('Please enter your full name.')
    flow.data.name = answer
    flow.step = 'DEMO_EMAIL'
    return textReply('What is your business email address?')
  }
  if (flow.step === 'DEMO_EMAIL') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer)) return textReply('Please enter a valid email address, for example name@organisation.com.')
    flow.data.email = answer.toLowerCase()
    flow.step = 'DEMO_ORGANIZATION'
    return textReply('What is your organisation name?')
  }
  if (flow.step === 'DEMO_ORGANIZATION') {
    if (answer.length < 2) return textReply('Please enter your organisation name.')
    flow.data.organization = answer
    flow.step = 'DEMO_PURPOSE'
    return textReply('Please tell us the purpose of the demo and which solution you are interested in.')
  }
  if (flow.step === 'DEMO_PURPOSE') {
    if (answer.length < 5) return textReply('Please provide a little more detail about your requirements.')
    flow.data.purpose = answer
    const requestNumber = `DEMO-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    const demo = await prisma.demoRequest.create({ data: { requestNumber, name: flow.data.name, email: flow.data.email, organization: flow.data.organization, phone: normalizeIncomingPhone(from), source: 'WHATSAPP', purpose: flow.data.purpose } })
    await createDomainNotification(prisma, { eventType: 'DEMO_REQUEST_CREATED', aggregateType: 'DemoRequest', aggregateId: demo.id, idempotencyKey: `demo:${demo.id}:created`, status: demo.status, title: 'New demo request', message: `New demo request from ${demo.organization}. Reference: ${demo.requestNumber}`, category: 'DEMO_REQUEST', organizations: ['DECTROCEL'], metadata: { demoRequestId: demo.id, requestNumber: demo.requestNumber, source: demo.source } })
    await prisma.auditLog.create({ data: { action: 'DEMO_REQUEST_CREATED', metadata: { demoRequestId: demo.id, requestNumber: demo.requestNumber, source: 'WHATSAPP' } } })
    botFlows.delete(from)
    return textReply(`Thank you, ${flow.data.name}. Your demo request has been received. Reference: ${requestNumber}. Our team will contact you shortly. Send “menu” for anything else.`)
  }

  const category = flow.step === 'TECHNICAL_DESCRIPTION' ? 'TECHNICAL_ISSUE' : flow.step === 'REPORTING_DESCRIPTION' ? 'REPORTING_ISSUE' : flow.step === 'HUMAN_DESCRIPTION' ? 'HUMAN_ASSISTANCE' : 'PRODUCT_QUERY'
  if (answer.length < 5) return textReply('Please describe your request in a little more detail.')
  const subject = category === 'TECHNICAL_ISSUE' ? 'WhatsApp technical support request' : category === 'REPORTING_ISSUE' ? 'WhatsApp reporting support request' : category === 'HUMAN_ASSISTANCE' ? 'WhatsApp human assistance request' : 'WhatsApp product enquiry'
  const ticketNumber = await createWhatsappTicket(from, category, subject, answer)
  botFlows.delete(from)
  return textReply(`Thank you. Your request has been recorded as ${ticketNumber}. Our support team will review it. Send “menu” to return to the support options.`)
}

async function createWhatsappTicket(from: string, category: string, subject: string, description: string) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  let ticketNumber = ''
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `WA-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    if (!(await prisma.supportTicket.findUnique({ where: { ticketNumber: candidate }, select: { id: true } }))) {
      ticketNumber = candidate
      break
    }
  }
  if (!ticketNumber) ticketNumber = `WA-${stamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  await prisma.supportTicket.create({
    data: {
      ticketNumber,
      category,
      priority: 'MEDIUM',
      subject,
      description: `${description}\n\nWhatsApp: ${normalizeIncomingPhone(from)}`,
      assignedTeam: 'DECTROCEL',
      whatsappDemo: false,
      messages: { create: { authorRole: 'WHATSAPP_CONTACT', channel: 'WHATSAPP', body: description, whatsappDemo: false } },
    },
  })
  await createDomainNotification(prisma, { eventType: 'QUERY_CREATED', aggregateType: 'SupportTicket', aggregateId: ticketNumber, idempotencyKey: `query:${ticketNumber}:created`, status: 'NEW', title: 'New query received', message: `${subject}. Reference: ${ticketNumber}`, category: 'QUERY', organizations: ['DECTROCEL'], metadata: { ticketNumber, category, source: 'WHATSAPP' } })
  return ticketNumber
}

function extractIncomingMessages(body: unknown) {
  const messages: Array<{ id?: string; from: string; text: string }> = []
  const entries = (body as { entry?: unknown[] })?.entry ?? []
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes ?? []
    for (const change of changes) {
      const value = (change as { value?: { messages?: unknown[] } }).value
      for (const item of value?.messages ?? []) {
        const message = item as { id?: string; from?: string; text?: { body?: string }; interactive?: { button_reply?: { id?: string }; list_reply?: { id?: string } }; button?: { payload?: string } }
        const text = message.text?.body || message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || message.button?.payload
        if (message.from && text) messages.push({ id: message.id, from: message.from, text })
      }
    }
  }
  return messages
}

function canManageWhatsapp(user: { role: string; providerCode?: string | null }) {
  return user.role === 'SUPER_ADMIN' || ['PROVIDER_ADMIN', 'PROVIDER_MANAGER'].includes(user.role) && Boolean(user.providerCode)
}

function whatsappScope(user: { role: string; providerCode?: string | null }) {
  return user.role === 'SUPER_ADMIN'
    ? { organization: 'DECTROCEL', global: true }
    : { organization: user.providerCode ?? 'RENEWIST', global: false }
}

function recipientScopeWhere(scope: { organization: string; global: boolean }) {
  return scope.global ? {} : { organization: scope.organization }
}

function publicBaseUrl() {
  const baseUrl = process.env.WHATSAPP_CALLBACK_BASE_URL
    || process.env.TELERADIOLOGY_CALLBACK_BASE_URL
    || localApiBaseUrl(process.env.PORTAL_BASE_URL)
    || process.env.PORTAL_BASE_URL
    || `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 4000}`
  return baseUrl.replace(/\/+$/g, '')
}

function whatsappWebhookVerifyToken() {
  return process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || ''
}

function whatsappUtilityTemplateName() {
  return process.env.WHATSAPP_UTILITY_TEMPLATE_NAME?.trim() || ''
}

function whatsappOutboundReady() {
  return process.env.WHATSAPP_CLOUD_API_ENABLED === 'true'
    && Boolean(process.env.WHATSAPP_CLOUD_API_TOKEN?.trim())
    && Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID?.trim())
    && Boolean(process.env.WHATSAPP_APP_SECRET?.trim())
    && Boolean(whatsappUtilityTemplateName())
}

function whatsappConsentText() {
  return 'I agree to receive the selected non-clinical Dectrocel WhatsApp notifications. I can opt out at any time. Patient and clinical information must remain in the secure portal.'
}

function verifyWhatsappWebhookSignature(req: express.Request) {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim()
  if (!secret) return process.env.WHATSAPP_CLOUD_API_ENABLED !== 'true'
  const signature = req.header('x-hub-signature-256') ?? ''
  const body = (req as express.Request & { rawBody?: Buffer }).rawBody
  if (!body || !signature.startsWith('sha256=')) return false
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`
  const actual = Buffer.from(signature)
  const wanted = Buffer.from(expected)
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted)
}

function localApiBaseUrl(value?: string) {
  if (!value) return ''
  try {
    const url = new URL(value)
    if (['localhost', '127.0.0.1'].includes(url.hostname) && ['5173', '5174'].includes(url.port)) {
      url.port = String(process.env.PORT ?? 4000)
      return url.toString()
    }
  } catch {
    return ''
  }
  return ''
}

async function resolveRecipients(payload: NotificationPayload) {
  const requested = uniquePhones([
    ...normalizePhones(payload.to ?? []),
    ...normalizePhones((process.env.WHATSAPP_NOTIFICATION_RECIPIENTS ?? '').split(',')),
  ])
  const dbRecipients = await prisma.notificationRecipient.findMany({
    where: {
      active: true,
      role: { not: PHYSICIAN_ROLE },
      verificationStatus: 'VERIFIED',
      consentStatus: { in: ['OPTED_IN', 'APPROVED', 'ACTIVE'] },
      phoneE164: { not: null, ...(requested.length ? { in: requested } : {}) },
      OR: [
        { notificationCategories: { has: payload.category } },
        { notificationCategories: { has: 'ALL' } },
        payload.category === 'STUDY_STATUS' ? { notificationCategories: { has: 'INTERNAL_TEAM' } } : {},
      ],
    },
  })
  return uniquePhones(dbRecipients.map((item) => item.phoneE164 ?? ''))
}

async function radiologistPhoneRecipients(db: DbClient, radiologistId: string) {
  const radiologist = await db.radiologistProfile.findUnique({ where: { id: radiologistId }, select: { phone: true } })
  return normalizePhones(radiologist?.phone ? [radiologist.phone] : [])
}

async function sendOrDemoReply(to: string, reply: BotReply) {
  const phone = normalizeIncomingPhone(to)
  if (process.env.WHATSAPP_CLOUD_API_ENABLED !== 'true') {
    console.log(`[WhatsApp demo reply] ${phone}: ${reply.kind}`)
    return
  }
  if (reply.kind === 'support_menu') await sendWhatsappSupportMenu(phone)
  else await sendWhatsappText(phone, reply.body)
}

async function sendWhatsappSupportMenu(to: string) {
  await sendWhatsappPayload(to, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/^\+/, ''),
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Dectrocel Assistant' },
      body: {
        text: [
          'Hello and welcome to Dectrocel! 👋',
          '',
          'We provide intelligent radiology solutions designed to make diagnostic workflows faster, connected and more efficient.',
          '',
          'You can explore our Radiology AI, PACS and teleradiology solutions, request a personalised product demonstration, ask questions about our products, or get assistance with technical and reporting matters.',
          '',
          'How may we assist you today?',
          '',
          'For privacy, do not send patient names, IDs, images, reports, or clinical information here.',
        ].join('\n'),
      },
      footer: { text: 'Smarter imaging. Connected care.' },
      action: {
        button: 'View options',
        sections: [{
          title: 'How can we help?',
          rows: [
            { id: 'request_demo', title: 'Request demo', description: 'Arrange a personalised product demo' },
            { id: 'product_query', title: 'Explore our products', description: 'Radiology AI, PACS and teleradiology' },
            { id: 'support_technical', title: 'Technical assistance', description: 'Portal, viewer, upload, or access help' },
            { id: 'support_reporting', title: 'Reporting assistance', description: 'Study or radiology report help' },
            { id: 'speak_to_person', title: 'Speak to our team', description: 'Request help from a person' },
          ],
        }],
      },
    },
  })
}

async function sendWhatsappText(to: string, body: string) {
  await sendWhatsappPayload(to, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/^\+/, ''),
    type: 'text',
    text: { preview_url: false, body },
  })
}

async function sendWhatsappUtilityTemplate(to: string) {
  await sendWhatsappPayload(to, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: whatsappUtilityTemplateName(),
      language: { code: process.env.WHATSAPP_UTILITY_TEMPLATE_LANGUAGE?.trim() || 'en' },
    },
  })
}

async function sendWhatsappPayload(to: string, payload: Record<string, unknown>) {
  const token = process.env.WHATSAPP_CLOUD_API_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) throw new Error('WhatsApp Cloud API token or phone number ID is missing')
  const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`WhatsApp Cloud API failed (${response.status}): ${await response.text()}`)
}

async function markOutboxFailed(id: string, attempts: number, error: string) {
  const nextAttemptAt = new Date(Date.now() + Math.min(60, 2 ** Math.min(attempts, 6)) * 60 * 1000)
  await prisma.notificationOutbox.update({
    where: { id },
    data: { status: attempts + 1 >= 5 ? 'DEAD' : 'FAILED', attempts: { increment: 1 }, nextAttemptAt },
  })
  console.warn(`WhatsApp outbox ${id} failed: ${error}`)
}

function normalizePayload(value: Prisma.JsonValue): NotificationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid notification payload')
  const object = value as Record<string, unknown>
  return {
    category: String(object.category ?? 'GENERAL'),
    message: String(object.message ?? ''),
    clientId: typeof object.clientId === 'string' ? object.clientId : null,
    reportId: typeof object.reportId === 'string' ? object.reportId : null,
    processingJobId: typeof object.processingJobId === 'string' ? object.processingJobId : null,
    bookingId: typeof object.bookingId === 'string' ? object.bookingId : null,
    notificationEventId: typeof object.notificationEventId === 'string' ? object.notificationEventId : null,
    to: Array.isArray(object.to) ? object.to.map(String) : [],
    metadata: object.metadata && typeof object.metadata === 'object' && !Array.isArray(object.metadata) ? object.metadata as Record<string, unknown> : {},
  }
}

function toPrismaJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return {}
  const normalized = JSON.parse(serialized) as unknown
  return normalized && typeof normalized === 'object' && !Array.isArray(normalized)
    ? normalized as Prisma.InputJsonObject
    : {}
}

function normalizePhones(values: string[]) {
  return values.map((value) => normalizeIncomingPhone(value)).filter((value) => phoneSchema.safeParse(value).success)
}

function uniquePhones(values: string[]) {
  return [...new Set(normalizePhones(values))]
}

function normalizeIncomingPhone(value: string) {
  const trimmed = value.trim()
  if (trimmed.startsWith('+')) return trimmed
  return `+${trimmed.replace(/\D/g, '')}`
}

function parseRequestedSlot(value: string) {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/)
  if (!match) return null
  const [, date, hour, minute] = match
  return new Date(`${date}T${hour}:${minute}:00+05:30`)
}

function formatIndiaDateTime(value: Date) {
  return value.toLocaleString('en-IN', { timeZone: process.env.APP_TIMEZONE ?? 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
}

function humanStatus(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
}
