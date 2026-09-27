import type { Prisma, PrismaClient } from '@prisma/client';
import { PHYSICIAN_REPORT_READY, requestPhysicianCall } from './physicianWhatsapp';

/** Caller must authenticate the webhook before passing its body here. */
export async function handleWatiPhysicianWebhook(db: PrismaClient, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const event = input as Record<string, unknown>;
  const type = String(event.eventType ?? '');
  const phone = typeof event.waId === 'string' ? '+' + event.waId.replace(/^\+/, '') : '';
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return;
  const text = typeof event.text === 'string' ? event.text.trim() : '';
  const inbound = ['messageReceived', 'message'].includes(type) && event.owner !== true;
  if (inbound && /^(stop|unsubscribe|opt\s*out|cancel\s+messages)$/i.test(text)) {
    await db.notificationRecipient.updateMany({ where: { role: 'REFERRING_PHYSICIAN', phoneE164: phone }, data: { active: false, consentStatus: 'OPTED_OUT', optOutAt: new Date() } });
    return;
  }
  if (/^templateMessageSent/.test(type)) {
    if (event.templateName !== (process.env.WHATSAPP_REPORT_READY_TEMPLATE_NAME || 'notification_to_physician')) return;
    // Correlate the exact report-only link. Never guess using the physician's latest study.
    const token = /\/shared\/([A-Za-z0-9._%-]+)/.exec(text)?.[1];
    const ids = [event.localMessageId, event.whatsappMessageId, event.id].filter((id): id is string => typeof id === 'string' && Boolean(id));
    if (!token || !ids.length) return;
    let shareToken: string; try { shareToken = decodeURIComponent(token); } catch { return; }
    const rows = await db.notificationOutbox.findMany({ where: { eventType: PHYSICIAN_REPORT_READY, payload: { path: ['shareToken'], equals: shareToken } }, take: 2 });
    if (rows.length !== 1) return;
    const row = rows[0], payload = row.payload as Prisma.InputJsonObject;
    if (!Array.isArray(payload.to) || payload.to.length !== 1 || payload.to[0] !== phone) return;
    const previous = Array.isArray(payload.watiMessageIds) ? payload.watiMessageIds.filter((id): id is string => typeof id === 'string') : [];
    await db.notificationOutbox.update({ where: { id: row.id }, data: { payload: { ...payload, provider: 'wati', watiMessageIds: [...new Set([...previous, ...ids])] } } });
    return;
  }
  if (!inbound || !['button','interactive'].includes(String(event.type))) return;
  const button = event.buttonReply && typeof event.buttonReply === 'object' ? event.buttonReply as Record<string,unknown> : event.interactiveButtonReply && typeof event.interactiveButtonReply === 'object' ? event.interactiveButtonReply as Record<string,unknown> : {};
  const label = String(button.text ?? button.title ?? text).trim();
  if (label.toLowerCase() !== 'connect to radiologist') return;
  const contextId = typeof event.replyContextId === 'string' ? event.replyContextId : '';
  if (!contextId) return;
  const rows = await db.notificationOutbox.findMany({ where: { eventType: PHYSICIAN_REPORT_READY, status: 'SENT', payload: { path: ['watiMessageIds'], array_contains: [contextId] } }, take: 2 });
  if (rows.length !== 1) return;
  await requestPhysicianCall(db, phone, rows[0].id);
}
