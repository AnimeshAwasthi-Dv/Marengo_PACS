import type { RequestHandler } from 'express';
import crypto from 'node:crypto';
import type { PhysicianTemplateFields } from './physicianWhatsapp';

export function watiConfigured(env: NodeJS.ProcessEnv = process.env) {
  try {
    const url = new URL(env.WATI_API_URL ?? '');
    return env.WATI_ENABLED === 'true' && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && Boolean(env.WATI_API_TOKEN?.trim()) && Boolean(env.WHATSAPP_REPORT_READY_TEMPLATE_NAME?.trim());
  } catch { return false; }
}

export function watiTemplatePayload(fields: PhysicianTemplateFields, studyLink: string, outboxId: string, env: NodeJS.ProcessEnv = process.env) {
  return { template_name: env.WHATSAPP_REPORT_READY_TEMPLATE_NAME?.trim() || 'notification_to_physician', broadcast_name: 'physician_report_' + outboxId,
    parameters: [{ name: 'name', value: fields.name }, { name: 'age', value: fields.age }, { name: 'study', value: fields.study }, { name: 'study_link', value: studyLink }],
    ...(env.WATI_CHANNEL_NUMBER?.trim() ? { channel_number: env.WATI_CHANNEL_NUMBER.trim() } : {}),
  };
}

async function watiRequest(path: string, init: RequestInit, env: NodeJS.ProcessEnv, transport: typeof fetch) {
  const url = env.WATI_API_URL!.replace(/\/+$/, '') + path;
  let response: Response;
  try { response = await transport(url, { ...init, headers: { Authorization: 'Bearer ' + env.WATI_API_TOKEN!.replace(/^Bearer\s+/i, '').trim(), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000), redirect: 'error' }); }
  catch { throw new Error('WATI request unavailable'); }
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok && response.status === 400 && /contact.{0,80}(not found|not exist|not configured)|no contact|invalid\s+(?:(?:phone|whatsapp)\s+)?number/i.test(JSON.stringify(body))) return { result: false, error: 'contact not configured' };
  if (!response.ok) throw new Error('WATI request failed (HTTP ' + response.status + ')');
  return body;
}

export async function watiTemplateStatus(env: NodeJS.ProcessEnv = process.env, transport: typeof fetch = fetch) {
  if (!watiConfigured(env)) return 'UNCONFIGURED';
  for (let page = 1; page <= 20; page++) {
    const body = await watiRequest('/api/v1/getMessageTemplates?pageSize=100&pageNumber=' + page, {}, env, transport);
    const templates = Array.isArray(body.messageTemplates) ? body.messageTemplates as Array<{ elementName?: string; status?: string }> : [];
    const template = templates.find(item => item.elementName === env.WHATSAPP_REPORT_READY_TEMPLATE_NAME?.trim());
    if (template) return template.status?.toUpperCase() || 'UNKNOWN';
    if (templates.length < 100) return 'NOT_FOUND';
  }
  return 'NOT_FOUND';
}

let cachedStatus: { key: string; expires: number; status: string } | undefined;
export async function watiTemplateApproved() {
  const key = crypto.createHash('sha256').update([process.env.WATI_API_URL,process.env.WATI_API_TOKEN,process.env.WHATSAPP_REPORT_READY_TEMPLATE_NAME].join('|')).digest('hex');
  if (!cachedStatus || cachedStatus.key !== key || cachedStatus.expires <= Date.now()) {
    const status = await watiTemplateStatus().catch(() => 'UNAVAILABLE');
    cachedStatus = { key, status, expires: Date.now() + 60000 };
  }
  return cachedStatus.status === 'APPROVED';
}

export async function sendWatiPhysicianReport(to: string | null | undefined, fields: PhysicianTemplateFields, studyLink: string, outboxId: string, env: NodeJS.ProcessEnv = process.env, transport: typeof fetch = fetch) {
  if (!/^\+[1-9]\d{7,14}$/.test(to ?? '') || !watiConfigured(env)) return { skipped: true as const, messageIds: [] as string[] };
  const body = await watiRequest('/api/v1/sendTemplateMessage?whatsappNumber=' + encodeURIComponent(to!.slice(1)), { method: 'POST', body: JSON.stringify(watiTemplatePayload(fields, studyLink, outboxId, env)) }, env, transport);
  if (body.validWhatsAppNumber === false) return { skipped: true as const, messageIds: [] as string[] };
  if (body.result === false) {
    const detail = JSON.stringify(body);
    if (/contact.{0,80}(not found|not exist|not configured)|no contact|invalid\s+(?:(?:phone|whatsapp)\s+)?number/i.test(detail)) return { skipped: true as const, messageIds: [] as string[] };
    throw new Error('WATI did not accept the physician template');
  }
  if (body.result !== true) throw new Error('WATI returned an unrecognized delivery response');
  const messageIds = new Set<string>();
  function collect(value: unknown, depth = 0) { if (!value || typeof value !== 'object' || depth > 5) return; for (const [key,item] of Object.entries(value)) { if (['localMessageId','whatsappMessageId'].includes(key) && typeof item === 'string' && item) messageIds.add(item); else if (typeof item === 'object') collect(item, depth + 1); } }
  collect(body);
  return { skipped: false as const, messageIds: [...messageIds] };
}

export function validWatiWebhookSecret(provided: string | undefined, expected = process.env.WATI_WEBHOOK_SECRET) {
  if (!provided || !expected || expected.length < 32) return false;
  const actual = Buffer.from(provided), wanted = Buffer.from(expected);
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

/** Remove URL credentials before access logging, JSON parsing errors, and audit hooks. */
export const captureWatiWebhookSecret: RequestHandler = (req, res, next) => {
  const original = new URL(req.originalUrl, 'http://localhost');
  const supplied = original.searchParams.getAll('secret');
  res.locals.watiWebhookSecret = supplied.length === 1 ? supplied[0] : undefined;
  original.searchParams.delete('secret');
  req.originalUrl = original.pathname + original.search;
  const local = new URL(req.url, 'http://localhost');
  local.searchParams.delete('secret');
  req.url = local.pathname + local.search;
  next();
};
