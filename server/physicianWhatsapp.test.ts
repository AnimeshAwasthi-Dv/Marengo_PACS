import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { enqueuePhysicianReports, matchingPhysician, physicianDelivery, physicianNameKey, physicianWhatsappReady, PHYSICIAN_REPORT_READY, reportReadyTemplate, requestPhysicianCall } from './physicianWhatsapp';

const person = (changes = {}) => ({ id: 'physician', name: 'Dr. Amit Shah', role: 'REFERRING_PHYSICIAN', phoneE164: '+919876543210', clientId: null,
  active: true, consentStatus: 'OPTED_IN', verificationStatus: 'VERIFIED', createdAt: new Date('2026-01-01'), ...changes });

test('DICOM physician names match without fuzzy matches or ambiguous recipients', () => {
  assert.equal(physicianNameKey('Shah^Amit^^Dr.'), physicianNameKey('Dr Amit Shah'));
  assert.equal(matchingPhysician([person()], ['Shah^Amit', 'Dr. Amit Shah'], 'center')?.id, 'physician');
  for (const name of ['', 'A Shah', 'Amit Shah Jr', 'Amit Sharma']) assert.equal(matchingPhysician([person()], [name], 'center'), null);
  assert.equal(matchingPhysician([person()], ['Amit Shah', 'Another Doctor'], 'center'), null);
  assert.equal(matchingPhysician([person(), person({ id: 'duplicate' })], ['Amit Shah'], 'center'), null);
  assert.equal(matchingPhysician([person({ clientId: 'other' })], ['Amit Shah'], 'center'), null);
  assert.equal(matchingPhysician([person({ clientId: 'center' }), person({ id: 'other', clientId: 'other' })], ['Amit Shah'], 'center')?.id, 'physician');
  for (const changes of [{ active: false }, { consentStatus: 'OPTED_OUT' }, { verificationStatus: 'PENDING' }, { role: 'RADIOLOGIST' }]) {
    assert.equal(matchingPhysician([person(changes)], ['Amit Shah'], 'center'), null);
  }
});

function fixture() {
  const recipient = person();
  const report = { id: 'report', clientId: 'center', studyUid: '1.2.3', status: 'APPROVED', approvedAt: new Date('2026-02-01'), createdAt: new Date('2026-02-01'),
    aiReportJson: {}, editedReportJson: {}, radiologistId: 'radiologist', radiologist: { userId: 'radiologist-user' } };
  const state = { recipient, report, names: ['Shah^Amit'], shares: [] as any[], outbox: [] as any[], events: [] as any[], deliveries: [] as any[], userQuery: undefined as any };
  const db: any = {
    notificationRecipient: { findMany: async () => [state.recipient], findUnique: async () => state.recipient },
    availableBridgeStudy: { findMany: async ({ where }: any) => { assert.equal(where.clientId, 'center'); return state.names.map(referringPhysician => ({ referringPhysician })); } },
    reportReview: { findMany: async ({ where }: any) => { assert.deepEqual(where.status.in, ['APPROVED', 'PUSHED']); return [state.report]; }, findUnique: async () => state.report },
    reportPublicShare: { findUnique: async () => state.shares[0] ?? null, upsert: async ({ create }: any) => { if (!state.shares.length) state.shares.push(create); return state.shares[0]; } },
    notificationOutbox: {
      findUnique: async ({ where }: any) => state.outbox.find(item => where.id ? item.id === where.id : item.idempotencyKey === where.idempotencyKey) ?? null,
      upsert: async ({ create }: any) => { let entry = state.outbox.find(item => item.idempotencyKey === create.idempotencyKey); if (!entry) { entry = { ...create, id: 'outbox', status: 'PENDING' }; state.outbox.push(entry); } return entry; },
    },
    notificationEvent: { upsert: async ({ create }: any) => { let event = state.events.find(item => item.idempotencyKey === create.idempotencyKey); if (!event) { event = { ...create, id: 'event' }; state.events.push(event); } return event; } },
    user: { findMany: async (query: any) => { state.userQuery = query; return [{ id: 'superadmin', role: 'SUPER_ADMIN' }, ...(state.report.radiologist ? [{ id: 'radiologist-user', role: 'RADIOLOGIST' }] : [])]; } },
    notificationDelivery: { createMany: async ({ data, skipDuplicates }: any) => { assert.equal(skipDuplicates, true); for (const row of data) if (!state.deliveries.some(item => item.recipientKey === row.recipientKey)) state.deliveries.push(row); } },
  };
  db.$transaction = async (run: any) => run(db);
  return { db: db as PrismaClient, state };
}

