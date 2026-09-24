import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { requireAuth, requireSuperAdmin } from './auth';
import { collectServiceHealth } from './serviceHealth';
import { acknowledgmentReply, HEALTH_INTERVAL_MS, REMINDER_INTERVAL_MS, notedKeyboard, technicalAlertExcluded, technicalAlertText, technicalFailure, type HealthObservation, type TelegramUpdate } from './technicalAlertPolicy';

type Db = Prisma.TransactionClient;
export type TechnicalIncident = { id: string; probeId: string; service: string; center: string; detail: string; status: string; observedStatus: string; openedAt: Date; acknowledgedAt: Date | null; acknowledgedBy: string | null; resolvedAt: Date | null; resolvedBy: string | null; resolution: string | null; lastObservedAt: Date; nextReminderAt: Date; reminderCount: number };
type MonitorState = { lastCheckAt: Date | null; lastTickAt: Date | null; updateOffset: bigint; lastError: string | null; checks: HealthObservation[] };
function config() { return { enabled: process.env.TECH_ALERT_ENABLED === 'true', token: process.env.TECH_ALERT_BOT_TOKEN?.trim(), chatId: process.env.TECH_ALERT_CHAT_ID?.trim() }; }
async function event(db: Db, incidentId: string, kind: string, actor: string, detail: string, chatId: string | null = null, messageId: number | null = null) {
  await db.$executeRaw`INSERT INTO technical_alert_events (id, "incidentId", event, actor, detail, "chatId", "messageId") VALUES (${randomUUID()}, ${incidentId}, ${kind}, ${actor}, ${detail}, ${chatId}, ${messageId})`;
}
class TelegramError extends Error {
  constructor(public code: number, public retryAfter = 0) { super(`Telegram request failed (HTTP/API ${code})`); }
}
async function telegram<T>(method: string, body: object): Promise<T> {
  const token = config().token;
  if (!token) throw new TelegramError(401);
  // Never log the request URL: it contains the bot credential.
  let response: Response;
  try { response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }); }
  catch { throw new TelegramError(0); }
  const result = await response.json().catch(() => ({})) as { ok?: boolean; result?: T; error_code?: number; parameters?: { retry_after?: number } };
  if (!response.ok || !result.ok) throw new TelegramError(result.error_code || response.status, result.parameters?.retry_after);
  return result.result as T;
}

export async function recordTechnicalObservations(db: Db, observations: HealthObservation[], now = new Date()) {
  const active = await db.$queryRaw<TechnicalIncident[]>`SELECT * FROM technical_incidents WHERE status <> 'RESOLVED' FOR UPDATE`;
  for (const row of observations) {
    if (technicalAlertExcluded(row)) continue;
    const existing = active.find(incident => incident.probeId === row.id);
    if (existing) {
      await db.$executeRaw`UPDATE technical_incidents SET "observedStatus"=${row.status}, detail=${row.detail}, "lastObservedAt"=${now} WHERE id=${existing.id}`;
      if (existing.observedStatus !== row.status) await event(db, existing.id, 'HEALTH_CHANGED', 'monitor', `${existing.observedStatus} → ${row.status}. ${row.detail}`);
    } else if (technicalFailure(row)) {
      const id = randomUUID();
      await db.$executeRaw`INSERT INTO technical_incidents (id, "probeId", service, center, detail, "observedStatus", "lastObservedAt") VALUES (${id}, ${row.id}, ${row.service}, ${row.center}, ${row.detail}, ${row.status}, ${now})`;
      await event(db, id, 'OPENED', 'monitor', row.detail);
    }
  }
  await db.$executeRaw`UPDATE technical_monitor_state SET "lastCheckAt"=${now}, checks=${JSON.stringify(observations)}::jsonb WHERE id='primary'`;
}

export async function acknowledgeTechnicalReply(db: Db, update: TelegramUpdate, chatId: string) {
  const reply = acknowledgmentReply(update, chatId);
  if (!reply) return 0;
  const rows = await db.$queryRaw<TechnicalIncident[]>`UPDATE technical_incidents SET status='ACKNOWLEDGED', "acknowledgedAt"=CURRENT_TIMESTAMP, "acknowledgedBy"=${reply.actor}
    WHERE status='OPEN' AND id IN (SELECT "incidentId" FROM technical_alert_events WHERE "chatId"=${chatId} AND (${reply.messageId}::integer IS NULL OR "messageId"=${reply.messageId}) AND "createdAt"<=${reply.before} AND event='SENT') RETURNING *`;
  for (const row of rows) await event(db, row.id, 'ACKNOWLEDGED', reply.actor, `Noted ${reply.callbackId ? 'button' : 'message'} ${reply.messageId ?? '(all previously delivered open alerts)'}; update ${update.update_id}. Reminders stopped.`);
  return rows.length;
}

