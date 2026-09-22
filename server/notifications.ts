import express from 'express'
import { z } from 'zod'
import { requireAuth } from './auth'
import { prisma } from './db'

export const notificationsRouter = express.Router()
notificationsRouter.use(requireAuth)

notificationsRouter.get('/', async (req, res) => {
  const unread = String(req.query.unread ?? '') === 'true'
  const category = String(req.query.category ?? '').trim().toUpperCase()
  const deliveries = await prisma.notificationDelivery.findMany({
    where: {
      recipientUserId: req.user!.sub,
      channel: 'IN_APP',
      ...(unread ? { readAt: null } : {}),
      ...(category ? { event: { category } } : {}),
    },
    include: { event: true },
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, Math.max(1, Number(req.query.limit ?? 100))),
  })
  res.json(deliveries)
})

notificationsRouter.get('/unread-count', async (req, res) => {
  const count = await prisma.notificationDelivery.count({ where: { recipientUserId: req.user!.sub, channel: 'IN_APP', readAt: null } })
  res.json({ count })
})

notificationsRouter.patch('/read-all', async (req, res) => {
  const result = await prisma.notificationDelivery.updateMany({
    where: { recipientUserId: req.user!.sub, channel: 'IN_APP', readAt: null },
    data: { readAt: new Date(), status: 'READ' },
  })
  await prisma.auditLog.create({ data: { actorUserId: req.user!.sub, action: 'NOTIFICATIONS_READ_ALL', metadata: { count: result.count } } })
  res.json({ updated: result.count })
})

notificationsRouter.patch('/:deliveryId/read', async (req, res) => {
  z.string().min(1).parse(req.params.deliveryId)
  const existing = await prisma.notificationDelivery.findFirst({ where: { id: String(req.params.deliveryId), recipientUserId: req.user!.sub, channel: 'IN_APP' } })
  if (!existing) return res.status(404).json({ message: 'Notification not found' })
  const updated = await prisma.notificationDelivery.update({ where: { id: existing.id }, data: { readAt: existing.readAt ?? new Date(), status: 'READ' } })
  res.json(updated)
})
