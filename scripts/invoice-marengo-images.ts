import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../server/db'
import { parseClientTariff, priceReportedStudy, tariffSettingKey, tariffTransactionData, editableBillingStatuses } from '../server/clientTariff'

const clientId = 'cmsrytf3n002nsv58h95wlj0l'
const allMonths = process.argv.includes('--all-months')
const argument = (name: string, fallback: number) => Number(process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback)
let year = argument('year', 2026), month = argument('month', 9)
let start: Date, end: Date, number: string
function setPeriod(y: number, m: number) {
  if (!Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) throw new Error('Invalid billing month')
  year = y; month = m
  start = new Date(Date.UTC(y, m - 1, 1) - 330 * 60_000)
  end = new Date(Date.UTC(y, m, 1) - 330 * 60_000)
  number = `INV-MARENGO_AHMEDABAD-${y}${String(m).padStart(2, '0')}-IMAGES-01`
}
setPeriod(year, month)
const config = parseClientTariff(JSON.parse(readFileSync(new URL('../data/marengo-tariff.json', import.meta.url), 'utf8')))
if (config.xrayViewSource !== 'IMAGE_COUNT') throw new Error('Image-count tariff required')
const apply = process.argv.includes('--apply')
const requestedOutput = resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) ?? 'marengo-image-invoice.json')
let output = requestedOutput
const encode = (x: unknown) => JSON.stringify(x, null, 2)
const hash = (x: unknown) => createHash('sha256').update(encode(x)).digest('hex')
const gst = { sgst: Number(process.env.BILLING_SGST_RATE_PERCENT ?? 9), cgst: Number(process.env.BILLING_CGST_RATE_PERCENT ?? 9) }
if (![gst.sgst, gst.cgst].every(n => Number.isFinite(n) && n >= 0 && n <= 100)) throw new Error('Invalid configured tax rates')

async function snapshot(db: Prisma.TransactionClient) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { id: true, code: true, name: true, billingDiscountPercent: true } })
  if (client.code !== 'MARENGO_AHMEDABAD') throw new Error('Client mismatch')
  const studies = await db.availableBridgeStudy.findMany({ where: { clientId, OR: [{ firstDetectedAt: { gte: start, lt: end } }, { firstDetectedAt: null, createdAt: { gte: start, lt: end } }] }, select: { id: true, publicStudyId: true, studyInstanceUid: true, studyDescription: true, modalities: true, instanceCount: true, processingJobId: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] })
  const reports = await db.reportReview.findMany({ where: { clientId, studyUid: { in: studies.map(s => s.studyInstanceUid) } }, select: { id: true, studyUid: true, studyId: true, serviceName: true, status: true, updatedAt: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] })
  const transactions = await db.studyBillingTransaction.findMany({ where: { clientId }, orderBy: { id: 'asc' } })
  const setting = await db.systemSetting.findUnique({ where: { key: tariffSettingKey(clientId) } })
  return { client, studies, reports, transactions, setting }
}