export async function resolveTechnicalIncident(db: Db, id: string, actor: string, resolution: string) {
  const rows = await db.$queryRaw<TechnicalIncident[]>`UPDATE technical_incidents SET status='RESOLVED', "resolvedAt"=CURRENT_TIMESTAMP, "resolvedBy"=${actor}, resolution=${resolution} WHERE id=${id} AND status='ACKNOWLEDGED' RETURNING *`;
  if (!rows.length) return null;
  await event(db, rows[0].id, 'RESOLVED', actor, resolution);
  await db.auditLog.create({ data: { actorUserId: actor, action: 'TECHNICAL_INCIDENT_RESOLVED', metadata: { incidentId: rows[0].id, resolution } } });
  return rows[0];
}

let busy = false;
export async function tickTechnicalMonitor() {
  const settings = config();
  if (busy || !settings.enabled || process.env.DATABASE_READ_ONLY === 'true') return;
  busy = true;
  try {
    await prisma.$transaction(async db => {
      // One monitor across API replicas; released automatically on rollback/crash.
      const [lock] = await db.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(924202615) AS locked`;
      if (!lock?.locked) return;
      const [state] = await db.$queryRaw<MonitorState[]>`SELECT * FROM technical_monitor_state WHERE id='primary'`;
      if (!state) throw new Error('Technical monitor migration is missing');
      let lastError: string | null = null;
      if (settings.token && settings.chatId) {
        try {
          const updates = await telegram<TelegramUpdate[]>('getUpdates', { offset: Number(state.updateOffset), timeout: 0, allowed_updates: ['message', 'my_chat_member', 'callback_query'] });
          for (const update of updates) {
            const acknowledged = await acknowledgeTechnicalReply(db, update, settings.chatId);
            if (update.callback_query) await telegram('answerCallbackQuery', { callback_query_id: update.callback_query.id, text: acknowledged ? 'Acknowledged. Reminders stopped. Resolve in Super Admin.' : 'No open incident matched; it may already be acknowledged.', show_alert: false }).catch(() => undefined);
            await db.$executeRaw`UPDATE technical_monitor_state SET "updateOffset"=${BigInt(update.update_id + 1)} WHERE id='primary'`;
          }
        } catch (error) { lastError = error instanceof TelegramError ? error.message : 'Telegram acknowledgment polling failed'; }
      } else lastError = 'Telegram bot token or group chat ID is missing; delivery is disabled.';

      if (!state.lastCheckAt || Date.now() - state.lastCheckAt.getTime() >= HEALTH_INTERVAL_MS) {
        const observations = await collectServiceHealth(null);
        await recordTechnicalObservations(db, observations.rows);
      }

      // Do not send when acknowledgments could not be read, avoiding reminders after Noted.
      if (!lastError && settings.chatId) {
        const due = await db.$queryRaw<TechnicalIncident[]>`SELECT * FROM technical_incidents WHERE status='OPEN' AND "nextReminderAt"<=CURRENT_TIMESTAMP ORDER BY "nextReminderAt", id LIMIT 10 FOR UPDATE`;
        const eligible = due.filter(row => !technicalAlertExcluded({ id: row.probeId, service: row.service }));
        if (eligible.length) {
          const text = eligible.length === 1 ? technicalAlertText(eligible[0]) : 'TECHNICAL BREAKDOWNS\n\n' + eligible.map(row => `${row.id}\n${row.service.slice(0, 70)} — ${row.center.slice(0, 60)}\n${row.observedStatus}: ${row.detail.slice(0, 100)}`).join('\n\n') + '\n\nTap Noted below or reply to this message with Noted to acknowledge ALL incidents listed above and stop their reminders. Resolve each incident in Super Admin → Technical Alerts. Reminders repeat every 2 minutes.';
          try {
            const sent = await telegram<{ message_id: number }>('sendMessage', { chat_id: settings.chatId, text, reply_markup: notedKeyboard, protect_content: true, link_preview_options: { is_disabled: true } });
            for (const row of eligible) {
              await db.$executeRaw`UPDATE technical_incidents SET "nextReminderAt"=${new Date(Date.now() + REMINDER_INTERVAL_MS)}, "reminderCount"="reminderCount"+1 WHERE id=${row.id}`;
              await event(db, row.id, 'SENT', 'monitor', 'Telegram alert/reminder delivered', settings.chatId, sent.message_id);
            }
          } catch (error) {
            lastError = error instanceof TelegramError ? error.message : 'Telegram delivery failed';
            const delay = Math.max(REMINDER_INTERVAL_MS, error instanceof TelegramError ? error.retryAfter * 1000 : 0);
            for (const row of eligible) {
              await db.$executeRaw`UPDATE technical_incidents SET "nextReminderAt"=${new Date(Date.now() + delay)} WHERE id=${row.id}`;
              await event(db, row.id, 'DELIVERY_FAILED', 'monitor', lastError);
            }
          }
        }
      }
      await db.$executeRaw`UPDATE technical_monitor_state SET "lastTickAt"=CURRENT_TIMESTAMP, "lastError"=${lastError} WHERE id='primary'`;
    }, { maxWait: 5000, timeout: 90000 });
  } catch { console.error('Technical alert monitor could not complete its cycle; check database connectivity and migrations.'); }
  finally { busy = false; }
}
export function startTechnicalMonitor() {
  if (!config().enabled || process.env.DATABASE_READ_ONLY === 'true') return;
  void tickTechnicalMonitor();
  setInterval(() => void tickTechnicalMonitor(), 10000).unref();
}

export const technicalAlertsRouter = Router();
technicalAlertsRouter.use(requireAuth, requireSuperAdmin);
technicalAlertsRouter.post('/check-now', async (req, res) => {
  if (!config().enabled) return res.status(409).json({ message: 'Technical monitoring is paused.' });
  await prisma.$executeRaw`UPDATE technical_monitor_state SET "lastCheckAt"=NULL WHERE id='primary'`;
  await prisma.auditLog.create({ data: { actorUserId: req.user!.sub, action: 'TECHNICAL_HEALTH_CHECK_REQUESTED', metadata: {} } });
  void tickTechnicalMonitor();
  res.status(202).json({ message: 'Health check queued. Results will refresh shortly.' });
});
technicalAlertsRouter.get('/', async (req, res) => {
  const status = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(String(req.query.status)) ? String(req.query.status) : '';
  const page = Math.max(1, Math.min(100000, Number.parseInt(String(req.query.page || 1), 10) || 1));
  const rows = await prisma.$queryRaw<TechnicalIncident[]>`SELECT * FROM technical_incidents WHERE (${status}='' OR status=${status}) ORDER BY "openedAt" DESC, id LIMIT 50 OFFSET ${(page - 1) * 50}`;
  const [count] = await prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM technical_incidents WHERE (${status}='' OR status=${status})`;
  const [monitor] = await prisma.$queryRaw<MonitorState[]>`SELECT * FROM technical_monitor_state WHERE id='primary'`;
  const settings = config();
  res.json({ rows, total: Number(count.total), page, monitor: { ...monitor, updateOffset: undefined, enabled: settings.enabled, telegramConfigured: Boolean(settings.token && settings.chatId), intervalMinutes: 15, reminderMinutes: 2 } });
});
technicalAlertsRouter.get('/:id/events', async (req, res) => {
  const rows = await prisma.$queryRaw`SELECT * FROM technical_alert_events WHERE "incidentId"=${String(req.params.id)} ORDER BY "createdAt" DESC, id LIMIT 200`;
  res.json(rows);
});
technicalAlertsRouter.post('/:id/resolve', async (req, res) => {
  const resolution = typeof req.body?.resolution === 'string' ? req.body.resolution.trim() : '';
  if (resolution.length < 5 || resolution.length > 2000) return res.status(400).json({ message: 'Enter a resolution note between 5 and 2000 characters.' });
  const result = await prisma.$transaction(db => resolveTechnicalIncident(db, String(req.params.id), req.user!.sub, resolution));
  if (!result) return res.status(409).json({ message: 'Only an acknowledged, unresolved incident can be resolved. Reply Noted to its Telegram alert first.' });
  res.json(result);
});
