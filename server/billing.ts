import express from 'express'
import { z } from 'zod'
import { createHmac, randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from './db'
import { requireAuth, requireClientUser, requireSuperAdmin } from './auth'

const sgstRatePercent = Number(process.env.BILLING_SGST_RATE_PERCENT ?? 9)
const cgstRatePercent = Number(process.env.BILLING_CGST_RATE_PERCENT ?? 9)
const paymentLinkExpiryDays = Number(process.env.RAZORPAY_PAYMENT_LINK_EXPIRY_DAYS ?? 15)
const nonBillableSuiteServiceNames = new Set(['X-ray Suite', 'CT Suite', 'MRI Suite'])
const manualBillingServiceNames = new Set(['CT Other', 'MRI Other'])
const manualBillingLabel = 'Will be billed manually'

export const billingRouter = express.Router()
export const clientBillingRouter = express.Router()

export async function handleRazorpayWebhook(req: express.Request, res: express.Response) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) return res.status(503).json({ message: 'Razorpay webhook secret is not configured' })
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}))
  const receivedSignature = String(req.header('x-razorpay-signature') ?? '')
  const expectedSignature = createHmac('sha256', secret).update(rawBody).digest('hex')
  if (!receivedSignature || receivedSignature !== expectedSignature) {
    return res.status(400).json({ message: 'Invalid Razorpay webhook signature' })
  }

  const event = JSON.parse(rawBody.toString('utf8')) as RazorpayWebhookPayload
  const paymentEntity = event.payload?.payment?.entity
  const orderEntity = event.payload?.order?.entity
  const paymentLinkEntity = event.payload?.payment_link?.entity
  const orderId = paymentEntity?.order_id ?? orderEntity?.id
  const providerLinkId = paymentLinkEntity?.id ?? orderId
  const invoiceIdFromNotes = paymentEntity?.notes?.invoiceId ?? orderEntity?.notes?.invoiceId ?? paymentLinkEntity?.notes?.invoiceId
  if (!providerLinkId && !invoiceIdFromNotes) return res.json({ ok: true, ignored: 'missing_payment_reference' })

  const link = await prisma.paymentLink.findFirst({
    where: {
      provider: 'RAZORPAY',
      OR: [
        ...(providerLinkId ? [{ providerLinkId }] : []),
        ...(invoiceIdFromNotes ? [{ invoiceId: invoiceIdFromNotes }] : []),
      ],
    },
    include: { invoice: true },
  })
  if (!link) return res.json({ ok: true, ignored: 'unknown_order' })

  if (event.event === 'order.paid' || event.event === 'payment_link.paid') {
    if (paymentEntity) await recordRazorpayPaymentFromWebhook(link, paymentEntity, event)
    else if (link.providerLinkId) await syncRazorpayPaymentLinkStatus(link.providerLinkId, 'payment_link_webhook')
    else await recordRazorpayPaymentFromWebhook(link, paymentEntity, event)
  } else if (event.event === 'payment.failed') {
    await prisma.paymentLink.update({ where: { id: link.id }, data: { status: 'FAILED' } })
    if (paymentEntity?.id) {
      const existing = await prisma.payment.findFirst({ where: { provider: 'RAZORPAY', providerPaymentId: paymentEntity.id } })
      if (!existing) {
        await prisma.payment.create({
          data: {
            clientId: link.invoice.clientId,
            invoiceId: link.invoiceId,
            provider: 'RAZORPAY',
            providerPaymentId: paymentEntity.id,
            amountMinor: Number(paymentEntity.amount ?? link.amountMinor),
            currency: String(paymentEntity.currency ?? link.currency),
            status: 'FAILED',
            method: String(paymentEntity.method ?? 'RAZORPAY_CHECKOUT'),
            metadata: {
              razorpayOrderId: orderId,
              errorCode: paymentEntity.error_code ?? null,
              errorDescription: paymentEntity.error_description ?? null,
              webhookEventId: event.id ?? null,
            },
          },
        })
      }
    }
  } else {
    return res.json({ ok: true, ignored: event.event })
  }

  await prisma.auditLog.create({
    data: {
      clientId: link.invoice.clientId,
      actorUserId: null,
      action: `RAZORPAY_WEBHOOK_${event.event.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}`,
      metadata: { invoiceId: link.invoiceId, invoiceNumber: link.invoice.invoiceNumber, orderId: orderId ?? null, providerLinkId: link.providerLinkId, paymentId: paymentEntity?.id ?? null, webhookEventId: event.id ?? null },
    },
  })
  res.json({ ok: true })
}

type BillingPriority = 'REGULAR' | 'NIGHT' | 'URGENT'

type BillingEventInput = {
  clientId: string
  processingJobId: string
  studyId?: string
  serviceName: string
  workflowType: string
  units: number
  studyUid?: string
  modality?: string
  priority?: string | null
  providerCode?: string | null
  outsourceTeleradiology?: boolean
  assignedServiceName?: string | null
}

billingRouter.get('/pricing', requireAuth, requireSuperAdmin, async (_req, res) => {
  const pricing = await prisma.pricingRule.findMany({ orderBy: [{ serviceName: 'asc' }, { workflowType: 'asc' }, { priority: 'asc' }] })
  res.json(pricing.filter((rule) => !nonBillableSuiteServiceNames.has(rule.serviceName)))
})

billingRouter.get('/razorpay/callback', async (req, res) => {
  const paymentLinkId = String(req.query.razorpay_payment_link_id ?? req.query.payment_link_id ?? '')
  if (paymentLinkId) {
    try {
      const invoice = await syncRazorpayPaymentLinkStatus(paymentLinkId, 'payment_link_callback')
      return res.redirect(`/?payment=${encodeURIComponent(invoice.status.toLowerCase())}&invoice=${encodeURIComponent(invoice.invoiceNumber)}`)
    } catch (error) {
      console.error('Razorpay payment link callback sync failed', error)
      return res.redirect('/?payment=sync_failed')
    }
  }
  return res.redirect('/?payment=missing_reference')
})

billingRouter.post('/pricing', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = pricingSchema.parse(req.body)
  const rule = await prisma.pricingRule.create({ data: body })
  await auditSuperAdminChange(req, 'PRICING_RULE_CREATED', { pricingRuleId: rule.id, serviceName: rule.serviceName, workflowType: rule.workflowType, priority: rule.priority })
  res.status(201).json(rule)
})

billingRouter.put('/pricing/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = pricingSchema.partial().parse(req.body)
  const rule = await prisma.pricingRule.update({ where: { id: String(req.params.id) }, data: body })
  await auditSuperAdminChange(req, 'PRICING_RULE_UPDATED', { pricingRuleId: rule.id, changes: body })
  res.json(rule)
})

