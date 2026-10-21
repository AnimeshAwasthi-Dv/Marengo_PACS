import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../server/db'
import { parseClientTariff, resolveClientTariff, tariffSettingKey, tariffTransactionData, editableBillingStatuses, priceReportedStudy } from '../server/clientTariff'

// Explicitly scoped to the center and September IST period requested by the user.
const clientId = 'cmsrytf3n002nsv58h95wlj0l'
const year = Number(process.argv.find(a => a.startsWith('--year='))?.slice(7) ?? 2026)
const month = Number(process.argv.find(a => a.startsWith('--month='))?.slice(8) ?? 9)
if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error('Invalid reporting period')
const start = new Date(Date.UTC(year, month - 1, 1) - 19800000)
const end = new Date(Date.UTC(year, month, 1) - 19800000)
const config = parseClientTariff(JSON.parse(readFileSync(new URL('../data/marengo-tariff.json', import.meta.url), 'utf8')))
const apply = process.argv.includes('--apply')
const exportOnly = process.argv.includes('--export-reported')
const output = resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) ?? 'marengo-september-correction.json')
const json = (value: unknown) => JSON.stringify(value, null, 2)
const fingerprint = (value: unknown) => createHash('sha256').update(json(value)).digest('hex')

async function main() {
  if (!exportOnly && (year !== 2026 || month !== 9)) throw new Error('Database correction is restricted to September 2026.')
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } })
  if (client.code !== 'MARENGO_AHMEDABAD') throw new Error('Unexpected client identity; aborting.')
  if (exportOnly) {
    const studies = await prisma.availableBridgeStudy.findMany({ where: { clientId, OR: [{ firstDetectedAt: { gte: start, lt: end } }, { firstDetectedAt: null, createdAt: { gte: start, lt: end } }] }, select: { id: true, publicStudyId: true, studyInstanceUid: true, studyDescription: true, modalities: true, processingJobId: true, patientId: true, patientName: true, patientAge: true, patientSex: true, studyDate: true, patientProfile: { select: { clientId: true, patientIdentifier: true, name: true, age: true, sex: true, gender: true, dateOfBirth: true } }, accessionNumber: true, firstDetectedAt: true, createdAt: true, instanceCount: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] })
    const activeTariff = await prisma.systemSetting.findUnique({ where: { key: tariffSettingKey(clientId) } })
    if (!activeTariff) throw new Error('No Marengo tariff configured in this database; run the correction first.')
    const reportTariff = parseClientTariff(activeTariff.value)
    const reports = await prisma.reportReview.findMany({ where: { clientId, studyUid: { in: studies.map(s => s.studyInstanceUid) } }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], select: { id: true, studyUid: true, studyId: true, status: true, serviceName: true, patientName: true, approvedAt: true, pushedAt: true } })
    const latestReports = new Map<string, typeof reports[number]>()
    for (const r of reports) if (r.studyUid && !latestReports.has(r.studyUid)) latestReports.set(r.studyUid, r)
    const seen = new Set<string>()
    const report = []
    for (const study of studies) {
      const uid = study.studyInstanceUid || study.id
      if (seen.has(uid)) continue
      seen.add(uid)
      const latest = latestReports.get(study.studyInstanceUid)
      const decision = priceReportedStudy(reportTariff, { reportStatus: latest?.status, description: study.studyDescription ?? '', modalities: study.modalities, serviceName: latest?.serviceName ?? '', imageCount: study.instanceCount })
      if (decision?.status === 'PENDING_REPORT') continue
      report.push({ study, decision, report: latest })
    }
    const transactions = await prisma.studyBillingTransaction.findMany({ where: { clientId, OR: [{ createdAt: { gte: start, lt: end } }, { studyId: { in: report.flatMap(r => r.report?.studyId ? [r.report.studyId] : []) } }, { invoice: { is: { clientId, periodStart: { gte: start, lt: end } } } }] } })
    const invoices = await prisma.invoice.findMany({ where: { clientId, periodStart: { gte: start, lt: end } }, include: { lineItems: true } })
    writeFileSync(output, json({ client: { id: client.id, name: client.name }, start, end, sourceSha256: reportTariff.sourceSha256, studies: report, transactions, invoices, tariff: reportTariff, totalReceived: seen.size }))
    console.log(`Exported ${report.length} Reported studies to ${output}`)
    return
  }
  const where = { clientId, createdAt: { gte: start, lt: end } }
  const before = await prisma.studyBillingTransaction.findMany({ where, orderBy: { id: 'asc' } })
  if (before.some(t => t.invoiceId || !editableBillingStatuses.includes(t.status))) throw new Error('Period includes invoiced/immutable transactions; refusing automatic correction.')
  const globalRules = await prisma.pricingRule.findMany({ orderBy: { id: 'asc' } })
  const previousSetting = await prisma.systemSetting.findUnique({ where: { key: tariffSettingKey(clientId) } })
  const changes = []
  for (const t of before) {
    const decision = await resolveClientTariff(prisma, t, config)
    if (!decision) throw new Error('Missing decision')
    changes.push({ id: t.id, before: t, after: tariffTransactionData(decision, t.metadata), decision })
  }
  const counts: Record<string, number> = {}
  for (const c of changes) counts[c.after.status] = (counts[c.after.status] ?? 0) + 1
  const plan = { clientId, clientName: client.name, start, end, sourceSha256: config.sourceSha256, previousSetting, counts, previousAmountMinor: before.reduce((s,t) => s+t.amountMinor,0), correctedAmountMinor: changes.reduce((s,c) => s+c.after.amountMinor,0), changes }
  writeFileSync(output, json(plan))
  console.log(json({ mode: apply ? 'APPLY' : 'DRY RUN', count: changes.length, counts, previousAmountMinor: plan.previousAmountMinor, correctedAmountMinor: plan.correctedAmountMinor, plan: output }))
  if (!apply) return
  const backupDir = resolve('billing-backups')
  mkdirSync(backupDir, { recursive: true })
  const backup = resolve(backupDir, `marengo-september-before-${Date.now()}.json`)
  writeFileSync(backup, json(plan), { flag: 'wx' })
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${clientId}`}))`
    await tx.$queryRaw`SELECT id FROM study_billing_transactions WHERE "clientId"=${clientId} AND "createdAt">=${start} AND "createdAt"<${end} FOR UPDATE`
    const current = await tx.studyBillingTransaction.findMany({ where, orderBy: { id: 'asc' } })
    if (fingerprint(current) !== fingerprint(before)) throw new Error('Billing rows changed after preview; aborting.')
    const settingNow = await tx.systemSetting.findUnique({ where: { key: tariffSettingKey(clientId) } })
    if (fingerprint(settingNow) !== fingerprint(previousSetting)) throw new Error('Tariff setting changed after preview; aborting.')
    for (const c of changes) {
      const checked = await resolveClientTariff(tx, c.before, config)
      if (fingerprint(checked) !== fingerprint(c.decision)) throw new Error('Report or study details changed after preview; aborting.')
      await tx.studyBillingTransaction.update({ where: { id: c.id }, data: c.after })
    }
    await tx.systemSetting.upsert({ where: { key: tariffSettingKey(clientId) }, create: { key: tariffSettingKey(clientId), value: config as unknown as Prisma.InputJsonValue }, update: { value: config as unknown as Prisma.InputJsonValue } })
    await tx.auditLog.create({ data: { id: randomUUID(), clientId, action: 'MARENGO_CSV_TARIFF_REPORTED_ONLY_CORRECTION', metadata: { sourceSha256: config.sourceSha256, start: start.toISOString(), end: end.toISOString(), transactionCount: changes.length, counts, previousAmountMinor: plan.previousAmountMinor, correctedAmountMinor: plan.correctedAmountMinor, backupFile: backup, globalPricingRulesChanged: false } } })
    const saved = await tx.studyBillingTransaction.findMany({ where, orderBy: { id: 'asc' } })
    for (const c of changes) {
      const actual = saved.find(t => t.id === c.id)
      if (!actual || ['status','units','unitPriceMinor','amountMinor','currency'].some(k => actual[k as keyof typeof actual] !== c.after[k as keyof typeof c.after])) throw new Error('Database verification failed; rolling back.')
    }
    if (fingerprint(await tx.pricingRule.findMany({ orderBy: { id: 'asc' } })) !== fingerprint(globalRules)) throw new Error('Shared pricing changed during correction; rolling back.')
  }, { timeout: 120000, isolationLevel: 'Serializable' })
  console.log(`Committed and verified. Original rows and setting backed up to ${backup}`)
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Correction failed'); process.exitCode = 1 }).finally(() => prisma.$disconnect())
