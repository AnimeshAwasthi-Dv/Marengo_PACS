export type TelegramConfig = ReturnType<typeof telegramConfig>;

export function telegramAlertConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = telegramConfig({ ...env, TELEGRAM_ENABLED: env.TELEGRAM_ALERT_ENABLED, TELEGRAM_BOT_TOKEN: env.TELEGRAM_ALERT_BOT_TOKEN, TELEGRAM_CHAT_ID: env.TELEGRAM_ALERT_CHAT_ID });
  const leadMinutes = Number(env.TELEGRAM_ALERT_LEAD_MINUTES);
  if (!Number.isFinite(leadMinutes) || leadMinutes <= 0 || leadMinutes > 1440) config.missing.push('alert lead time');
  return { ...config, leadMinutes };
}

export function tatAlertDue(input: { completedAt: string | null; processingStatus: string; startedAt: string; targetSeconds: number | null }, leadMinutes: number, now = Date.now()) {
  if (input.completedAt || /cancel/i.test(input.processingStatus) || input.targetSeconds === null || input.targetSeconds <= 0 || !Number.isFinite(leadMinutes) || leadMinutes <= 0) return false;
  const started = Date.parse(input.startedAt);
  return Number.isFinite(started) && now >= started && now >= started + input.targetSeconds * 1000 - leadMinutes * 60000;
}

export function telegramAlertMessage(input: Parameters<typeof telegramMessage>[0] & { center: string }, portalUrl: string, now = Date.now()) {
  const { url } = telegramMessage(input, portalUrl);
  const due = Date.parse(input.startedAt) + input.targetSeconds! * 1000;
  const remaining = Math.ceil((due - now) / 60000);
  return { url, text: [
    'Marengo | Report TAT alert', `Center: ${input.center}`, `Reference: ${input.id}`,
    `Modality: ${input.modality} | Priority: ${input.priority}`, 'Signed report not yet available',
    remaining > 0 ? `Time remaining: ${remaining} min` : `TAT breached: ${Math.abs(remaining)} min overdue`,
    `Due: ${new Date(due).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false })} IST`, url,
  ].join('\n') };
}

export function telegramConfig(env: NodeJS.ProcessEnv = process.env) {
  const missing: string[] = [];
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  const chatId = env.TELEGRAM_CHAT_ID?.trim() ?? '';
  const clientIds = (env.TELEGRAM_CLIENT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const groupCode = env.TELEGRAM_CLIENT_GROUP_CODE?.trim() ?? '';
  let portalUrl = '';
  try {
    const url = new URL(env.TELEGRAM_PORTAL_URL ?? '');
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) portalUrl = url.href;
  } catch { /* Incomplete configuration is reported without exposing its values. */ }
  if (!token) missing.push('bot token');
  if (!/^(-\d+|@[A-Za-z][A-Za-z0-9_]{4,})$/.test(chatId)) missing.push('group chat ID');
  if (!clientIds.length && !groupCode) missing.push('allowed center IDs or group code');
  if (!portalUrl) missing.push('public HTTPS portal URL');
  return { enabled: env.TELEGRAM_ENABLED === 'true', token, chatId, clientIds, groupCode, portalUrl, missing };
}

export function modalityCode(value: string) {
  const code = value.trim().toUpperCase().replace(/[ -]/g, '_');
  if (['SPECIAL_XRAY', 'SPECIAL_X_RAY', 'SPECIAL_XRAY_CONTRAST_MEDIA'].includes(code)) return 'SPECIAL_XRAY';
  if (['XR', 'CR', 'DX', 'X_RAY', 'XRAY'].includes(code)) return 'XRAY';
  if (['MR', 'MRI'].includes(code)) return 'MRI';
  if (['NM', 'PT', 'PET_CT', 'NMR'].includes(code)) return 'NMR';
  if (code.startsWith('CT_') || ['HRCT_TEMPORAL_BONE', 'TRIPLE_PHASE_CT'].includes(code)) return 'CT';
  if (code.startsWith('MRI_') || ['MRCP', 'MRA_MRV_MRS'].includes(code)) return 'MRI';
  if (code.startsWith('XRAY_')) return 'XRAY';
  if (code === 'ULTRASOUND') return 'US';
  if (code === 'MAMMOGRAPHY') return 'MG';
  return ['CT', 'US', 'MG'].includes(code) ? code : 'UNKNOWN';
}

