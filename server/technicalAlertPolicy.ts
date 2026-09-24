export const HEALTH_INTERVAL_MS = 15 * 60_000;
export const REMINDER_INTERVAL_MS = 2 * 60_000;
export type HealthObservation = { id: string; service: string; center: string; status: string; detail: string; observedAt: string | null };

// These exclusions suppress alerts, not the observations on the Healthcheck page.
export const excludedTechnicalEndpoints = new Set([
  'PACS report return:10.50.1.25:104', 'PACS report return:10.115.70.4:104',
  ...[5200, 5201, 5202, 5203, 5204, 5205, 5300, 5301, 5101, 5102, 5103, 5104, 5105].map(port => `DICOM receive:10.20.30.10:${port}`),
  ...[5002, 5106, 5107, 5108].map(port => `DICOM receive:54.95.134.100:${port}`),
]);
export function technicalAlertExcluded(row: Pick<HealthObservation, 'id' | 'service'>) {
  return row.id === 'notifications' || /whatsapp/i.test(row.service) || /^(XRAY_SKELETAL|XRAY_CHEST|CT_THORAX|CT_ORCHESTRATOR|SPECIAL_XRAY|MRI_STUDY|MRI_S3_STUDY|MAMMOGRAPHY_STUDY|MAMMOGRAPHY_S3_REPORT):/.test(row.id) || excludedTechnicalEndpoints.has(row.id);
}
export function technicalFailure(row: HealthObservation) {
  return !technicalAlertExcluded(row) && row.status === 'Needs attention';
}
type TelegramPerson = { id: number; is_bot?: boolean; username?: string; first_name?: string; last_name?: string };
export type TelegramUpdate = { update_id: number; callback_query?: { id: string; data?: string; from: TelegramPerson; message?: { message_id: number; chat: { id: number; type: string } } }; message?: { text?: string; message_id: number; date: number; chat: { id: number; type: string }; from?: TelegramPerson; sender_chat?: unknown; reply_to_message?: { message_id: number } } };
export function acknowledgmentReply(update: TelegramUpdate, chatId: string) {
  const callback = update.callback_query;
  const actor = (person: TelegramPerson) => `Telegram ${person.id} (${person.username || [person.first_name, person.last_name].filter(Boolean).join(' ') || 'member'})`;
  if (callback) {
    if (callback.data !== 'technical-noted' || callback.from.is_bot || !callback.message || String(callback.message.chat.id) !== chatId || !['group', 'supergroup'].includes(callback.message.chat.type)) return null;
    return { messageId: callback.message.message_id, actor: actor(callback.from), before: new Date(), callbackId: callback.id };
  }
  const message = update.message;
  if (!message || String(message.chat.id) !== chatId || !['group', 'supergroup'].includes(message.chat.type)
    || message.from?.is_bot || !message.from || message.sender_chat || !/^noted[.!]?$/i.test(message.text?.trim() ?? '')) return null;
  return { messageId: message.reply_to_message?.message_id ?? null, actor: actor(message.from), before: new Date(message.date * 1000 + 999), callbackId: undefined };
}
export const notedKeyboard = { inline_keyboard: [[{ text: 'Noted — acknowledge', callback_data: 'technical-noted' }]] };
export function technicalAlertText(incident: { id: string; service: string; center: string; detail: string; observedStatus: string }) {
  return `TECHNICAL BREAKDOWN\nIncident: ${incident.id}\nService: ${incident.service}\nLocation: ${incident.center}\nLatest health: ${incident.observedStatus}\n${incident.detail.slice(0, 1500)}\n\nTap Noted below or reply to this message with Noted to acknowledge and stop reminders. A Super Admin must resolve the incident in Technical Alerts. Reminders repeat every 2 minutes until acknowledgment.`;
}