billingRouter.get('/usage', requireAuth, requireSuperAdmin, async (_req, res) => {
  const transactions = await prisma.studyBillingTransaction.findMany({
    include: { client: true, invoice: true },
    orderBy: { createdAt: 'desc' },
    take: 250,
  })
  res.json(transactions)
})

billingRouter.post('/usage/:transactionId/reclassify', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({
    priority: z.enum(['REGULAR', 'NIGHT', 'URGENT']).optional(),
    category: z.string().optional(),
    units: z.number().int().positive().optional(),
  }).parse(req.body)
  const existing = await prisma.studyBillingTransaction.findUniqueOrThrow({ where: { id: String(req.params.transactionId) } })
  const priority = body.priority ?? existing.priority
  const category = body.category ?? existing.category
  const units = body.units ?? existing.units
  const price = await findPricingRule(existing.serviceName, existing.workflowType, priority, category)
  const updated = await prisma.studyBillingTransaction.update({
    where: { id: existing.id },
    data: {
      priority,
      category,
      units,
      unitPriceMinor: price.unitPriceMinor,
      amountMinor: units * price.unitPriceMinor,
      currency: price.currency,
      metadata: { reclassifiedAt: new Date().toISOString(), previous: existing },
    },
  })
  await auditSuperAdminChange(req, 'BILLING_USAGE_RECLASSIFIED', { transactionId: existing.id, previous: { priority: existing.priority, category: existing.category, units: existing.units }, updated: { priority, category, units } }, existing.clientId)
  res.json(updated)
})

billingRouter.get('/invoices', requireAuth, requireSuperAdmin, async (_req, res) => {
  res.json(await listInvoices())
})

billingRouter.post('/invoices/generate', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({
    clientId: z.string().optional(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
  }).parse(req.body)
  const invoices = await generateInvoices(new Date(body.periodStart), new Date(body.periodEnd), body.clientId)
  await auditSuperAdminChange(req, 'INVOICES_GENERATED', { clientId: body.clientId ?? null, periodStart: body.periodStart, periodEnd: body.periodEnd, invoiceIds: invoices.map((invoice) => invoice.id) }, body.clientId)
  res.status(201).json(invoices)
})

billingRouter.get('/invoices/:invoiceId', requireAuth, requireSuperAdmin, async (req, res) => {
  res.json(await getInvoice(String(req.params.invoiceId)))
})

billingRouter.get('/invoices/:invoiceId/download', requireAuth, requireSuperAdmin, async (req, res) => {
  const invoice = await getInvoice(String(req.params.invoiceId))
  sendInvoiceDownload(res, invoice)
})

billingRouter.post('/invoices/:invoiceId/approve', requireAuth, requireSuperAdmin, async (req, res) => {
  const invoice = await prisma.invoice.update({ where: { id: String(req.params.invoiceId) }, data: { status: 'APPROVED' } })
  await auditSuperAdminChange(req, 'INVOICE_APPROVED', { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, totalMinor: invoice.totalMinor }, invoice.clientId)
  res.json(invoice)
})

billingRouter.post('/invoices/:invoiceId/issue', requireAuth, requireSuperAdmin, async (req, res) => {
  const invoice = await prisma.invoice.update({ where: { id: String(req.params.invoiceId) }, data: { status: 'ISSUED', issuedAt: new Date() } })
  await auditSuperAdminChange(req, 'INVOICE_ISSUED', { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, totalMinor: invoice.totalMinor }, invoice.clientId)
  res.json(invoice)
})

billingRouter.post('/invoices/:invoiceId/create-payment-link', requireAuth, requireSuperAdmin, async (req, res) => {
  const invoice = await getInvoice(String(req.params.invoiceId))
  const link = await getOrCreateRazorpayPaymentLink(invoice)
  await auditSuperAdminChange(req, 'PAYMENT_LINK_CREATED', { invoiceId: invoice.id, paymentLinkId: link.id, amountMinor: link.amountMinor, provider: link.provider }, invoice.clientId)
  res.status(201).json(link)
})

billingRouter.post('/invoices/:invoiceId/record-offline-payment', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({
    amountMinor: z.number().int().positive(),
    method: z.string().optional(),
    providerPaymentId: z.string().optional(),
  }).parse(req.body)
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: String(req.params.invoiceId) } })
  const payment = await prisma.payment.create({
    data: {
      clientId: invoice.clientId,
      invoiceId: invoice.id,
      amountMinor: body.amountMinor,
      currency: invoice.currency,
      method: body.method ?? 'OFFLINE',
      providerPaymentId: body.providerPaymentId,
      metadata: { recordedBy: 'SUPER_ADMIN' },
    },
  })
  const paid = await prisma.payment.aggregate({ where: { invoiceId: invoice.id, status: 'CAPTURED' }, _sum: { amountMinor: true } })
  if ((paid._sum.amountMinor ?? 0) >= invoice.totalMinor) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID', paidAt: new Date() } })
  }
  await auditSuperAdminChange(req, 'OFFLINE_PAYMENT_RECORDED', { invoiceId: invoice.id, paymentId: payment.id, amountMinor: payment.amountMinor, method: payment.method }, invoice.clientId)
  res.status(201).json(payment)
})

billingRouter.post('/invoices/:invoiceId/mark-paid-manually', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({
    method: z.string().optional().default('MANUAL'),
    providerPaymentId: z.string().optional(),
    paidAt: z.coerce.date().optional(),
  }).parse(req.body)
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: String(req.params.invoiceId) } })
  const captured = await prisma.payment.aggregate({ where: { invoiceId: invoice.id, status: 'CAPTURED' }, _sum: { amountMinor: true } })
  const remainingMinor = Math.max(0, invoice.totalMinor - (captured._sum.amountMinor ?? 0))
  const paidAt = body.paidAt ?? new Date()
  const payment = remainingMinor > 0
    ? await prisma.payment.create({
      data: {
        clientId: invoice.clientId,
        invoiceId: invoice.id,
        amountMinor: remainingMinor,
        currency: invoice.currency,
        provider: 'OFFLINE',
        method: body.method,
        providerPaymentId: body.providerPaymentId,
        paidAt,
        metadata: { recordedBy: 'SUPER_ADMIN', manualPaid: true },
      },
    })
    : null
  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: 'PAID', paidAt },
    include: invoiceInclude,
  })
  await auditSuperAdminChange(req, 'INVOICE_MARKED_PAID_MANUALLY', { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, paymentId: payment?.id ?? null, amountMinor: remainingMinor, method: body.method }, invoice.clientId)
  res.json(updated)
})

billingRouter.get('/provider-settlements', requireAuth, requireSuperAdmin, async (_req, res) => {
  const settlements = await prisma.providerSettlement.findMany({ include: { items: true }, orderBy: { createdAt: 'desc' } })
  res.json(settlements)
})

