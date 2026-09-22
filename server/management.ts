import express from 'express'
import { requireAuth } from './auth'
import { prisma } from './db'
import { getBillingStatistics, getCenterStatistics, getReportingStatistics, getStudyUsageStatistics, statisticsDateRange } from './statisticsService'

export const managementRouter = express.Router()
managementRouter.use(requireAuth)

async function managementScope(user: { role: string; clientId?: string; providerCode?: string }) {
  if (user.role === 'SUPER_ADMIN') return (await prisma.client.findMany({ where: { kind: 'CENTER' }, select: { id: true } })).map((item) => item.id)
  if (['PROVIDER_ADMIN', 'PROVIDER_MANAGER'].includes(user.role) && user.providerCode) {
    return (await prisma.reportReview.findMany({ where: { radiologist: { providerCode: user.providerCode } }, select: { clientId: true }, distinct: ['clientId'] })).map((item) => item.clientId)
  }
  if (user.role !== 'CLIENT_USER' || !user.clientId) return null
  const client = await prisma.client.findUnique({ where: { id: user.clientId }, select: { id: true, kind: true, childClients: { select: { id: true } } } })
  if (!client || client.kind !== 'GROUP') return null
  return [client.id, ...client.childClients.map((item) => item.id)]
}

function filters(req: express.Request, clientIds: string[]) {
  const { start, end } = statisticsDateRange(req.query as Record<string, unknown>)
  return { clientIds, start, end, modality: typeof req.query.modality === 'string' ? req.query.modality : undefined, status: typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined }
}

managementRouter.get('/usage', async (req, res) => { const ids = await managementScope(req.user!); if (!ids) return res.status(403).json({ message: 'Management statistics permission required' }); const data = await getStudyUsageStatistics(prisma, filters(req, ids)); await audit(req.user!.sub, 'MANAGEMENT_USAGE_ACCESSED', req.query); res.json(data) })
managementRouter.get('/reporting', async (req, res) => { const ids = await managementScope(req.user!); if (!ids) return res.status(403).json({ message: 'Management reporting permission required' }); const data = await getReportingStatistics(prisma, filters(req, ids)); await audit(req.user!.sub, 'MANAGEMENT_REPORTING_ACCESSED', req.query); res.json(data) })
managementRouter.get('/billing', async (req, res) => { const ids = await managementScope(req.user!); if (!ids) return res.status(403).json({ message: 'Management billing permission required' }); const data = await getBillingStatistics(prisma, filters(req, ids)); await audit(req.user!.sub, 'MANAGEMENT_BILLING_ACCESSED', req.query); res.json(data) })
managementRouter.get('/centers', async (req, res) => { const ids = await managementScope(req.user!); if (!ids) return res.status(403).json({ message: 'Center analytics permission required' }); const data = await getCenterStatistics(prisma, filters(req, ids)); await audit(req.user!.sub, 'MANAGEMENT_CENTER_ANALYTICS_ACCESSED', req.query); res.json(data) })

async function audit(actorUserId: string, action: string, filters: unknown) {
  await prisma.auditLog.create({ data: { actorUserId, action, metadata: JSON.parse(JSON.stringify({ filters })) } })
}
