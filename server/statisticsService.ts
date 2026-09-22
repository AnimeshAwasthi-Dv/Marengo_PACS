import type { PrismaClient } from '@prisma/client'

export type StatisticsScope = { clientIds: string[]; start: Date; end: Date; modality?: string; status?: string }

export async function getStudyUsageStatistics(db: PrismaClient, scope: StatisticsScope) {
  const where = { clientId: { in: scope.clientIds }, createdAt: { gte: scope.start, lt: scope.end } }
  const jobs = await db.processingJob.findMany({ where, select: { id: true, clientId: true, status: true, createdAt: true, completedAt: true, serviceName: true, dicomMetadata: true } })
  const filtered = jobs.filter((job) => (!scope.modality || `${job.serviceName} ${JSON.stringify(job.dicomMetadata)}`.toUpperCase().includes(scope.modality.toUpperCase())) && (!scope.status || job.status.toUpperCase() === scope.status.toUpperCase()))
  const completed = filtered.filter((job) => ['SUCCESS', 'COMPLETED', 'SENT_TO_PACS'].includes(job.status.toUpperCase()))
  const failed = filtered.filter((job) => job.status.toUpperCase() === 'FAILED')
  const processingTimes = completed.map((job) => job.completedAt ? job.completedAt.getTime() - job.createdAt.getTime() : 0).filter((value) => value > 0)
  return {
    start: scope.start.toISOString(), end: scope.end.toISOString(), modality: scope.modality ?? null,
    totalStudies: filtered.length, completed: completed.length, failed: failed.length,
    processing: filtered.filter((job) => job.status.toUpperCase() === 'PROCESSING').length,
    queued: filtered.filter((job) => job.status.toUpperCase() === 'QUEUED').length,
    completionRate: filtered.length ? Number(((completed.length / filtered.length) * 100).toFixed(2)) : 0,
    averageProcessingMinutes: processingTimes.length ? Number((processingTimes.reduce((sum, value) => sum + value, 0) / processingTimes.length / 60000).toFixed(2)) : null,
  }
}

export async function getReportingStatistics(db: PrismaClient, scope: StatisticsScope) {
  const reports = await db.reportReview.findMany({ where: { clientId: { in: scope.clientIds }, createdAt: { gte: scope.start, lt: scope.end }, ...(scope.modality ? { modality: { equals: scope.modality, mode: 'insensitive' as const } } : {}) }, select: { status: true, generatedAt: true, approvedAt: true, clientId: true } })
  const completed = reports.filter((report) => ['APPROVED', 'PUSHED'].includes(report.status))
  const tats = completed.map((report) => report.approvedAt ? report.approvedAt.getTime() - report.generatedAt.getTime() : 0).filter((value) => value > 0)
  return { start: scope.start.toISOString(), end: scope.end.toISOString(), generated: reports.length, completed: completed.length, reviewed: reports.filter((report) => report.status !== 'PENDING').length, pending: reports.filter((report) => ['PENDING', 'IN_REVIEW', 'SAVED'].includes(report.status)).length, averageReportingTatMinutes: tats.length ? Number((tats.reduce((sum, value) => sum + value, 0) / tats.length / 60000).toFixed(2)) : null }
}

export async function getBillingStatistics(db: PrismaClient, scope: StatisticsScope) {
  const rows = await db.studyBillingTransaction.findMany({ where: { clientId: { in: scope.clientIds }, createdAt: { gte: scope.start, lt: scope.end } }, select: { clientId: true, amountMinor: true, currency: true, units: true } })
  return { start: scope.start.toISOString(), end: scope.end.toISOString(), transactionCount: rows.length, units: rows.reduce((sum, row) => sum + row.units, 0), amountMinor: rows.reduce((sum, row) => sum + row.amountMinor, 0), currency: rows[0]?.currency ?? 'INR' }
}

export async function getCenterStatistics(db: PrismaClient, scope: StatisticsScope) {
  const clients = await db.client.findMany({ where: { id: { in: scope.clientIds } }, select: { id: true, code: true, name: true } })
  return Promise.all(clients.map(async (client) => ({ client, usage: await getStudyUsageStatistics(db, { ...scope, clientIds: [client.id] }), reporting: await getReportingStatistics(db, { ...scope, clientIds: [client.id] }), billing: await getBillingStatistics(db, { ...scope, clientIds: [client.id] }) })))
}

export function statisticsDateRange(query: Record<string, unknown>) {
  const now = new Date()
  const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const start = query.start ? new Date(String(query.start)) : defaultStart
  const end = query.end ? new Date(String(query.end)) : new Date(now.getTime() + 1)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) throw new Error('Invalid statistics date range')
  if (end.getTime() - start.getTime() > 3 * 366 * 24 * 60 * 60 * 1000) throw new Error('Statistics date range cannot exceed three years')
  return { start, end }
}