billingRouter.post('/provider-settlements/generate', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({
    providerCode: z.string().default('RENEWIST'),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
  }).parse(req.body)
  const settlement = await generateProviderSettlement(body.providerCode, new Date(body.periodStart), new Date(body.periodEnd))
  await auditSuperAdminChange(req, 'PROVIDER_SETTLEMENT_GENERATED', { settlementId: settlement.id, providerCode: body.providerCode, periodStart: body.periodStart, periodEnd: body.periodEnd, subtotalMinor: settlement.subtotalMinor })
  res.status(201).json(settlement)
})

billingRouter.post('/provider-settlements/:settlementId/record-payment', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({
    method: z.string().optional().default('BANK_TRANSFER'),
    reference: z.string().optional(),
    paidAt: z.coerce.date().optional(),
  }).parse(req.body)
  const settlementId = String(req.params.settlementId)
  const paidAt = body.paidAt ?? new Date()
  const settlement = await prisma.$transaction(async (tx) => {
    await tx.providerPayableTransaction.updateMany({
      where: { settlementId },
      data: {
        status: 'PAID',
        metadata: {
          paidAt: paidAt.toISOString(),
          paymentMethod: body.method,
          paymentReference: body.reference ?? null,
        },
      },
    })
    return tx.providerSettlement.update({
      where: { id: settlementId },
      data: { status: 'PAID', paidAt },
      include: { items: true },
    })
  })
  await auditSuperAdminChange(req, 'PROVIDER_SETTLEMENT_PAID', { settlementId: settlement.id, providerCode: settlement.providerCode, subtotalMinor: settlement.subtotalMinor, method: body.method, reference: body.reference ?? null })
  res.json(settlement)
})

billingRouter.get('/disputes', requireAuth, requireSuperAdmin, async (_req, res) => {
  res.json(await prisma.billingDispute.findMany({ include: { client: true }, orderBy: { createdAt: 'desc' } }))
})

billingRouter.post('/disputes', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({
    clientId: z.string().optional(),
    invoiceId: z.string().optional(),
    settlementId: z.string().optional(),
    dectrocelJobId: z.string().optional(),
    type: z.string().min(2),
    expectedAmountMinor: z.number().int().optional(),
    appliedAmountMinor: z.number().int().optional(),
    reason: z.string().min(3),
  }).parse(req.body)
  const dispute = await prisma.billingDispute.create({ data: body })
  await auditSuperAdminChange(req, 'BILLING_DISPUTE_CREATED', { disputeId: dispute.id, type: dispute.type, reason: dispute.reason }, dispute.clientId ?? undefined)
  res.status(201).json(dispute)
})

billingRouter.post('/disputes/:disputeId/resolve', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({ status: z.string().default('RESOLVED'), resolution: z.string().min(2) }).parse(req.body)
  const dispute = await prisma.billingDispute.update({ where: { id: String(req.params.disputeId) }, data: body })
  await auditSuperAdminChange(req, 'BILLING_DISPUTE_RESOLVED', { disputeId: dispute.id, status: dispute.status, resolution: dispute.resolution }, dispute.clientId ?? undefined)
  res.json(dispute)
})

clientBillingRouter.get('/usage/summary', requireAuth, requireClientUser, async (req, res) => {
  res.json(await getClientBillingSnapshot(req.user!.clientId!))
})

clientBillingRouter.get('/invoices', requireAuth, requireClientUser, async (req, res) => {
  res.json(await listInvoices(req.user!.clientId!))
})

clientBillingRouter.get('/invoices/:invoiceId', requireAuth, requireClientUser, async (req, res) => {
  const invoice = await getInvoice(String(req.params.invoiceId))
  if (invoice.clientId !== req.user!.clientId) return res.status(404).json({ message: 'Invoice not found' })
  res.json(invoice)
})

clientBillingRouter.get('/invoices/:invoiceId/download', requireAuth, requireClientUser, async (req, res) => {
  const invoice = await getInvoice(String(req.params.invoiceId))
  if (invoice.clientId !== req.user!.clientId) return res.status(404).json({ message: 'Invoice not found' })
  sendInvoiceDownload(res, invoice)
})

clientBillingRouter.post('/invoices/:invoiceId/razorpay-order', requireAuth, requireClientUser, async (req, res) => {
  const invoice = await getInvoice(String(req.params.invoiceId))
  if (invoice.clientId !== req.user!.clientId) return res.status(404).json({ message: 'Invoice not found' })
  if (invoice.status === 'PAID') return res.status(409).json({ message: 'Invoice is already paid' })
  if (invoice.totalMinor <= 0) return res.status(400).json({ message: 'Invoice amount must be greater than zero' })
  const order = await createRazorpayOrder(invoice)
  await prisma.paymentLink.create({
    data: {
      invoiceId: invoice.id,
      provider: 'RAZORPAY',
      providerLinkId: order.id,
      amountMinor: invoice.totalMinor,
      currency: invoice.currency,
      expiresAt: new Date(Date.now() + paymentLinkExpiryDays * 24 * 60 * 60 * 1000),
      status: 'ORDER_CREATED',
    },
  })
  await prisma.invoice.update({ where: { id: invoice.id }, data: { razorpayPaymentLinkId: order.id, paymentUrl: `razorpay:${order.id}` } })
  await prisma.auditLog.create({
    data: {
      clientId: invoice.clientId,
      actorUserId: req.user!.sub,
      action: 'RAZORPAY_ORDER_CREATED',
      metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, orderId: order.id, amountMinor: invoice.totalMinor },
      ipAddress: req.ip,
    },
  })
  res.status(201).json({
    keyId: getRazorpayCredentials().keyId,
    orderId: order.id,
    amountMinor: invoice.totalMinor,
    currency: invoice.currency,
    invoiceNumber: invoice.invoiceNumber,
    clientName: invoice.client.name,
    description: `Invoice ${invoice.invoiceNumber}`,
  })
})

clientBillingRouter.post('/invoices/:invoiceId/razorpay-payment-link', requireAuth, requireClientUser, async (req, res) => {
  const invoice = await getInvoice(String(req.params.invoiceId))
  if (invoice.clientId !== req.user!.clientId) return res.status(404).json({ message: 'Invoice not found' })
  if (invoice.status === 'PAID') return res.status(409).json({ message: 'Invoice is already paid' })
  if (invoice.totalMinor <= 0) return res.status(400).json({ message: 'Invoice amount must be greater than zero' })
  const link = await getOrCreateRazorpayPaymentLink(invoice)
  await prisma.auditLog.create({
    data: {
      clientId: invoice.clientId,
      actorUserId: req.user!.sub,
      action: 'RAZORPAY_PAYMENT_LINK_REQUESTED',
      metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, paymentLinkId: link.providerLinkId, shortUrl: link.shortUrl },
      ipAddress: req.ip,
    },
  })
  res.json({ paymentUrl: link.shortUrl, providerLinkId: link.providerLinkId, status: link.status })
})

