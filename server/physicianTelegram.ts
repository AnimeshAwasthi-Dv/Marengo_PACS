import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { sendTelegram, telegramCallbackConfig, TelegramDeliveryError } from './telegramPolicy';
import { nonOverlapping } from './runtime/tasks';

export const processPhysicianTelegramOutbox = nonOverlapping(async () => {
  const config = telegramCallbackConfig();
  if (!config.enabled || config.missing.length) return;
  const centers = config.groupCode ? await prisma.client.findMany({ where: { kind: 'CENTER', status: 'ACTIVE', parentClient: { code: config.groupCode, kind: 'GROUP', status: 'ACTIVE' } }, select: { id: true } }) : [];
  const clientIds = [...config.clientIds, ...centers.map(center => center.id)];
  const now = new Date();
  const rows = await prisma.notificationOutbox.findMany({ where: { eventType: 'TELEGRAM_PHYSICIAN_CALLBACK', status: { in: ['PENDING', 'FAILED', 'SENDING'] }, nextAttemptAt: { lte: now } }, orderBy: { createdAt: 'asc' }, take: 5 });
  for (const row of rows) {
    const claim = await prisma.notificationOutbox.updateMany({ where: { id: row.id, status: row.status, attempts: row.attempts, nextAttemptAt: { lte: now } }, data: { status: 'SENDING', attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 120000) } });
    if (!claim.count) continue;
    const payload = row.payload as Prisma.InputJsonObject;
    try {
      const event = await prisma.notificationEvent.findUnique({ where: { id: row.aggregateId } });
      if (!event || event.eventType !== 'PHYSICIAN_CALL_REQUESTED' || event.status !== 'PENDING' || !event.clientId || !clientIds.includes(event.clientId) || payload.chatId !== config.chatId) {
        await prisma.notificationOutbox.update({ where: { id: row.id }, data: { status: 'DEAD' } });
        continue;
      }
      const url = new URL('/', config.portalUrl).href;
      const messageId = await sendTelegram(config, ['Marengo | Connect to radiologist', event.message, 'Open the portal to handle this request.'].join('\n'), url, fetch, 'Open portal');
      await prisma.notificationOutbox.update({ where: { id: row.id }, data: { status: 'SENT', processedAt: new Date(), payload: { ...payload, messageId } } });
    } catch (error) {
      const code = error instanceof TelegramDeliveryError ? error.code : 0;
      const delay = Math.max(error instanceof TelegramDeliveryError ? error.retryAfter : 0, Math.min(3600, 30 * 2 ** Math.min(row.attempts, 7)));
      await prisma.notificationOutbox.update({ where: { id: row.id }, data: { status: [400,401,403].includes(code) || row.attempts >= 7 ? 'DEAD' : 'FAILED', nextAttemptAt: new Date(Date.now() + delay * 1000) } });
      if (code === 429) break;
    }
    await new Promise(resolve => setTimeout(resolve, 3100));
  }
});
