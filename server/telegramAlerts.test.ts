import test from 'node:test';
import assert from 'node:assert/strict';
import { tatAlertDue, telegramAlertConfig, telegramAlertMessage, tatTargetSeconds } from './telegramPolicy';
import { processTelegramOutbox, TELEGRAM_ALERT_EVENT } from './telegram';
import { studyTracking } from './studyTracking';
import { enqueueTatAlerts } from './telegramAlerts';

const start = Date.parse('2026-09-22T00:00:00Z');
const study = { id: 'job-a', center: 'Marengo', modality: 'XR', priority: 'Routine', status: 'Reporting', processingStatus: 'processing', startedAt: new Date(start).toISOString(), targetSeconds: 3600, completedAt: null };
test('One-hour X-ray SLA alerts at 30 minutes remaining, never before submission or after reporting', () => {
  assert.equal(tatTargetSeconds('XR', 'REGULAR', { TELEGRAM_TAT_XRAY_MINUTES: '60' }), 3600);
  assert.equal(tatAlertDue(study, 30, start + 29 * 60000), false);
  assert.equal(tatAlertDue(study, 30, start + 30 * 60000), true);
  assert.equal(tatAlertDue(study, 30, start + 61 * 60000), true);
  assert.equal(tatAlertDue(study, 30, start - 1), false);
  assert.equal(tatAlertDue({ ...study, completedAt: new Date(start).toISOString() }, 30, start + 3600000), false);
  assert.equal(tatAlertDue({ ...study, processingStatus: 'cancelled' }, 30, start + 3600000), false);
  assert.equal(tatAlertDue({ ...study, targetSeconds: null }, 30, start + 3600000), false);
  const message = telegramAlertMessage(study, 'https://pacs.example.org', start + 30 * 60000);
  assert.match(message.text, /Time remaining: 30 min/);
  assert.match(message.text, /IST/);
  assert.match(message.url, /study-status\/job-a/);
});

test('Alert bot never falls back to the processing bot token or recipient', () => {
  const config = telegramAlertConfig({ TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'processing-secret', TELEGRAM_CHAT_ID: '-1001', TELEGRAM_ALERT_LEAD_MINUTES: '30' });
  assert.equal(config.enabled, false);
  assert.equal(config.token, '');
  assert.equal(config.chatId, '');
  assert(config.missing.includes('group chat ID'));
});

test('Alert scanning is scoped, excludes demos, and queues only once per unreported job', async () => {
  const config = telegramAlertConfig({ TELEGRAM_ALERT_ENABLED: 'true', TELEGRAM_ALERT_BOT_TOKEN: 'alert-secret', TELEGRAM_ALERT_CHAT_ID: '-2001', TELEGRAM_CLIENT_IDS: 'center-a', TELEGRAM_PORTAL_URL: 'https://pacs.example.org', TELEGRAM_ALERT_LEAD_MINUTES: '30' });
  const entries = new Map<string, unknown>();
  const old = process.env.TELEGRAM_TAT_XRAY_MINUTES;
  process.env.TELEGRAM_TAT_XRAY_MINUTES = '60';
  let reads = 0;
  const db = {
    processingJob: { findMany: async ({ where }: { where: { clientId: { in: string[] }; demoMode: boolean } }) => {
      assert.deepEqual(where.clientId.in, ['center-a']); assert.equal(where.demoMode, false);
      return [{ id: 'unreported', clientId: 'center-a', serviceType: 'XR', priority: 'REGULAR', status: 'processing', createdAt: new Date(Date.now() - 40 * 60000), bridgeStudy: null }];
    } },
    notificationOutbox: {
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) => entries.get(where.idempotencyKey) ?? null,
      upsert: async ({ where, create }: { where: { idempotencyKey: string }; create: unknown }) => { entries.set(where.idempotencyKey, create); },
    },
  } as unknown as NonNullable<Parameters<typeof enqueueTatAlerts>[0]>['db'];
  const track = (async () => { reads++; return { ...study, startedAt: new Date(Date.now() - 40 * 60000).toISOString() }; }) as typeof studyTracking;
  try {
    await enqueueTatAlerts({ config: { ...config, enabled: false }, db, track });
    assert.equal(entries.size, 0);
    await enqueueTatAlerts({ config, db, track });
    await enqueueTatAlerts({ config, db, track });
    assert.equal(entries.size, 1); assert.equal(reads, 1);
  } finally { if (old === undefined) delete process.env.TELEGRAM_TAT_XRAY_MINUTES; else process.env.TELEGRAM_TAT_XRAY_MINUTES = old; }
});

test('Alert delivery rechecks completion, suppresses reported cases, and uses its own event queue', async () => {
  const config = telegramAlertConfig({ TELEGRAM_ALERT_ENABLED: 'true', TELEGRAM_ALERT_BOT_TOKEN: 'alert-secret', TELEGRAM_ALERT_CHAT_ID: '-2001', TELEGRAM_CLIENT_IDS: 'center-a', TELEGRAM_PORTAL_URL: 'https://pacs.example.org', TELEGRAM_ALERT_LEAD_MINUTES: '30' });
  const updates: string[] = [];
  const db = { notificationOutbox: {
    findMany: async ({ where }: { where: { eventType: string } }) => { assert.equal(where.eventType, TELEGRAM_ALERT_EVENT); return [{ id: 'row', aggregateId: study.id, status: 'PENDING', attempts: 0, payload: { chatId: config.chatId } }]; },
    updateMany: async () => ({ count: 1 }),
    update: async ({ data }: { data: { status: string } }) => { updates.push(data.status); },
  } } as unknown as NonNullable<Parameters<typeof processTelegramOutbox>[0]>['db'];
  await processTelegramOutbox({ config, db, eventType: TELEGRAM_ALERT_EVENT, leadMinutes: 30, track: (async () => ({ ...study, completedAt: new Date().toISOString() })) as typeof studyTracking, send: async () => { assert.fail('Completed report must not send'); }, pause: async () => {} });
  assert.deepEqual(updates, ['DEAD']);
});