clientBillingRouter.post('/invoices/:invoiceId/sync-razorpay-payment', requireAuth, requireClientUser, async (req, res) => {
  const invoice = await getInvoice(String(req.params.invoiceId))
  if (invoice.clientId !== req.user!.clientId) return res.status(404).json({ message: 'Invoice not found' })
  const providerLinkId = invoice.razorpayPaymentLinkId ?? invoice.paymentLinks.find((link) => link.provider === 'RAZORPAY' && link.providerLinkId)?.providerLinkId
  if (!providerLinkId) return res.json(invoice)
  try {
    const updated = await syncRazorpayPaymentLinkStatus(providerLinkId, 'client_billing_manual_sync')
    return res.json(updated)
  } catch (error) {
    await prisma.auditLog.create({
      data: {
        clientId: invoice.clientId,
        actorUserId: req.user!.sub,
        action: 'RAZORPAY_PAYMENT_SYNC_DEFERRED',
        metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, providerLinkId, error: error instanceof Error ? error.message : String(error) },
        ipAddress: req.ip,
      },
    })
    return res.json(invoice)
  }
})

clientBillingRouter.post('/razorpay/verify', requireAuth, requireClientUser, async (req, res) => {
  const body = z.object({
    razorpay_order_id: z.string().min(1),
    razorpay_payment_id: z.string().min(1),
    razorpay_signature: z.string().min(1),
  }).parse(req.body)
  const credentials = getRazorpayCredentials()
  const expected = createHmac('sha256', credentials.keySecret)
    .update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`)
    .digest('hex')
  if (expected !== body.razorpay_signature) return res.status(400).json({ message: 'Razorpay signature verification failed' })

  const link = await prisma.paymentLink.findFirstOrThrow({
    where: { provider: 'RAZORPAY', providerLinkId: body.razorpay_order_id },
    include: { invoice: true },
  })
  if (link.invoice.clientId !== req.user!.clientId) return res.status(404).json({ message: 'Invoice not found' })
  const existing = await prisma.payment.findFirst({ where: { provider: 'RAZORPAY', providerPaymentId: body.razorpay_payment_id } })
  const payment = existing ?? await prisma.payment.create({
    data: {
      clientId: link.invoice.clientId,
      invoiceId: link.invoiceId,
      provider: 'RAZORPAY',
      providerPaymentId: body.razorpay_payment_id,
      amountMinor: link.amountMinor,
      currency: link.currency,
      status: 'CAPTURED',
      method: 'RAZORPAY_CHECKOUT',
      metadata: {
        razorpayOrderId: body.razorpay_order_id,
        razorpaySignature: body.razorpay_signature,
        verifiedAt: new Date().toISOString(),
      },
    },
  })
  await prisma.paymentLink.update({ where: { id: link.id }, data: { status: 'PAID' } })
  const invoice = await refreshInvoicePaymentStatus(link.invoiceId)
  await prisma.auditLog.create({
    data: {
      clientId: link.invoice.clientId,
      actorUserId: req.user!.sub,
      action: 'RAZORPAY_PAYMENT_VERIFIED',
      metadata: { invoiceId: link.invoiceId, invoiceNumber: link.invoice.invoiceNumber, orderId: body.razorpay_order_id, paymentId: body.razorpay_payment_id, amountMinor: link.amountMinor },
      ipAddress: req.ip,
    },
  })
  res.json({ payment, invoice })
})

clientBillingRouter.get('/payments', requireAuth, requireClientUser, async (req, res) => {
  res.json(await prisma.payment.findMany({ where: { clientId: req.user!.clientId! }, include: { invoice: true }, orderBy: { createdAt: 'desc' } }))
})

async function auditSuperAdminChange(req: express.Request, action: string, metadata: Record<string, unknown>, clientId?: string | null) {
  await prisma.auditLog.create({
    data: {
      clientId: clientId ?? null,
      actorUserId: req.user?.sub ?? null,
      action,
      metadata: toPrismaJson(metadata),
      ipAddress: req.ip,
    },
  })
}

export async function getAdminBillingSnapshot() {
  const [transactions, invoices, payments, pricingRules, payables, settlements, disputes] = await Promise.all([
    prisma.studyBillingTransaction.findMany({ include: { client: true, invoice: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
    listInvoices(),
    prisma.payment.findMany({ include: { client: true, invoice: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.pricingRule.findMany({ where: { active: true }, orderBy: [{ serviceName: 'asc' }, { priority: 'asc' }] }),
    prisma.providerPayableTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.providerSettlement.findMany({ include: { items: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.billingDispute.findMany({ include: { client: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ])
  return buildBillingSnapshot({ transactions, invoices, payments, pricingRules, payables, settlements, disputes })
}

export async function getClientBillingSnapshot(clientId: string) {
  const [transactions, invoices, payments, pricingRules, disputes] = await Promise.all([
    prisma.studyBillingTransaction.findMany({ where: { clientId }, include: { invoice: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
    listInvoices(clientId),
    prisma.payment.findMany({ where: { clientId }, include: { invoice: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.pricingRule.findMany({ where: { active: true }, orderBy: [{ serviceName: 'asc' }, { priority: 'asc' }] }),
    prisma.billingDispute.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ])
  return buildBillingSnapshot({ transactions, invoices, payments, pricingRules, payables: [], settlements: [], disputes })
}

export async function recordBillingEvent(input: BillingEventInput) {
  const priority = normalizePriority(input.priority)
  const price = await findPricingRule(input.serviceName, input.workflowType, priority, priority)
  const manualBilling = price.manualBilling === true
  const amountMinor = input.units * price.unitPriceMinor
  const transactionData = {
    studyId: input.studyId,
    serviceName: input.serviceName,
    workflowType: input.workflowType,
    priority,
    category: priority,
    units: input.units,
    unitPriceMinor: price.unitPriceMinor,
    amountMinor,
    currency: price.currency,
    metadata: { studyUid: input.studyUid, modality: input.modality, providerCode: input.providerCode, outsourceTeleradiology: Boolean(input.outsourceTeleradiology), assignedServiceName: input.assignedServiceName ?? null, billedServiceName: input.serviceName, manualBilling, manualBillingLabel: manualBilling ? manualBillingLabel : null, manualBillingReason: manualBilling ? price.manualBillingReason : null, recordedAt: new Date().toISOString() },
  }
  const existingByJob = input.processingJobId
    ? await prisma.studyBillingTransaction.findFirst({ where: { processingJobId: input.processingJobId } })
    : null
  const transaction = existingByJob && existingByJob.serviceName !== input.serviceName && existingByJob.status === 'UNINVOICED'
    ? await prisma.studyBillingTransaction.update({ where: { id: existingByJob.id }, data: transactionData })
    : await prisma.studyBillingTransaction.upsert({
      where: { processingJobId_serviceName: { processingJobId: input.processingJobId, serviceName: input.serviceName } },
      update: transactionData,
      create: {
        clientId: input.clientId,
        processingJobId: input.processingJobId,
        ...transactionData,
      },
    })

  if (input.workflowType !== 'AI_ONLY' && input.providerCode) {
    await prisma.providerPayableTransaction.upsert({
      where: { dectrocelJobId_providerCode: { dectrocelJobId: input.processingJobId, providerCode: input.providerCode } },
      update: {
        units: input.units,
        unitPayableMinor: price.providerPayableMinor,
        amountMinor: input.units * price.providerPayableMinor,
        currency: price.currency,
        metadata: { billingTransactionId: transaction.id, studyUid: input.studyUid, outsourceTeleradiology: Boolean(input.outsourceTeleradiology), manualBilling, manualBillingLabel: manualBilling ? manualBillingLabel : null, manualBillingReason: manualBilling ? price.manualBillingReason : null },
      },
      create: {
        providerCode: input.providerCode,
        dectrocelJobId: input.processingJobId,
        processingJobId: input.processingJobId,
        serviceName: input.serviceName,
        workflowType: input.workflowType,
        priority,
        category: priority,
        units: input.units,
        unitPayableMinor: price.providerPayableMinor,
        amountMinor: input.units * price.providerPayableMinor,
        currency: price.currency,
        metadata: { billingTransactionId: transaction.id, studyUid: input.studyUid, outsourceTeleradiology: Boolean(input.outsourceTeleradiology), manualBilling, manualBillingLabel: manualBilling ? manualBillingLabel : null, manualBillingReason: manualBilling ? price.manualBillingReason : null },
      },
    })
  }

  return transaction
}

async function generateInvoices(periodStart: Date, periodEnd: Date, clientId?: string) {
  const grouped = await prisma.studyBillingTransaction.groupBy({
    by: ['clientId'],
    where: {
      clientId,
      status: 'UNINVOICED',
      createdAt: { gte: periodStart, lte: periodEnd },
    },
  })
  const invoices = []
  for (const group of grouped) {
    const transactions = await prisma.studyBillingTransaction.findMany({
      where: { clientId: group.clientId, status: 'UNINVOICED', createdAt: { gte: periodStart, lte: periodEnd } },
    })
    if (!transactions.length) continue
    const client = await prisma.client.findUniqueOrThrow({ where: { id: group.clientId }, select: { billingDiscountPercent: true } })
    const grossMinor = transactions.reduce((sum, item) => sum + item.amountMinor, 0)
    const discountPercent = Math.min(100, Math.max(0, client.billingDiscountPercent))
    const discountMinor = Math.round(grossMinor * discountPercent / 100)
    const subtotalMinor = Math.max(0, grossMinor - discountMinor)
    const tax = calculateGstTax(subtotalMinor)
    const totalMinor = subtotalMinor + tax.totalTaxMinor
    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          clientId: group.clientId,
          invoiceNumber: await nextInvoiceNumber(group.clientId),
          periodStart,
          periodEnd,
          subtotalMinor,
          taxMinor: tax.totalTaxMinor,
          totalMinor,
          currency: transactions[0]?.currency ?? 'INR',
        },
      })
      const summaries = summarizeTransactions(transactions)
      const lineItems: Prisma.InvoiceLineItemCreateManyInput[] = summaries.map((item) => ({
          invoiceId: created.id,
          description: `${item.serviceName} ${item.workflowType} ${item.priority}`,
          serviceName: item.serviceName,
          units: item.units,
          unitPriceMinor: item.unitPriceMinor,
          amountMinor: item.amountMinor,
          currency: item.currency,
          metadata: { workflowType: item.workflowType, priority: item.priority, manualBilling: item.manualBilling, manualBillingLabel: item.manualBilling ? manualBillingLabel : null },
      }))
      if (discountMinor > 0) {
        lineItems.push({
          invoiceId: created.id,
          description: `Client discount ${discountPercent}%`,
          serviceName: 'Billing discount',
          units: 1,
          unitPriceMinor: -discountMinor,
          amountMinor: -discountMinor,
          currency: transactions[0]?.currency ?? 'INR',
          metadata: { discountPercent, grossMinor, discountMinor },
        })
      }
      await tx.invoiceLineItem.createMany({ data: lineItems })
      await tx.studyBillingTransaction.updateMany({
        where: { id: { in: transactions.map((item) => item.id) } },
        data: { invoiceId: created.id, status: 'INVOICED' },
      })
      return tx.invoice.findUniqueOrThrow({ where: { id: created.id }, include: invoiceInclude })
    })
    invoices.push(invoice)
  }
  return invoices
}

export async function generateDueMonthlyInvoices() {
  const now = new Date()
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0))
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999))
  return generateInvoices(periodStart, periodEnd)
}

async function generateProviderSettlement(providerCode: string, periodStart: Date, periodEnd: Date) {
  const items = await prisma.providerPayableTransaction.findMany({
    where: { providerCode, status: 'UNSETTLED', createdAt: { gte: periodStart, lte: periodEnd } },
  })
  const subtotalMinor = items.reduce((sum, item) => sum + item.amountMinor, 0)
  return prisma.$transaction(async (tx) => {
    const settlement = await tx.providerSettlement.create({
      data: {
        providerCode,
        settlementNumber: `SET-${providerCode}-${Date.now()}`,
        periodStart,
        periodEnd,
        subtotalMinor,
        currency: items[0]?.currency ?? 'INR',
      },
    })
    if (items.length) {
      await tx.providerPayableTransaction.updateMany({
        where: { id: { in: items.map((item) => item.id) } },
        data: { settlementId: settlement.id, status: 'SETTLED_DRAFT' },
      })
    }
    return tx.providerSettlement.findUniqueOrThrow({ where: { id: settlement.id }, include: { items: true } })
  })
}

const pricingSchema = z.object({
  serviceName: z.string().min(2),
  workflowType: z.string().default('ANY'),
  priority: z.enum(['REGULAR', 'NIGHT', 'URGENT']).default('REGULAR'),
  category: z.string().default('REGULAR'),
  currency: z.string().default('INR'),
  unitPriceMinor: z.number().int().nonnegative(),
  providerPayableMinor: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true),
  validFrom: z.coerce.date().optional(),
  validUntil: z.coerce.date().optional(),
})

const invoiceInclude = { client: true, lineItems: true, transactions: true, paymentLinks: true, payments: true } as const

async function listInvoices(clientId?: string) {
  return prisma.invoice.findMany({ where: { clientId }, include: invoiceInclude, orderBy: { createdAt: 'desc' }, take: 100 })
}

async function getInvoice(invoiceId: string) {
  return prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: invoiceInclude })
}

async function findPricingRule(serviceName: string, workflowType: string, priority: string, category: string) {
  if (manualBillingServiceNames.has(serviceName)) return manualPricingRule(`No pricing is configured for ${serviceName}`)
  const now = new Date()
  const candidates = await prisma.pricingRule.findMany({
    where: {
      active: true,
      serviceName,
      priority,
      category,
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    orderBy: { validFrom: 'desc' },
  })
  const candidate = candidates.find((rule) => rule.workflowType === workflowType)
    ?? candidates.find((rule) => rule.workflowType === 'ANY')
  return candidate
    ? { ...candidate, manualBilling: false, manualBillingReason: null }
    : manualPricingRule(`No active pricing rule found for ${serviceName} (${priority})`)
}

function manualPricingRule(reason: string) {
  return { unitPriceMinor: 0, providerPayableMinor: 0, currency: 'INR', manualBilling: true, manualBillingReason: reason }
}

function getRazorpayCredentials() {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) throw new Error('Razorpay credentials are not configured')
  return { keyId, keySecret }
}

async function createRazorpayOrder(invoice: Awaited<ReturnType<typeof getInvoice>>) {
  const { keyId, keySecret } = getRazorpayCredentials()
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: invoice.totalMinor,
      currency: invoice.currency,
      receipt: invoice.invoiceNumber.slice(0, 40),
      notes: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        clientId: invoice.clientId,
      },
    }),
  })
  const body = await response.json().catch(async () => ({ error: { description: await response.text().catch(() => 'Razorpay request failed') } }))
  if (!response.ok) {
    const description = typeof body?.error?.description === 'string' ? body.error.description : `Razorpay order creation failed (${response.status})`
    throw new Error(description)
  }
  return z.object({ id: z.string(), amount: z.number(), currency: z.string(), status: z.string().optional() }).parse(body)
}

async function getOrCreateRazorpayPaymentLink(invoice: Awaited<ReturnType<typeof getInvoice>>) {
  const existing = invoice.paymentLinks
    .filter((link) => link.provider === 'RAZORPAY' && link.shortUrl && !['PAID', 'CANCELLED', 'EXPIRED', 'FAILED'].includes(link.status.toUpperCase()))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
  if (existing) return existing

  const expiresAt = new Date(Date.now() + paymentLinkExpiryDays * 24 * 60 * 60 * 1000)
  if (process.env.RAZORPAY_ENABLED !== 'true') {
    const providerLinkId = `local_${randomUUID()}`
    const shortUrl = `${process.env.RAZORPAY_CALLBACK_URL || process.env.TELERADIOLOGY_CALLBACK_BASE_URL || ''}/payments/${providerLinkId}`.replace(/^\//, '')
    const link = await prisma.paymentLink.create({
      data: {
        invoiceId: invoice.id,
        provider: 'RAZORPAY',
        providerLinkId,
        shortUrl,
        amountMinor: invoice.totalMinor,
        currency: invoice.currency,
        expiresAt,
        status: 'CREATED_LOCAL',
      },
    })
    await prisma.invoice.update({ where: { id: invoice.id }, data: { razorpayPaymentLinkId: providerLinkId, paymentUrl: shortUrl } })
    return link
  }

  const providerLink = await createRazorpayPaymentLink(invoice, expiresAt)
  const link = await prisma.paymentLink.create({
    data: {
      invoiceId: invoice.id,
      provider: 'RAZORPAY',
      providerLinkId: providerLink.id,
      shortUrl: providerLink.short_url,
      amountMinor: invoice.totalMinor,
      currency: invoice.currency,
      expiresAt,
      status: providerLink.status?.toUpperCase() ?? 'ISSUED',
    },
  })
  await prisma.invoice.update({ where: { id: invoice.id }, data: { razorpayPaymentLinkId: providerLink.id, paymentUrl: providerLink.short_url } })
  return link
}

async function createRazorpayPaymentLink(invoice: Awaited<ReturnType<typeof getInvoice>>, expiresAt: Date) {
  const { keyId, keySecret } = getRazorpayCredentials()
  const callbackBase = process.env.RAZORPAY_CALLBACK_URL || process.env.TELERADIOLOGY_CALLBACK_BASE_URL || 'https://pacsdectrocel.online'
  const response = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: invoice.totalMinor,
      currency: invoice.currency,
      accept_partial: false,
      expire_by: Math.floor(expiresAt.getTime() / 1000),
      reference_id: invoice.invoiceNumber.slice(0, 40),
      description: `DecXpert invoice ${invoice.invoiceNumber}`,
      customer: {
        name: invoice.client.name,
        email: invoice.client.email,
        contact: invoice.client.primaryContact || undefined,
      },
      notify: { sms: false, email: false },
      reminder_enable: false,
      callback_url: `${callbackBase.replace(/\/$/, '')}/api/v1/billing/razorpay/callback`,
      callback_method: 'get',
      notes: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        clientId: invoice.clientId,
      },
    }),
  })
  const body = await response.json().catch(async () => ({ error: { description: await response.text().catch(() => 'Razorpay payment link request failed') } }))
  if (!response.ok) {
    const description = typeof body?.error?.description === 'string' ? body.error.description : `Razorpay payment link creation failed (${response.status})`
    throw new Error(description)
  }
  return z.object({
    id: z.string(),
    short_url: z.string().url(),
    status: z.string().optional(),
    amount: z.number().optional(),
    amount_paid: z.number().optional(),
  }).parse(body)
}

async function fetchRazorpayPaymentLink(providerLinkId: string) {
  const { keyId, keySecret } = getRazorpayCredentials()
  const response = await fetch(`https://api.razorpay.com/v1/payment_links/${providerLinkId}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}` },
  })
  const body = await response.json().catch(async () => ({ error: { description: await response.text().catch(() => 'Razorpay payment link fetch failed') } }))
  if (!response.ok) {
    const description = typeof body?.error?.description === 'string' ? body.error.description : `Razorpay payment link fetch failed (${response.status})`
    throw new Error(description)
  }
  return z.object({
    id: z.string(),
    status: z.string(),
    amount: z.number().optional(),
    amount_paid: z.number().optional(),
    payments: z.array(z.object({
      payment_id: z.string(),
      amount: z.number(),
      status: z.string(),
      method: z.string().optional(),
      created_at: z.number().optional(),
    })).optional(),
  }).parse(body)
}

