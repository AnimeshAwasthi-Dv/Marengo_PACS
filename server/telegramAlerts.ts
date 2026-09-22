import { prisma } from './db';
import { studyTracking } from './studyTracking';
import { telegramCenterIds, TELEGRAM_ALERT_EVENT } from './telegram';
import { studyTatCategory, tatTargetSeconds, telegramAlertConfig, tatAlertDue } from './telegramPolicy';

let scanning = false;
let cursor: string | undefined;
export async function enqueueTatAlerts({ config = telegramAlertConfig(), db = prisma, track = studyTracking } = {}) {
  if (scanning || !config.enabled || config.missing.length) return;
  scanning = true;
  try {
    const clientIds = await telegramCenterIds(config, db);
    // Advance a bounded cursor so older jobs cannot starve newer studies.
    const jobs = await db.processingJob.findMany({ where: { clientId: { in: clientIds }, demoMode: false, status: { notIn: ['completed', 'sent_to_pacs', 'report_delivered', 'cancelled'] } }, include: { bridgeStudy: true }, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const job of jobs) {
      const category = studyTatCategory(job.bridgeStudy?.modalities[0] ?? job.serviceType, job.serviceType, job.bridgeStudy?.studyDescription);
      if (!tatAlertDue({ completedAt: null, processingStatus: job.status, startedAt: (job.bridgeStudy?.submittedAt ?? job.createdAt).toISOString(), targetSeconds: tatTargetSeconds(category, job.priority) }, config.leadMinutes)) continue;
      const idempotencyKey = `telegram:tat-alert:${job.id}`;
      if (await db.notificationOutbox.findUnique({ where: { idempotencyKey }, select: { id: true } })) continue;
      const tracking = await track(job.id, clientIds, db);
      if (!tracking || !tatAlertDue(tracking, config.leadMinutes)) continue;
      await db.notificationOutbox.upsert({ where: { idempotencyKey }, update: {}, create: {
        eventType: TELEGRAM_ALERT_EVENT, aggregateType: 'ProcessingJob', aggregateId: job.id, idempotencyKey,
        payload: { clientId: job.clientId, chatId: config.chatId, leadMinutes: config.leadMinutes },
      } });
    }
    cursor = jobs.length === 100 ? jobs[jobs.length - 1].id : undefined;
  } finally { scanning = false; }
}
