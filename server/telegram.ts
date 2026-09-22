import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { studyTracking } from './studyTracking';
import { sendTelegram, studyTatCategory, tatTargetSeconds, TelegramDeliveryError, telegramConfig, telegramMessage, telegramAlertConfig, telegramAlertMessage, tatAlertDue } from './telegramPolicy';
import { enqueueTatAlerts } from './telegramAlerts';

export const TELEGRAM_EVENT = 'TELEGRAM_STUDY_PROCESSING';
export const TELEGRAM_ALERT_EVENT = 'TELEGRAM_TAT_ALERT';

export async function telegramCenterIds(config: ReturnType<typeof telegramConfig>, db: Pick<Prisma.TransactionClient, 'client'> = prisma) {
  if (!config.groupCode) return config.clientIds;
  const centers = await db.client.findMany({ where: { kind: 'CENTER', status: 'ACTIVE', parentClient: { code: config.groupCode, kind: 'GROUP', status: 'ACTIVE' } }, select: { id: true } });
  return [...new Set([...config.clientIds, ...centers.map(c => c.id)])];
}

export async function enqueueTelegramStudy(db: Pick<Prisma.TransactionClient, 'notificationOutbox' | 'client'>, job: { id: string; clientId: string; serviceType: string; priority: string | null; demoMode: boolean }, modality?: string, config = telegramConfig(), description?: string | null) {
  if (!config.enabled || job.demoMode) return;
  if (!(await telegramCenterIds(config, db)).includes(job.clientId)) return;
  const tatCategory = studyTatCategory(modality ?? job.serviceType, job.serviceType, description);
  await db.notificationOutbox.upsert({ where: { idempotencyKey: `telegram:processing:${job.id}` }, update: {}, create: {
    eventType: TELEGRAM_EVENT, aggregateType: 'ProcessingJob', aggregateId: job.id, idempotencyKey: `telegram:processing:${job.id}`,
    payload: { clientId: job.clientId, tatCategory, targetSeconds: tatTargetSeconds(tatCategory, job.priority), chatId: config.chatId },
  } });
}

const running = new Set<string>();
export async function processTelegramOutbox({ config = telegramConfig(), db = prisma, track = studyTracking, send = sendTelegram, pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)), eventType = TELEGRAM_EVENT, leadMinutes = 30 } = {}) {
  if (running.has(eventType) || !config.enabled || config.missing.length) return;
  running.add(eventType);
  try {
    const clientIds = await telegramCenterIds(config, db);
    const now = new Date();
    const due = await db.notificationOutbox.findMany({ where: { eventType, status: { in: ['PENDING', 'FAILED', 'SENDING'] }, nextAttemptAt: { lte: now } }, orderBy: { createdAt: 'asc' }, take: 5 });
    for (const item of due) {
      // Conditional lease prevents two API processes from delivering the same row concurrently.
      const claim = await db.notificationOutbox.updateMany({ where: { id: item.id, status: item.status, attempts: item.attempts, nextAttemptAt: { lte: now } }, data: { status: 'SENDING', attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 120000) } });
      if (!claim.count) continue;
      const payload = item.payload as Prisma.InputJsonObject;
      try {
        const tracking = await track(item.aggregateId, clientIds);
        if (!tracking || payload.chatId !== config.chatId) {
          await db.notificationOutbox.update({ where: { id: item.id }, data: { status: 'DEAD', payload: { ...payload, error: 'Study scope or group configuration changed; review required' } } });
          continue;
        }
        if (eventType === TELEGRAM_ALERT_EVENT && !tatAlertDue(tracking, leadMinutes)) {
          await db.notificationOutbox.update({ where: { id: item.id }, data: tracking.completedAt || /cancel/i.test(tracking.processingStatus)
            ? { status: 'DEAD', payload: { ...payload, error: 'Report finalized or study cancelled; alert suppressed' } }
            : { status: 'PENDING', attempts: { decrement: 1 }, nextAttemptAt: new Date(Date.now() + 60000) } });
          continue;
        }
        const message = eventType === TELEGRAM_ALERT_EVENT ? telegramAlertMessage(tracking, config.portalUrl) : telegramMessage(tracking, config.portalUrl);
        const messageId = await send(config, message.text, message.url);
        await db.notificationOutbox.update({ where: { id: item.id }, data: { status: 'SENT', processedAt: new Date(), payload: { ...payload, messageId } } });
      } catch (error) {
        const code = error instanceof TelegramDeliveryError ? error.code : 0;
        const delay = Math.max(error instanceof TelegramDeliveryError ? error.retryAfter : 0, Math.min(3600, 30 * 2 ** Math.min(item.attempts, 7)));
        await db.notificationOutbox.update({ where: { id: item.id }, data: { status: [400, 401, 403].includes(code) || item.attempts >= 7 ? 'DEAD' : 'FAILED', nextAttemptAt: new Date(Date.now() + delay * 1000), payload: { ...payload, error: `Delivery unsuccessful (code ${code}); no clinical pipeline changes` } } });
        // Rate limits apply to the bot/group, not only this one study.
        if (code === 429) {
          await db.notificationOutbox.updateMany({ where: { eventType, status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lt: new Date(Date.now() + delay * 1000) } }, data: { nextAttemptAt: new Date(Date.now() + delay * 1000) } });
          break;
        }
      }
      await pause(3100);
    }
  } finally { running.delete(eventType); }
}

export function startTelegramWorker() {
  const tick = () => void processTelegramOutbox().catch(() => console.warn('Telegram queue unavailable; delivery will retry.'));
  tick();
  setInterval(tick, 10000).unref();
  const alerts = () => {
    const config = telegramAlertConfig();
    void enqueueTatAlerts({ config }).then(() => processTelegramOutbox({ config, eventType: TELEGRAM_ALERT_EVENT, leadMinutes: config.leadMinutes })).catch(() => console.warn('Telegram TAT alerts unavailable; will retry.'));
  };
  alerts();
  setInterval(alerts, 30000).unref();
}