async function syncRazorpayPaymentLinkStatus(providerLinkId: string, source: string) {
  const providerLink = await fetchRazorpayPaymentLink(providerLinkId)
  const link = await prisma.paymentLink.findFirstOrThrow({
    where: { provider: 'RAZORPAY', providerLinkId },
    include: { invoice: true },
  })
  const status = providerLink.status.toUpperCase()
  await prisma.paymentLink.update({ where: { id: link.id }, data: { status } })
  if (providerLink.status.toLowerCase() === 'paid' || (providerLink.amount_paid ?? 0) >= link.amountMinor) {
    const captured = providerLink.payments?.find((payment) => payment.status.toLowerCase() === 'captured') ?? providerLink.payments?.[0]
    const paymentId = captured?.payment_id ?? `plink_${providerLink.id}_${source}`
    const existing = await prisma.payment.findFirst({ where: { provider: 'RAZORPAY', providerPaymentId: paymentId } })
    if (!existing) {
      await prisma.payment.create({
        data: {
          clientId: link.invoice.clientId,
          invoiceId: link.invoiceId,
          provider: 'RAZORPAY',
          providerPaymentId: paymentId,
          amountMinor: captured?.amount ?? providerLink.amount_paid ?? link.amountMinor,
          currency: link.currency,
          status: 'CAPTURED',
          method: captured?.method ?? 'RAZORPAY_PAYMENT_LINK',
          paidAt: captured?.created_at ? new Date(captured.created_at * 1000) : new Date(),
          metadata: {
            razorpayPaymentLinkId: providerLink.id,
            source,
            syncedAt: new Date().toISOString(),
          },
        },
      })
    }
    await prisma.paymentLink.update({ where: { id: link.id }, data: { status: 'PAID' } })
    return refreshInvoicePaymentStatus(link.invoiceId)
  }
  return prisma.invoice.findUniqueOrThrow({ where: { id: link.invoiceId } })
}

