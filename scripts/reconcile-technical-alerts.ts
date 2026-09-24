// Withdraw obsolete AI checks and add a visible acknowledgment button to existing alerts.
import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db';
import { notedKeyboard, technicalAlertText, type HealthObservation } from '../server/technicalAlertPolicy';
import type { TechnicalIncident } from '../server/technicalAlerts';
const aiPrefix = /^(XRAY_SKELETAL|XRAY_CHEST|CT_THORAX|CT_ORCHESTRATOR|SPECIAL_XRAY|MRI_STUDY|MRI_S3_STUDY|MAMMOGRAPHY_STUDY|MAMMOGRAPHY_S3_REPORT):/;
const reason = 'Excluded by administrator instruction: Marengo sends studies directly to Renewist; AI endpoints are not integrated.';
await prisma.$transaction(async db => {
  const incidents = await db.$queryRaw<TechnicalIncident[]>`SELECT * FROM technical_incidents WHERE status<>'RESOLVED' FOR UPDATE`;
  for (const row of incidents.filter(item => aiPrefix.test(item.probeId))) {
    await db.$executeRaw`UPDATE technical_incidents SET status='RESOLVED', "resolvedAt"=CURRENT_TIMESTAMP, "resolvedBy"='configuration', resolution=${reason} WHERE id=${row.id}`;
    await db.$executeRaw`INSERT INTO technical_alert_events (id,"incidentId",event,actor,detail) VALUES (${randomUUID()},${row.id},'CONFIGURATION_EXCLUDED','administrator instruction',${reason})`;
  }
  const [state] = await db.$queryRaw<{ checks: HealthObservation[] }[]>`SELECT checks FROM technical_monitor_state WHERE id='primary'`;
  await db.$executeRaw`UPDATE technical_monitor_state SET checks=${JSON.stringify(state.checks.filter(row => !aiPrefix.test(row.id)))}::jsonb WHERE id='primary'`;
});
const chatId = process.env.TECH_ALERT_CHAT_ID!;
const messages = await prisma.$queryRaw<{ messageId: number }[]>`SELECT DISTINCT "messageId" FROM technical_alert_events WHERE "chatId"=${chatId} AND event='SENT' AND "messageId" IS NOT NULL`;
let updated = 0;
for (const message of messages) {
  const incidents = await prisma.$queryRaw<TechnicalIncident[]>`SELECT * FROM technical_incidents WHERE id IN (SELECT "incidentId" FROM technical_alert_events WHERE "chatId"=${chatId} AND "messageId"=${message.messageId})`;
  const remaining = incidents.filter(row => !aiPrefix.test(row.probeId));
  const containsAi = incidents.length !== remaining.length;
  const method = containsAi ? 'editMessageText' : 'editMessageReplyMarkup';
  const body = { chat_id: chatId, message_id: message.messageId, reply_markup: remaining.length ? notedKeyboard : { inline_keyboard: [] }, ...(containsAi ? { text: remaining.length ? technicalAlertText(remaining[0]) + '\n\nAI endpoint alerts withdrawn: Marengo uses direct Renewist reporting.' : 'ALERT WITHDRAWN\nThese AI endpoints are not integrated in Marengo. The incorrect alerts have been excluded and logged. No acknowledgment or repair is required.' } : {}) };
  const response = await fetch(`https://api.telegram.org/bot${process.env.TECH_ALERT_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const result = await response.json() as { ok: boolean; error_code?: number };
  if (result.ok) updated++;
  else console.log(`Message update returned ${result.error_code}; no credential output.`);
}
console.log(`AI incidents excluded; ${updated} existing Telegram messages updated.`);
await prisma.$disconnect();
