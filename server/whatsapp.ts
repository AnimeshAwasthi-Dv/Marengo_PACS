import { sendWatiPhysicianReport, watiTemplateApproved, validWatiWebhookSecret } from './wati';
import { handleWatiPhysicianWebhook } from './watiPhysicianWebhook';
import { enqueueTelegramStudy, TELEGRAM_URGENT_EVENT } from './telegram';
import { telegramUrgentConfig } from './telegramPolicy';
import crypto from 'node:crypto'
import { enqueuePhysicianReports, PHYSICIAN_REPORT_READY, PHYSICIAN_CALL_REQUESTED, PHYSICIAN_ROLE, physicianDelivery, physicianWhatsappReady, physicianDeliveryFields, reportReadyTemplate, requestPhysicianCall } from './physicianWhatsapp'
import express from 'express'
import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from './auth'
import { prisma } from './db'
import { getDeploymentFeatures } from './deploymentProfile'
import { createDomainNotification } from './notificationService'

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
type BotReply = { kind: 'text'; body: string }
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

whatsappRouter.post('/wati/webhook', async (req, res) => {
  const supplied = req.header('x-wati-webhook-secret') || req.header('authorization')?.replace(/^Bearer\s+/i, '') || res.locals.watiWebhookSecret;
  if (process.env.WHATSAPP_PROVIDER !== 'wati' || process.env.WATI_ENABLED !== 'true') return res.sendStatus(404);
  if (!validWatiWebhookSecret(supplied)) return res.sendStatus(401);
  try { await handleWatiPhysicianWebhook(prisma, req.body); return res.sendStatus(200); }
  catch { console.warn('WATI callback processing unavailable; delivery will retry.'); return res.sendStatus(503); }
});

whatsappRouter.use(requireAuth)