export function studyTatCategory(modality: string, serviceType?: string, description?: string | null) {
  if (modalityCode(serviceType ?? '') === 'SPECIAL_XRAY') return 'SPECIAL_XRAY';
  const code = modalityCode(modality);
  if (code === 'XRAY' && /\b(special[ _-]*x[ _-]*ray|scanogram|hsg|ivp|barium|asu|mcu|fistulogram|sinogram|gastrografin|cholangiogram|ductography|sialogram|rgu|ivu|bone[ _-]*age|opg)\b/i.test(description ?? '')) return 'SPECIAL_XRAY';
  return code === 'UNKNOWN' ? modalityCode(serviceType ?? '') : code;
}

export function tatTargetSeconds(modality: string, priority: string | null, env: NodeJS.ProcessEnv = process.env) {
  const key = `TELEGRAM_TAT_${modalityCode(modality)}${priority?.toUpperCase() === 'URGENT' ? '_URGENT' : ''}_MINUTES`;
  const minutes = Number(env[key]);
  return Number.isFinite(minutes) && minutes > 0 && minutes <= 43200 ? Math.round(minutes * 60) : null;
}

// Integration bodies may contain credentials or signed URLs even when no headers are stored.
export function redactExchange(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[depth limit]';
  if (Array.isArray(value)) return value.slice(0, 200).map(v => redactExchange(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, item]) => [key,
    /token|secret|password|authorization|cookie|api.?key|signature|base64|file.?path|storage|headers|report.?html/i.test(key) ? '[redacted]' : redactExchange(item, depth + 1),
  ]));
  if (typeof value === 'string') {
    if (/^\s*[\[{]/.test(value)) {
      try { return redactExchange(JSON.parse(value), depth + 1); } catch { /* Retain non-JSON provider messages. */ }
    }
    return value
    .replace(/https?:\/\/[^\s"<>]+/gi, '[URL redacted]')
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[token redacted]')
    .replace(/\bBearer\s+\S+/gi, '[authorization redacted]')
    .slice(0, 12000);
  }
  return value;
}

export function telegramMessage(input: { id: string; modality: string; tatCategory?: string; priority: string; status: string; startedAt: string; targetSeconds: number | null; completedAt: string | null }, portalUrl: string) {
  const url = new URL(`/study-status/${encodeURIComponent(input.id)}`, portalUrl).href;
  const due = input.targetSeconds === null ? null : new Date(Date.parse(input.startedAt) + input.targetSeconds * 1000);
  const ist = (date: Date) => date.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false }) + ' IST';
  return { text: [
    'Marengo | Study sent for processing', `Reference: ${input.id}`, `Modality: ${input.modality} | Priority: ${input.priority}`,
    ...(input.tatCategory === 'SPECIAL_XRAY' ? ['TAT category: Special X-ray'] : []),
    `Status: ${input.status}`, `Submitted: ${ist(new Date(input.startedAt))}`,
    due ? `TAT target: ${input.targetSeconds! / 60} min | Due: ${ist(due)}` : 'TAT target: awaiting configuration',
    input.completedAt ? `Completed: ${ist(new Date(input.completedAt))}` : 'Live countdown and Renewist exchange available in the portal.',
    url,
  ].join('\n'), url };
}

export class TelegramDeliveryError extends Error {
  constructor(public code: number, public retryAfter = 0) { super(`Telegram delivery failed (code ${code})`); }
}

export async function sendTelegram(config: TelegramConfig, text: string, url: string, transport: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await transport(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ chat_id: config.chatId, text, protect_content: true, link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [[{ text: 'Study status & TAT', url }]] } }),
    });
  } catch { throw new TelegramDeliveryError(0); }
  const body = await response.json().catch(() => ({})) as { ok?: boolean; error_code?: number; parameters?: { retry_after?: number }; result?: { message_id?: number } };
  if (!response.ok || !body.ok || !body.result?.message_id) throw new TelegramDeliveryError(body.error_code ?? response.status, Number(body.parameters?.retry_after) || 0);
  return body.result.message_id;
}