test('report approval queues one report-only link for the exact recipient and preserves sent state', async () => {
  const { db, state } = fixture();
  await enqueuePhysicianReports(db);
  assert.equal(state.outbox.length, 1);
  assert.equal(state.outbox[0].eventType, PHYSICIAN_REPORT_READY);
  assert.deepEqual(state.outbox[0].payload.to, ['+919876543210']);
  assert.match(state.outbox[0].payload.shareToken, /\.report\./);
  state.outbox[0].status = 'SENT';
  await enqueuePhysicianReports(db);
  assert.equal(state.outbox.length, 1);
  assert.equal(state.outbox[0].status, 'SENT');
});

test('unmatched, ambiguous and historical reports do not create report links', async () => {
  for (const names of [[], ['Someone Else'], ['Amit Shah', 'Other Doctor']]) {
    const { db, state } = fixture(); state.names = names;
    await enqueuePhysicianReports(db); assert.equal(state.shares.length, 0); assert.equal(state.outbox.length, 0);
  }
  const { db, state } = fixture(); state.recipient.createdAt = new Date('2026-03-01');
  await enqueuePhysicianReports(db); assert.equal(state.outbox.length, 0);
});

test('expired existing shares are not renewed', async () => {
  const { db, state } = fixture(); state.shares.push({ token: 'expired', expiresAt: new Date('2020-01-01') });
  await enqueuePhysicianReports(db); assert.equal(state.outbox.length, 0); assert.equal(state.shares[0].token, 'expired');
});

test('delivery rechecks opt-out, phone reassignment, report status and revoked links', async () => {
  for (const mutate of [
    (state: any) => { state.recipient.consentStatus = 'OPTED_OUT'; },
    (state: any) => { state.recipient.phoneE164 = '+919999999999'; },
    (state: any) => { state.report.status = 'PENDING'; },
    (state: any) => { state.shares = []; },
    (state: any) => { state.shares[0].token = 'rotated'; },
  ]) {
    const { db, state } = fixture(); await enqueuePhysicianReports(db); mutate(state);
    assert.equal(await physicianDelivery(db, state.outbox[0].payload), null);
  }
});

test('call button notifies only Superadmin and assigned radiologist, once across retries', async () => {
  const previous = process.env.PORTAL_BASE_URL; process.env.PORTAL_BASE_URL = 'https://portal.example.com';
  try {
    const { db, state } = fixture(); await enqueuePhysicianReports(db);
    assert.equal(await requestPhysicianCall(db, state.recipient.phoneE164!, 'outbox'), false);
    state.outbox[0].status = 'SENT';
    assert.equal(await requestPhysicianCall(db, '+919999999999', 'outbox'), false);
    assert.equal(state.events.length, 0);
    assert.equal(await requestPhysicianCall(db, state.recipient.phoneE164!, 'outbox'), true);
    state.events[0].status = 'COMPLETED';
    assert.equal(await requestPhysicianCall(db, state.recipient.phoneE164!, 'outbox'), true);
    assert.equal(state.events.length, 1); assert.equal(state.events[0].status, 'COMPLETED');
    assert.deepEqual(state.deliveries.map(item => item.recipientUserId), ['superadmin', 'radiologist-user']);
    assert.deepEqual(state.userQuery.where, { active: true, OR: [{ role: 'SUPER_ADMIN' }, { id: 'radiologist-user', role: 'RADIOLOGIST' }] });
  } finally { if (previous === undefined) delete process.env.PORTAL_BASE_URL; else process.env.PORTAL_BASE_URL = previous; }
});

test('template supplies share link and a callback payload rather than a telephone dial action', () => {
  const message = reportReadyTemplate('+919876543210', 'https://portal.example.com/shared/token', 'outbox', 'approved_template', 'en');
  assert.equal(message.template.components[0].parameters[0].text, 'https://portal.example.com/shared/token');
  assert.equal(message.template.components[1].sub_type, 'quick_reply');
  assert.equal(message.template.components[1].parameters[0].payload, 'physician_call:outbox');
  assert.equal(physicianWhatsappReady({ WHATSAPP_CLOUD_API_ENABLED: 'true' }), false);
});