whatsappRouter.get('/config', async (req, res) => {
  if (!canManageWhatsapp(req.user!)) return res.status(403).json({ message: 'WhatsApp bot management requires admin access' })
  const scope = whatsappScope(req.user!)
  const [recipients, outbox, pendingCount, sentCount, failedCount] = await Promise.all([
    prisma.notificationRecipient.findMany({ where: { ...recipientScopeWhere(scope), role: PHYSICIAN_ROLE }, orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }], take: 100 }),
    prisma.notificationOutbox.findMany({ where: { eventType: PHYSICIAN_REPORT_READY, ...(scope.global ? {} : { id: { in: [] } }) }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.notificationOutbox.count({ where: { eventType: PHYSICIAN_REPORT_READY, status: 'PENDING' } }),
    prisma.notificationOutbox.count({ where: { eventType: PHYSICIAN_REPORT_READY, status: 'SENT' } }),
    prisma.notificationOutbox.count({ where: { eventType: PHYSICIAN_REPORT_READY, status: { in: ['FAILED', 'DEAD'] } } }),
  ])
  res.json({
    physicianReportReady: physicianWhatsappReady() && (process.env.WHATSAPP_PROVIDER !== 'wati' || await watiTemplateApproved()),
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
  if (body.role !== PHYSICIAN_ROLE) return res.status(400).json({ message: 'Only referring physician mappings are supported' })
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
  if (existing.role !== PHYSICIAN_ROLE || (body.role && body.role !== PHYSICIAN_ROLE)) return res.status(400).json({ message: 'Only referring physician mappings are supported' })
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
  const urgentConfig = telegramUrgentConfig();
  if (urgentConfig.enabled && (input.processingJobId || input.reportId)) {
    const mapping = !input.processingJobId && input.reportId ? await db.providerJobMapping.findFirst({ where: { reportReviewId: input.reportId }, select: { processingJobId: true } }) : null;
    const jobId = input.processingJobId ?? mapping?.processingJobId;
    const job = jobId ? await db.processingJob.findUnique({ where: { id: jobId }, select: { id: true, clientId: true, serviceType: true, priority: true, demoMode: true } }) : null;
    if (job?.priority === 'URGENT') await enqueueTelegramStudy(db, job, input.modality ?? undefined, urgentConfig, undefined, TELEGRAM_URGENT_EVENT, input.idempotencyKey);
  }
  const features = getDeploymentFeatures()
  if (!features.notifications) return
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
  if (!features.notifications) return
  const when = formatIndiaDateTime(input.slotStart)
  const contact = input.communicationMode === 'PHONE_CALL' ? 'Phone call: ' + input.phoneNumber : 'Screen call: ' + input.meetingUrl
  const radiologist = input.radiologistId ? await db.radiologistProfile.findUnique({ where: { id: input.radiologistId }, select: { userId: true } }) : null
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
  if (!getDeploymentFeatures().whatsapp || !physicianWhatsappReady()) return
  if (outboxWorkerRunning) return
  outboxWorkerRunning = true
  try {
    if (physicianWhatsappReady()) await enqueuePhysicianReports(prisma)
    const due = await prisma.notificationOutbox.findMany({
      where: { eventType: PHYSICIAN_REPORT_READY, status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })
    if (due.length && process.env.WHATSAPP_PROVIDER === 'wati' && !(await watiTemplateApproved())) return
    for (const item of due) {
      try {
        if (item.eventType === PHYSICIAN_REPORT_READY) {
          // Never route a patient-specific link through the general recipient resolver.
          if (!physicianWhatsappReady()) continue
          const delivery = await physicianDelivery(prisma, item.payload)
          if (!delivery) {
            await prisma.notificationOutbox.update({ where: { id: item.id }, data: { status: 'SKIPPED', processedAt: new Date() } })
            continue
          }
          const fields = await physicianDeliveryFields(prisma, delivery.report);
          let watiIds: string[] = [];
          if (process.env.WHATSAPP_PROVIDER === 'wati') {
            const sent = await sendWatiPhysicianReport(delivery.recipient.phoneE164, fields, delivery.url, item.id);
            if (sent.skipped) {
              await prisma.notificationOutbox.update({ where: { id: item.id }, data: { status: 'SKIPPED', processedAt: new Date() } });
              continue;
            }
            watiIds = sent.messageIds;
          } else {
            await sendWhatsappPayload(delivery.recipient.phoneE164!, reportReadyTemplate(delivery.recipient.phoneE164!, delivery.url, item.id,
              process.env.WHATSAPP_REPORT_READY_TEMPLATE_NAME!.trim(), process.env.WHATSAPP_REPORT_READY_TEMPLATE_LANGUAGE?.trim() || 'en', fields));
          }
          // Merge webhook IDs that may have arrived while WATI accepted the send request.
          const latest = await prisma.notificationOutbox.findUnique({ where: { id: item.id }, select: { payload: true } });
          const payload = (latest?.payload ?? item.payload) as Prisma.InputJsonObject;
          const existingIds = Array.isArray(payload.watiMessageIds) ? payload.watiMessageIds.filter((value): value is string => typeof value === 'string') : [];
          await prisma.notificationOutbox.update({ where: { id: item.id }, data: { status: 'SENT', attempts: { increment: 1 }, processedAt: new Date(), payload: { ...payload,
            ...(process.env.WHATSAPP_PROVIDER === 'wati' ? { provider: 'wati', watiMessageIds: [...new Set([...existingIds, ...watiIds])] } : {}),
          } } });
          await prisma.notificationRecipient.update({ where: { id: delivery.recipient.id }, data: { lastNotificationAt: new Date() } })
          continue
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
  const tick = () => void processWhatsappOutbox().catch(() => console.warn('Physician messaging unavailable; background delivery will retry.'))
  tick()
  const interval = Number(process.env.WHATSAPP_OUTBOX_INTERVAL_MS ?? 15000)
  setInterval(tick, Number.isFinite(interval) && interval >= 5000 ? interval : 15000).unref()
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

async function handleBotText(from: string, text: string): Promise<BotReply | null> {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (normalized.startsWith('physician_call:')) {
    const accepted = await requestPhysicianCall(prisma, normalizeIncomingPhone(from), normalized.slice('physician_call:'.length))
    return textReply(accepted ? 'Your call request has been sent to Superadmin and the assigned radiologist. The team will contact you.' : 'This call request is unavailable. Please contact the hospital.')
  }
  if (/^(?:stop|unsubscribe|opt\s*out|cancel\s+messages)$/i.test(normalized)) {
    await prisma.notificationRecipient.updateMany({
      where: { phoneE164: normalizeIncomingPhone(from) },
      data: { active: false, consentStatus: 'OPTED_OUT', optOutAt: new Date() },
    })
    return textReply('You have been unsubscribed from proactive WhatsApp messages. You can still contact Dectrocel here for assistance. Do not send patient or clinical information in this chat.')
  }
  return null
}

function textReply(body: string): BotReply { return { kind: 'text', body } }

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
  return user.role === 'SUPER_ADMIN'
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

async function sendOrDemoReply(to: string, reply: BotReply) {
  const phone = normalizeIncomingPhone(to)
  if (process.env.WHATSAPP_CLOUD_API_ENABLED !== 'true') {
    console.log(`[WhatsApp demo reply] ${phone}: ${reply.kind}`)
    return
  }
  await sendWhatsappText(phone, reply.body)
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

function normalizeIncomingPhone(value: string) {
  const trimmed = value.trim()
  if (trimmed.startsWith('+')) return trimmed
  return `+${trimmed.replace(/\D/g, '')}`
}

function formatIndiaDateTime(value: Date) {
  return value.toLocaleString('en-IN', { timeZone: process.env.APP_TIMEZONE ?? 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
}

function humanStatus(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
}

function toPrismaJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}