async function main() {
  const baseNumber = number.replace(/-\d+$/, '')
  let sequence = 1
  while (await prisma.invoice.findUnique({ where: { invoiceNumber: number } })) {
    sequence++
    number = `${baseNumber}-${String(sequence).padStart(2, '0')}`
  }
  const before = await snapshot(prisma)
  const latest = new Map<string, typeof before.reports[number]>()
  for (const r of before.reports) if (r.studyUid && !latest.has(r.studyUid)) latest.set(r.studyUid, r)
  const seen = new Set<string>()
  const planned: Array<{ publicStudyId: string | null; studyId: string | null; processingJobId: string | null; serviceName: string; existingId: string | null; id: string; decision: ReturnType<typeof priceReportedStudy> & { sourceSha256: string; reportReviewId: string }; data: ReturnType<typeof tariffTransactionData> }> = []
  const held = []
  const previouslyInvoiced = []
  let notReported = 0
  for (const s of before.studies) {
    const uid = s.studyInstanceUid || s.id
    if (seen.has(uid)) continue
    seen.add(uid)
    const r = latest.get(s.studyInstanceUid)
    const d = priceReportedStudy(config, { reportStatus: r?.status, description: s.studyDescription ?? '', modalities: s.modalities, serviceName: r?.serviceName ?? '', imageCount: s.instanceCount })
    if (d.status === 'PENDING_REPORT') { notReported++; continue }
    if (!r || d.status !== 'UNINVOICED') { held.push({ studyId: s.publicStudyId, imageCount: s.instanceCount, reason: d.reason }); continue }
    const matches = before.transactions.filter(t => t.studyId === s.id || t.processingJobId === s.id || (r.studyId && t.studyId === r.studyId) || (s.processingJobId && t.processingJobId === s.processingJobId) || ((t.metadata as Record<string, unknown> | null)?.studyUid === s.studyInstanceUid))
    if (matches.some(t => t.invoiceId || t.status === 'INVOICED')) { previouslyInvoiced.push({ studyId: s.publicStudyId, expectedMinor: d.amountMinor, transactions: matches.map(t => ({ id: t.id, invoiceId: t.invoiceId, amountMinor: t.amountMinor, status: t.status })) }); continue }
    if (matches.length > 1 || matches.some(t => !editableBillingStatuses.includes(t.status))) { held.push({ studyId: s.publicStudyId, imageCount: s.instanceCount, reason: 'Multiple or immutable billing transactions require reconciliation.' }); continue }
    const existing = matches[0]
    const decision = { ...d, sourceSha256: config.sourceSha256, reportReviewId: r.id }
    const data = tariffTransactionData(decision, { ...(existing?.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}), studyUid: s.studyInstanceUid, publicStudyId: s.publicStudyId, billingPeriod: `${year}-${String(month).padStart(2, '0')} IST received`, imageCount: s.instanceCount, viewSource: 'IMAGE_COUNT' })
    planned.push({ publicStudyId: s.publicStudyId, studyId: r.studyId, processingJobId: s.processingJobId, serviceName: r.serviceName, existingId: existing?.id ?? null, id: existing?.id ?? randomUUID(), decision, data })
  }
  const gross = planned.reduce((sum, p) => sum + p.decision.amountMinor, 0)
  if (new Set(planned.map(p => p.id)).size !== planned.length) throw new Error('A transaction matches multiple studies; reconciliation required')
  if (!Number.isSafeInteger(gross) || gross > 2147483647) throw new Error('Invoice amount exceeds supported range')
  const discountPercent = Math.min(100, Math.max(0, before.client.billingDiscountPercent))
  const discount = Math.round(gross * discountPercent / 100)
  const subtotal = gross - discount
  const tax = Math.round(subtotal * gst.sgst / 100) + Math.round(subtotal * gst.cgst / 100)
  const summary = { invoiceNumber: number, studies: planned.length, newTransactions: planned.filter(p => !p.existingId).length, updatedTransactions: planned.filter(p => p.existingId).length, notReported, held, previouslyInvoiced, grossMinor: gross, discountPercent, discountMinor: discount, subtotalMinor: subtotal, taxMinor: tax, totalMinor: subtotal + tax, gst }
  writeFileSync(output, encode({ mode: apply ? 'APPLY' : 'PREVIEW', summary, planned }))
  console.log(encode({ ...summary, held: summary.held.length, previouslyInvoiced: summary.previouslyInvoiced.length }))
  if (!apply || !planned.length) return
  mkdirSync('billing-backups', { recursive: true })
  const backup = resolve('billing-backups', `before-image-invoice-${Date.now()}.json`)
  writeFileSync(backup, encode({ before, summary, planned }), { flag: 'wx' })
  const result = await prisma.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${clientId}`}))`
    if (hash(await snapshot(db)) !== hash(before)) throw new Error('Source records changed after preview; retry required.')
    if (await db.invoice.findUnique({ where: { invoiceNumber: number } })) throw new Error('Invoice was concurrently created')
    await db.systemSetting.upsert({ where: { key: tariffSettingKey(clientId) }, create: { key: tariffSettingKey(clientId), value: config as unknown as Prisma.InputJsonValue }, update: { value: config as unknown as Prisma.InputJsonValue } })
    const invoice = await db.invoice.create({ data: { clientId, invoiceNumber: number, periodStart: start, periodEnd: new Date(end.getTime() - 1), status: 'DRAFT', currency: 'INR', subtotalMinor: subtotal, taxMinor: tax, totalMinor: subtotal + tax } })
    const newRows: Prisma.StudyBillingTransactionCreateManyInput[] = []
    for (const p of planned) {
      const data = { ...p.data, invoiceId: invoice.id, status: 'INVOICED' }
      if (p.existingId) await db.studyBillingTransaction.update({ where: { id: p.existingId }, data })
      else newRows.push({ id: p.id, clientId, studyId: p.studyId, processingJobId: p.processingJobId, serviceName: p.serviceName, workflowType: 'TELERADIOLOGY_ONLY', ...data })
    }
    if (newRows.length) await db.studyBillingTransaction.createMany({ data: newRows })
    const parts = new Map<string, { units: number; rate: number }>()
    for (const p of planned) for (const b of p.decision.breakdown) {
      const current = parts.get(b.key) ?? { units: 0, rate: b.rateMinor }
      current.units += b.units
      parts.set(b.key, current)
    }
    const lines: Prisma.InvoiceLineItemCreateManyInput[] = [...parts].map(([key, value]) => {
      const row = config.rows.find(r => r.key === key)!
      return { invoiceId: invoice.id, serviceName: `${row.modality} ${row.bodyPart}`, description: `${row.studies} (${row.unit})`, units: value.units, unitPriceMinor: value.rate, amountMinor: value.units * value.rate, currency: 'INR', metadata: { tariffKey: key, viewSource: 'IMAGE_COUNT', sourceSha256: config.sourceSha256 } }
    })
    if (discount) lines.push({ invoiceId: invoice.id, serviceName: 'Billing discount', description: `Configured client discount ${discountPercent}%`, units: 1, unitPriceMinor: -discount, amountMinor: -discount, currency: 'INR' })
    await db.invoiceLineItem.createMany({ data: lines })
    if (lines.reduce((sum, l) => sum + l.amountMinor, 0) !== subtotal) throw new Error('Invoice lines do not reconcile')
    const linked = await db.studyBillingTransaction.findMany({ where: { invoiceId: invoice.id } })
    if (linked.length !== planned.length || linked.reduce((sum, t) => sum + t.amountMinor, 0) !== gross) throw new Error('Invoice transactions do not reconcile')
    await db.auditLog.create({ data: { clientId, action: 'MARENGO_REPORTED_IMAGE_COUNT_INVOICE', metadata: { invoiceId: invoice.id, invoiceNumber: number, studyCount: planned.length, sourceSha256: config.sourceSha256, viewSource: 'IMAGE_COUNT', backup, subtotalMinor: subtotal, totalMinor: subtotal + tax } } })
    return db.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lineItems: true, transactions: true } })
  }, { timeout: 120000, isolationLevel: 'Serializable' })
  writeFileSync(output, encode({ summary, invoice: result }))
  console.log(`Created and verified DRAFT invoice ${number}; ${planned.length} Reported studies. Backup: ${backup}`)
}
async function legacySnapshot(db: Prisma.TransactionClient) {
  const legacyInvoices = await db.invoice.findMany({ where: { clientId, NOT: { invoiceNumber: { contains: '-IMAGES-' } } }, include: { transactions: true, lineItems: true, payments: true, paymentLinks: true } })
  const unlinkedTransactions = await db.studyBillingTransaction.findMany({ where: { clientId, invoiceId: null, status: { in: editableBillingStatuses } }, orderBy: { id: 'asc' } })
  const legacyStudies = await db.study.findMany({ where: { clientId, id: { in: [...legacyInvoices.flatMap(i => i.transactions), ...unlinkedTransactions].map(t => t.studyId).filter((s): s is string => !!s) } }, select: { id: true, studyUid: true } })
  const legacyReports = await db.reportReview.findMany({ where: { clientId }, select: { id: true, studyId: true, studyUid: true, serviceName: true, status: true, updatedAt: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] })
  const legacyBridge = await db.availableBridgeStudy.findMany({ where: { clientId }, select: { id: true, publicStudyId: true, studyInstanceUid: true, studyDescription: true, modalities: true, instanceCount: true, processingJobId: true, firstDetectedAt: true, createdAt: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] })
  return { legacyInvoices, legacyStudies, legacyReports, legacyBridge, unlinkedTransactions }
}
async function run() {
  if (!allMonths) return main()
  const received = await prisma.availableBridgeStudy.findMany({ where: { clientId }, select: { firstDetectedAt: true, createdAt: true } })
  const periods = [...new Set(received.map(s => new Date((s.firstDetectedAt ?? s.createdAt).getTime() + 330 * 60_000).toISOString().slice(0, 7)))].sort()
  const existingInvoices = await prisma.invoice.findMany({ where: { clientId }, select: { id: true, invoiceNumber: true, periodStart: true, periodEnd: true, status: true, subtotalMinor: true, taxMinor: true, totalMinor: true, paidAt: true, issuedAt: true, _count: { select: { transactions: true, payments: true, paymentLinks: true } } }, orderBy: { periodStart: 'asc' } })
  const legacySource = await legacySnapshot(prisma)
  const { legacyInvoices, legacyStudies, legacyReports, legacyBridge, unlinkedTransactions } = legacySource
  const audit = [...legacyInvoices, { id: 'UNLINKED', invoiceNumber: 'UNLINKED', status: 'UNINVOICED', totalMinor: 0, transactions: unlinkedTransactions }].map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, status: i.status, totalMinor: i.totalMinor, transactions: i.transactions.map(t => {
    const uid = legacyStudies.find(s => s.id === t.studyId)?.studyUid || (t.metadata as any)?.studyUid
    const bridge = legacyBridge.find(s => (uid && s.studyInstanceUid === uid) || s.id === t.studyId || s.id === t.processingJobId || (t.processingJobId && s.processingJobId === t.processingJobId))
    const effectiveUid = uid || bridge?.studyInstanceUid
    const report = legacyReports.find(r => (effectiveUid && r.studyUid === effectiveUid) || (t.studyId && r.studyId === t.studyId))
    const decision = priceReportedStudy(config, { reportStatus: report?.status, description: bridge?.studyDescription ?? '', modalities: bridge?.modalities ?? [], serviceName: report?.serviceName ?? t.serviceName, imageCount: bridge?.instanceCount })
    return { id: t.id, status: t.status, amountMinor: t.amountMinor, studyId: t.studyId, uid, bridge, report, decision }
  }) }))
  const legacyAudit = audit.filter(i => i.id !== 'UNLINKED')
  const unlinkedAudit = audit.find(i => i.id === 'UNLINKED')!.transactions
  const legacyChanges = legacyAudit.filter(i => i.transactions.some(t => t.amountMinor !== t.decision.amountMinor || t.decision.status !== 'UNINVOICED'))
  const unlinkedChanges = unlinkedAudit.filter(t => t.amountMinor !== t.decision.amountMinor || t.status !== t.decision.status)
  if (apply && (legacyChanges.length || unlinkedChanges.length)) {
    for (const change of legacyChanges) {
      const invoice = legacyInvoices.find(i => i.id === change.id)!
      if (invoice.status !== 'DRAFT' || invoice.issuedAt || invoice.paidAt || invoice.paymentUrl || invoice.razorpayPaymentLinkId || invoice.payments.length || invoice.paymentLinks.length) throw new Error(`Issued or paid invoice requires separate reconciliation: ${invoice.invoiceNumber}`)
    }
    mkdirSync('billing-backups', { recursive: true })
    const backup = resolve('billing-backups', `before-all-months-legacy-${Date.now()}.json`)
    writeFileSync(backup, encode({ legacySource, legacyAudit, unlinkedAudit }), { flag: 'wx' })
    await prisma.$transaction(async db => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${clientId}`}))`
      if (hash(await legacySnapshot(db)) !== hash(legacySource)) throw new Error('Legacy invoice sources changed; retry required')
      for (const t of unlinkedChanges) {
        const old = unlinkedTransactions.find(row => row.id === t.id)!
        const data = tariffTransactionData({ ...t.decision, sourceSha256: config.sourceSha256, reportReviewId: t.report?.id ?? null }, { ...(old.metadata as object), reconciliationReason: 'All-months Reported-only Marengo tariff correction' })
        await db.studyBillingTransaction.update({ where: { id: t.id }, data })
      }
      if (unlinkedChanges.length) await db.auditLog.create({ data: { clientId, action: 'MARENGO_ALL_MONTHS_UNLINKED_RECONCILIATION', metadata: { transactionIds: unlinkedChanges.map(t => t.id), backup, sourceSha256: config.sourceSha256 } } })
      for (const change of legacyChanges) {
        // Rebuild only unissued, unpaid draft invoices from verified tariff decisions.
        let gross = 0
        const lines: Prisma.InvoiceLineItemCreateManyInput[] = []
        for (const t of change.transactions) {
          const old = legacyInvoices.find(i => i.id === change.id)!.transactions.find(row => row.id === t.id)!
          const eligible = t.decision.status === 'UNINVOICED'
          const data = tariffTransactionData({ ...t.decision, sourceSha256: config.sourceSha256, reportReviewId: t.report?.id ?? null }, { ...(old.metadata as object), priorInvoiceId: change.id, reconciliationReason: 'All-months Reported-only Marengo tariff correction' })
          await db.studyBillingTransaction.update({ where: { id: t.id }, data: { ...data, status: eligible ? 'INVOICED' : t.decision.status, invoiceId: eligible ? change.id : null } })
          if (eligible) for (const part of t.decision.breakdown) {
            gross += part.units * part.rateMinor
            const row = config.rows.find(r => r.key === part.key)!
            lines.push({ invoiceId: change.id, serviceName: `${row.modality} ${row.bodyPart}`, description: `${row.studies} (${row.unit})`, units: part.units, unitPriceMinor: part.rateMinor, amountMinor: part.units * part.rateMinor, currency: 'INR', metadata: { tariffKey: row.key, sourceSha256: config.sourceSha256 } })
          }
        }
        const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { billingDiscountPercent: true } })
        const discount = Math.round(gross * Math.min(100, Math.max(0, client.billingDiscountPercent)) / 100)
        const subtotal = gross - discount
        if (discount) lines.push({ invoiceId: change.id, serviceName: 'Billing discount', description: 'Configured client discount', units: 1, unitPriceMinor: -discount, amountMinor: -discount, currency: 'INR' })
        const tax = Math.round(subtotal * gst.sgst / 100) + Math.round(subtotal * gst.cgst / 100)
        await db.invoiceLineItem.deleteMany({ where: { invoiceId: change.id } })
        if (lines.length) await db.invoiceLineItem.createMany({ data: lines })
        await db.invoice.update({ where: { id: change.id }, data: { subtotalMinor: subtotal, taxMinor: tax, totalMinor: subtotal + tax } })
        await db.auditLog.create({ data: { clientId, action: 'MARENGO_ALL_MONTHS_DRAFT_RECONCILIATION', metadata: { invoiceId: change.id, backup, sourceSha256: config.sourceSha256, subtotalMinor: subtotal, totalMinor: subtotal + tax } } })
      }
    }, { isolationLevel: 'Serializable', timeout: 120000 })
    console.log(`Corrected ${legacyChanges.length} legacy draft invoice(s) and ${unlinkedChanges.length} uninvoiced transaction(s); backup: ${backup}`)
  }
  const results: unknown[] = []
  for (const period of periods) {
    const [y, m] = period.split('-').map(Number)
    setPeriod(y, m)
    output = requestedOutput.replace(/\.json$/, `-${period}.json`)
    await main()
    const result = JSON.parse(readFileSync(output, 'utf8'))
    results.push({ period, output, ...(result.summary ? { summary: result.summary } : { alreadyExists: true, invoiceNumber: result.invoice.invoiceNumber, status: result.invoice.status, studies: result.invoice.transactions.length, totalMinor: result.invoice.totalMinor }) })
    writeFileSync(requestedOutput, encode({ mode: apply ? 'APPLY' : 'PREVIEW', clientId, existingInvoices, legacyAudit, unlinkedAudit, results }))
  }
  const invoices = await prisma.invoice.findMany({ where: { clientId }, include: { transactions: true, lineItems: true }, orderBy: { periodStart: 'asc' } })
  const source = await legacySnapshot(prisma)
  const seenBilled = new Set<string>()
  const issues: string[] = []
  for (const invoice of invoices) {
    const amount = invoice.transactions.reduce((sum, t) => sum + t.amountMinor, 0)
    const lineAmount = invoice.lineItems.reduce((sum, t) => sum + t.amountMinor, 0)
    const discount = invoice.lineItems.filter(l => l.amountMinor < 0).reduce((sum, l) => sum + l.amountMinor, 0)
    if (amount + discount !== invoice.subtotalMinor || lineAmount !== invoice.subtotalMinor || invoice.subtotalMinor + invoice.taxMinor !== invoice.totalMinor) issues.push(`Totals mismatch: ${invoice.invoiceNumber}`)
    for (const t of invoice.transactions) {
      const meta = t.metadata as any
      const referenced = source.legacyReports.find(r => r.id === meta?.clientTariff?.reportReviewId)
      const latest = referenced?.studyUid ? source.legacyReports.find(r => r.studyUid === referenced.studyUid) : undefined
      const bridge = source.legacyBridge.find(s => s.studyInstanceUid === latest?.studyUid)
      if (!latest || !bridge) { issues.push(`Missing billing evidence: ${t.id}`); continue }
      const d = priceReportedStudy(config, { reportStatus: latest.status, description: bridge.studyDescription ?? '', modalities: bridge.modalities, serviceName: latest.serviceName, imageCount: bridge.instanceCount })
      if (d.status !== 'UNINVOICED' || d.amountMinor !== t.amountMinor || t.status !== 'INVOICED') issues.push(`Tariff or status mismatch: ${t.id}`)
      const uid = bridge.studyInstanceUid
      if (seenBilled.has(uid)) issues.push(`Duplicate billed study: ${bridge.publicStudyId}`)
      seenBilled.add(uid)
    }
  }
  writeFileSync(requestedOutput, encode({ mode: apply ? 'APPLY' : 'PREVIEW', clientId, existingInvoices, legacyAudit, unlinkedAudit, results, verification: { passed: issues.length === 0, billedStudies: seenBilled.size, issues }, invoices }))
  console.log(encode({ verified: issues.length === 0, billedStudies: seenBilled.size, issues, invoices: invoices.map(i => ({ invoiceNumber: i.invoiceNumber, studies: i.transactions.length, status: i.status, totalMinor: i.totalMinor })) }))
  if (apply && issues.length) throw new Error('Post-write invoice verification needs attention; see output issues')
}
run().catch(error => { console.error(error instanceof Error ? error.message : 'Invoice failed'); process.exitCode = 1 }).finally(() => prisma.$disconnect())
