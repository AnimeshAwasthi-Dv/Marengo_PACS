import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueTelegramStudy, processTelegramOutbox, telegramCenterIds, TELEGRAM_EVENT } from './telegram';
import { TelegramDeliveryError, telegramConfig } from './telegramPolicy';
import { studyTracking } from './studyTracking';

const config = telegramConfig({ TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_CHAT_ID: '-1001', TELEGRAM_CLIENT_IDS: 'center-a', TELEGRAM_PORTAL_URL: 'https://pacs.example.org' });
const job = { id: 'job-1', clientId: 'center-a', serviceType: 'ct-brain', priority: 'REGULAR', demoMode: false };

test('All Marengo centers resolve by active parent group, including future linked centers', async () => {
  const groupConfig = telegramConfig({ TELEGRAM_CLIENT_GROUP_CODE: 'MARENGO' });
  assert(!groupConfig.missing.includes('allowed center IDs or group code'));
  let centers = [{ id: 'surat' }, { id: 'ahmedabad' }];
  const db = { client: { findMany: async ({ where }: { where: unknown }) => {
    assert.deepEqual(where, { kind: 'CENTER', status: 'ACTIVE', parentClient: { code: 'MARENGO', kind: 'GROUP', status: 'ACTIVE' } });
    return centers;
  } } } as unknown as Parameters<typeof telegramCenterIds>[1];
  assert.deepEqual(await telegramCenterIds(groupConfig, db), ['surat', 'ahmedabad']);
  centers = [...centers, { id: 'new-center' }];
  assert.deepEqual(await telegramCenterIds(groupConfig, db), ['surat', 'ahmedabad', 'new-center']);
});

test('Queue excludes demo/other-center/disabled submissions and uses one immutable key per job', async () => {
  const entries = new Map();
  const db = { notificationOutbox: { upsert: async (args: { where: { idempotencyKey: string }; create: unknown; update: unknown }) => { assert.deepEqual(args.update, {}); if (!entries.has(args.where.idempotencyKey)) entries.set(args.where.idempotencyKey, args.create); } } } as unknown as Parameters<typeof enqueueTelegramStudy>[0];
  await enqueueTelegramStudy(db, { ...job, demoMode: true }, 'CT', config);
  await enqueueTelegramStudy(db, { ...job, clientId: 'another-center' }, 'CT', config);
  await enqueueTelegramStudy(db, job, 'CT', { ...config, enabled: false });
  assert.equal(entries.size, 0);
  await enqueueTelegramStudy(db, job, 'CT', config);
  await enqueueTelegramStudy(db, job, 'CT', config);
  assert.equal(entries.size, 1);
  assert.equal(entries.get('telegram:processing:job-1').eventType, TELEGRAM_EVENT);
});

test('Worker claims only Telegram events, records success, retries 429 and stops permanent failures', async () => {
  for (const code of [null, 429, 403]) {
    const updates: Record<string, unknown>[] = [];
    let claimed = false; let sent = 0;
    const row = { id: 'outbox-1', aggregateId: job.id, status: 'PENDING', attempts: 0, payload: { chatId: config.chatId, clientId: job.clientId } };
    const db = { notificationOutbox: {
      findMany: async (args: { where: { eventType: string } }) => { assert.equal(args.where.eventType, TELEGRAM_EVENT); return [row]; },
      updateMany: async (args: { where: { id?: string; attempts?: number }; data: Record<string, unknown> }) => { if (args.where.id) { assert.equal(args.where.attempts, 0); claimed = true; } updates.push(args.data); return { count: 1 }; },
      update: async (args: { data: Record<string, unknown> }) => { updates.push(args.data); },
    } } as unknown as NonNullable<Parameters<typeof processTelegramOutbox>[0]>['db'];
    const track = (async (_id: string, ids: string[] | null) => { assert.deepEqual(ids, ['center-a']); return { id: job.id, modality: 'CT', priority: 'Routine', status: 'Reporting', startedAt: '2026-09-22T00:00:00Z', targetSeconds: 3600, completedAt: null }; }) as typeof studyTracking;
    await processTelegramOutbox({ db, config, track, pause: async () => undefined, send: async () => { assert(claimed); sent++; if (code) throw new TelegramDeliveryError(code, 90); return 42; } });
    assert.equal(sent, 1);
    const delivery = updates.find(u => u.status !== 'SENDING' && u.status);
    assert.equal(delivery?.status, code === null ? 'SENT' : code === 429 ? 'FAILED' : 'DEAD');
    if (code === null) assert.equal((delivery?.payload as Record<string, unknown>).messageId, 42);
    if (code === 429) assert(+(delivery?.nextAttemptAt as Date) >= Date.now() + 88000);
  }
});

test('Lost claim and changed recipient group cannot send a message', async () => {
  for (const claim of [0, 1]) {
    let finalStatus = '';
    const db = { notificationOutbox: {
      findMany: async () => [{ id: 'row', aggregateId: 'job', status: 'PENDING', attempts: 0, payload: { chatId: '-different' } }],
      updateMany: async () => ({ count: claim }),
      update: async ({ data }: { data: { status: string } }) => { finalStatus = data.status; },
    } } as unknown as NonNullable<Parameters<typeof processTelegramOutbox>[0]>['db'];
    await processTelegramOutbox({ db, config, track: (async () => ({ id: 'job' })) as typeof studyTracking, pause: async () => undefined, send: async () => { assert.fail('Message must not be sent'); } });
    assert.equal(finalStatus, claim ? 'DEAD' : '');
  }
});

test('Tracking checks center scope before reading any integration data', async () => {
  const db = { processingJob: { findFirst: async ({ where }: { where: { id: string; clientId: { in: string[] } } }) => { assert.equal(where.id, 'outside-job'); assert.deepEqual(where.clientId.in, ['center-a']); return null; } } } as unknown as Parameters<typeof studyTracking>[2];
  assert.equal(await studyTracking('outside-job', ['center-a'], db), null);
});

test('Tracking freezes completed report TAT and uses the recorded SLA snapshot', async () => {
  const approvedAt = new Date('2026-09-22T01:00:00Z');
  const db = {
    processingJob: { findFirst: async () => ({ ...job, status: 'completed', createdAt: new Date('2026-09-22T00:00:00Z'), bridgeStudy: null, client: { name: 'Center A' } }) },
    providerJobMapping: { findMany: async () => [{ reportReviewId: 'report-a', dectrocelJobId: 'job-1' }] },
    reportReview: { findMany: async ({ where }: { where: { clientId: string } }) => { assert.equal(where.clientId, job.clientId); return [{ status: 'APPROVED', modality: 'CT', approvedAt }]; } },
    notificationOutbox: { findUnique: async () => ({ status: 'SENT', attempts: 1, processedAt: approvedAt, payload: { targetSeconds: 1800 } }) },
    providerApiRequest: { findMany: async () => [{ id: 'request', direction: 'OUTBOUND', createdAt: approvedAt, responseCode: 200, metadata: { response: { accepted: true, token: 'hidden' } } }] },
    jobStatusHistory: { findMany: async () => [] },
  } as unknown as Parameters<typeof studyTracking>[2];
  const result = await studyTracking(job.id, ['center-a'], db);
  assert.equal(result?.status, 'Reported');
  assert.equal(result?.completedAt, approvedAt.toISOString());
  assert.equal(result?.dueAt, '2026-09-22T00:30:00.000Z');
  assert.equal(result?.exchanges[0].httpStatus, 200);
  assert(!JSON.stringify(result).includes('hidden'));
});