type RazorpayWebhookPayload = {
  id?: string
  event: string
  payload?: {
    payment?: {
      entity?: {
        id?: string
        order_id?: string
        amount?: number
        currency?: string
        status?: string
        method?: string
        error_code?: string | null
        error_description?: string | null
        notes?: { invoiceId?: string }
      }
    }
    order?: { entity?: { id?: string; amount?: number; currency?: string; status?: string; notes?: { invoiceId?: string } } }
    payment_link?: { entity?: { id?: string; amount?: number; currency?: string; status?: string; notes?: { invoiceId?: string } } }
  }
}

async function recordRazorpayPaymentFromWebhook(
  link: Prisma.PaymentLinkGetPayload<{ include: { invoice: true } }>,
  paymentEntity: RazorpayWebhookPayload['payload']['payment']['entity'] | undefined,
  event: RazorpayWebhookPayload,
) {
  const paymentId = paymentEntity?.id ?? `webhook_${event.id ?? randomUUID()}`
  const existing = await prisma.payment.findFirst({ where: { provider: 'RAZORPAY', providerPaymentId: paymentId } })
  if (!existing) {
    await prisma.payment.create({
      data: {
        clientId: link.invoice.clientId,
        invoiceId: link.invoiceId,
        provider: 'RAZORPAY',
        providerPaymentId: paymentId,
        amountMinor: Number(paymentEntity?.amount ?? link.amountMinor),
        currency: String(paymentEntity?.currency ?? link.currency),
        status: 'CAPTURED',
        method: String(paymentEntity?.method ?? 'RAZORPAY_CHECKOUT'),
        metadata: {
          razorpayOrderId: link.providerLinkId,
          razorpayStatus: paymentEntity?.status ?? null,
          webhookEventId: event.id ?? null,
          verifiedByWebhookAt: new Date().toISOString(),
        },
      },
    })
  }
  await prisma.paymentLink.update({ where: { id: link.id }, data: { status: 'PAID' } })
  await refreshInvoicePaymentStatus(link.invoiceId)
}

async function refreshInvoicePaymentStatus(invoiceId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
  const paid = await prisma.payment.aggregate({ where: { invoiceId, status: 'CAPTURED' }, _sum: { amountMinor: true } })
  const status = (paid._sum.amountMinor ?? 0) >= invoice.totalMinor ? 'PAID' : 'PARTIALLY_PAID'
  return prisma.invoice.update({
    where: { id: invoiceId },
    data: { status, paidAt: status === 'PAID' ? new Date() : null },
    include: invoiceInclude,
  })
}

function sendInvoiceDownload(res: express.Response, invoice: Awaited<ReturnType<typeof getInvoice>>) {
  const html = renderInvoiceHtml(invoice)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.html"`)
  res.send(html)
}

function renderInvoiceHtml(invoice: Awaited<ReturnType<typeof getInvoice>>) {
  const capturedPayments = invoice.payments.filter((payment) => payment.status === 'CAPTURED')
  const paidMinor = capturedPayments.reduce((sum, payment) => sum + payment.amountMinor, 0)
  const balanceMinor = Math.max(0, invoice.totalMinor - paidMinor)
  const gst = splitStoredGstTax(invoice.subtotalMinor, invoice.taxMinor)
  const lineItems = invoice.lineItems.map((item) => `
    <tr>
      <td>${escapeHtml(item.description)}</td>
      <td>${escapeHtml(item.serviceName)}</td>
      <td class="right">${item.units}</td>
      <td class="right">${formatLineItemMoney(item.unitPriceMinor, item.currency, item.metadata)}</td>
      <td class="right">${formatLineItemMoney(item.amountMinor, item.currency, item.metadata)}</td>
    </tr>
  `).join('')
  const payments = capturedPayments.map((payment) => `
    <tr>
      <td>${escapeHtml(payment.provider)}</td>
      <td>${escapeHtml(payment.method ?? '-')}</td>
      <td>${escapeHtml(payment.providerPaymentId ?? '-')}</td>
      <td>${new Date(payment.paidAt).toLocaleString()}</td>
      <td class="right">${formatMoneyMinor(payment.amountMinor, payment.currency)}</td>
    </tr>
  `).join('')
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 40px; }
    .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 18px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 28px; }
    h2 { margin-top: 28px; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 10px; font-size: 13px; vertical-align: top; }
    th { background: #f1f5f9; text-align: left; }
    .right { text-align: right; }
    .summary { width: 360px; margin-left: auto; }
    .status { display: inline-block; padding: 6px 10px; border: 1px solid #0f766e; color: #0f766e; font-weight: 700; }
    @media print { body { margin: 20mm; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Dectrocel Healthcare and Research Pvt. Ltd.</h1>
      <p>DecXpert PACS Portal Billing Invoice</p>
    </div>
    <div>
      <p><strong>Invoice:</strong> ${escapeHtml(invoice.invoiceNumber)}</p>
      <p><strong>Status:</strong> <span class="status">${escapeHtml(invoice.status)}</span></p>
      <p><strong>Period:</strong> ${new Date(invoice.periodStart).toLocaleDateString()} - ${new Date(invoice.periodEnd).toLocaleDateString()}</p>
      <p><strong>Issued:</strong> ${invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleDateString() : '-'}</p>
    </div>
  </div>
  <p><strong>Bill to:</strong> ${escapeHtml(invoice.client.name)} (${escapeHtml(invoice.client.code)})</p>
  <h2>Line Items</h2>
  <table>
    <thead><tr><th>Description</th><th>Service</th><th class="right">Units</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead>
    <tbody>${lineItems || '<tr><td colspan="5">No line items</td></tr>'}</tbody>
  </table>
  <table class="summary">
    <tr><th>Subtotal</th><td class="right">${formatMoneyMinor(invoice.subtotalMinor, invoice.currency)}</td></tr>
    <tr><th>SGST (${formatPercent(gst.sgstRatePercent)})</th><td class="right">${formatMoneyMinor(gst.sgstMinor, invoice.currency)}</td></tr>
    <tr><th>CGST (${formatPercent(gst.cgstRatePercent)})</th><td class="right">${formatMoneyMinor(gst.cgstMinor, invoice.currency)}</td></tr>
    <tr><th>Total GST</th><td class="right">${formatMoneyMinor(invoice.taxMinor, invoice.currency)}</td></tr>
    <tr><th>Total</th><td class="right">${formatMoneyMinor(invoice.totalMinor, invoice.currency)}</td></tr>
    <tr><th>Paid</th><td class="right">${formatMoneyMinor(paidMinor, invoice.currency)}</td></tr>
    <tr><th>Balance</th><td class="right">${formatMoneyMinor(balanceMinor, invoice.currency)}</td></tr>
  </table>
  <h2>Payments</h2>
  <table>
    <thead><tr><th>Provider</th><th>Method</th><th>Transaction ID</th><th>Paid At</th><th class="right">Amount</th></tr></thead>
    <tbody>${payments || '<tr><td colspan="5">No payments recorded</td></tr>'}</tbody>
  </table>
</body>
</html>`
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatMoneyMinor(amountMinor: number, currency: string) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amountMinor / 100)
}

function formatLineItemMoney(amountMinor: number, currency: string, metadata: unknown) {
  return isManualBillingMetadata(metadata) ? manualBillingLabel : formatMoneyMinor(amountMinor, currency)
}

function calculateGstTax(subtotalMinor: number) {
  const sgstMinor = Math.round(subtotalMinor * sgstRatePercent / 100)
  const cgstMinor = Math.round(subtotalMinor * cgstRatePercent / 100)
  return { sgstMinor, cgstMinor, totalTaxMinor: sgstMinor + cgstMinor }
}

function splitStoredGstTax(subtotalMinor: number, taxMinor: number) {
  if (taxMinor > 0) {
    const sgstMinor = Math.floor(taxMinor / 2)
    return { sgstMinor, cgstMinor: taxMinor - sgstMinor, sgstRatePercent, cgstRatePercent }
  }
  const calculated = calculateGstTax(subtotalMinor)
  return { ...calculated, sgstRatePercent, cgstRatePercent }
}

function formatPercent(value: number) {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(2)}%`
}

function normalizePriority(value?: string | null): BillingPriority {
  const normalized = String(value ?? '').toUpperCase()
  if (normalized === 'URGENT' || normalized === 'STAT' || normalized === 'CRITICAL') return 'URGENT'
  if (normalized === 'NIGHT') return 'NIGHT'
  return isNightTime(new Date()) ? 'NIGHT' : 'REGULAR'
}

export function isNightTime(date: Date) {
  const istHour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(date))
  return istHour >= 21 || istHour < 9
}

function summarizeTransactions(transactions: Array<{ serviceName: string; workflowType: string; priority: string; units: number; unitPriceMinor: number; amountMinor: number; currency: string; metadata: unknown }>) {
  const map = new Map<string, { serviceName: string; workflowType: string; priority: string; units: number; unitPriceMinor: number; amountMinor: number; currency: string; manualBilling: boolean }>()
  for (const item of transactions) {
    const manualBilling = isManualBillingMetadata(item.metadata)
    const key = `${item.serviceName}|${item.workflowType}|${item.priority}|${item.unitPriceMinor}|${manualBilling ? 'manual' : 'priced'}`
    const current = map.get(key) ?? { serviceName: item.serviceName, workflowType: item.workflowType, priority: item.priority, units: 0, unitPriceMinor: item.unitPriceMinor, amountMinor: 0, currency: item.currency, manualBilling }
    current.units += item.units
    current.amountMinor += item.amountMinor
    map.set(key, current)
  }
  return [...map.values()]
}

function isManualBillingMetadata(metadata: unknown) {
  return Boolean(metadata && typeof metadata === 'object' && !Array.isArray(metadata) && (metadata as Record<string, unknown>).manualBilling === true)
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

async function nextInvoiceNumber(clientId: string) {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { code: true } })
  const now = new Date()
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const count = await prisma.invoice.count({ where: { invoiceNumber: { startsWith: `INV-${client?.code ?? 'CLIENT'}-${period}` } } })
  return `INV-${client?.code ?? 'CLIENT'}-${period}-${String(count + 1).padStart(4, '0')}`
}

function buildBillingSnapshot(input: {
  transactions: unknown[]
  invoices: Array<{ totalMinor: number; status: string }>
  payments: Array<{ amountMinor: number; status: string }>
  pricingRules: unknown[]
  payables: Array<{ amountMinor: number; status: string }>
  settlements: unknown[]
  disputes: unknown[]
}) {
  const uninvoicedAmountMinor = (input.transactions as Array<{ amountMinor: number; status: string }>).filter((item) => item.status === 'UNINVOICED').reduce((sum, item) => sum + item.amountMinor, 0)
  const invoicedAmountMinor = input.invoices.reduce((sum, item) => sum + item.totalMinor, 0)
  const paidAmountMinor = input.payments.filter((item) => item.status === 'CAPTURED').reduce((sum, item) => sum + item.amountMinor, 0)
  const providerPayableMinor = input.payables.filter((item) => item.status !== 'PAID').reduce((sum, item) => sum + item.amountMinor, 0)
  return {
    summary: {
      uninvoicedAmountMinor,
      invoicedAmountMinor,
      paidAmountMinor,
      outstandingAmountMinor: Math.max(0, invoicedAmountMinor - paidAmountMinor),
      providerPayableMinor,
      transactionCount: input.transactions.length,
      invoiceCount: input.invoices.length,
      disputeCount: input.disputes.length,
    },
    transactions: input.transactions,
    invoices: input.invoices,
    payments: input.payments,
    pricingRules: (input.pricingRules as Array<{ serviceName?: string }>).filter((rule) => !nonBillableSuiteServiceNames.has(String(rule.serviceName ?? ''))),
    providerPayables: input.payables,
    providerSettlements: input.settlements,
    disputes: input.disputes,
  }
}
