import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, evidenceHash, evidenceRecord, correctStudyStatus } from './adminEvidence';

test('Evidence hashes are deterministic and exported credentials are redacted', () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  assert.equal(evidenceHash({ b: 2, a: 1 }), evidenceHash({ a: 1, b: 2 }));
  const row = evidenceRecord({ id: 'a', source: 'Renewist INBOUND', at: new Date('2026-09-22T00:00:00Z'), action: 'ACCEPTED', details: { password: 'sensitive', nested: { token: 'hidden' }, ok: true } });
  assert(!JSON.stringify(row).includes('sensitive'));
  assert(!JSON.stringify(row).includes('hidden'));
  const { exportSha256, ...rest } = row;
  assert.equal(exportSha256, evidenceHash(rest));
  assert.notEqual(exportSha256, evidenceHash({ ...rest, action: 'CHANGED' }));
  const optional = evidenceRecord({ id: 'optional', source: 'test', at: new Date(), action: 'test', actorId: undefined, details: { absent: undefined } });
  const { exportSha256: hash, ...serialized } = JSON.parse(JSON.stringify(optional));
  assert.equal(hash, evidenceHash(serialized));
});

function fixture(finalized = false) {
  const writes: { table: string; data: any }[] = [];
  const updatedAt = new Date('2026-09-22T00:00:00Z');
  const db = { $transaction: async (run: (tx: unknown) => unknown) => run({
    availableBridgeStudy: { findUnique: async () => ({ id: 'study', clientId: 'center', studyInstanceUid: 'uid', workflowStatus: 'Processing', updatedAt, processingJobId: 'job', processingJob: { id: 'job', status: 'processing' } }), update: async ({ data }: { data: unknown }) => { writes.push({ table: 'study', data }); } },
    processingJob: { update: async ({ data }: { data: unknown }) => { writes.push({ table: 'job', data }); } },
    reportReview: { findFirst: async () => finalized ? { id: 'report' } : null },
    auditLog: { create: async ({ data }: { data: unknown }) => { writes.push({ table: 'audit', data }); } },
    jobStatusHistory: { create: async ({ data }: { data: unknown }) => { writes.push({ table: 'history', data }); } },
  }) } as unknown as Parameters<typeof correctStudyStatus>[4];
  return { db, writes, updatedAt };
}
test('Super-admin corrections retain before/after, reason, actor and IP without provider calls', async () => {
  const { db, writes, updatedAt } = fixture();
  await correctStudyStatus('study', { status: 'Needs attention', reason: 'Verified failed submission', expectedUpdatedAt: updatedAt.toISOString() }, 'admin', '127.0.0.1', db);
  assert.deepEqual(writes.map(w => w.table), ['study', 'job', 'audit', 'history']);
  assert.equal(writes[2].data.actorUserId, 'admin');
  assert.equal(writes[2].data.ipAddress, '127.0.0.1');
  assert.equal(writes[2].data.metadata.before.jobStatus, 'processing');
  assert.equal(writes[2].data.metadata.after.jobStatus, 'failed');
  assert.equal(writes[2].data.metadata.providerUpdated, false);
});
test('Corrections reject missing reason, stale writes, fake completion, final-report downgrade and duplicate submission', async () => {
  for (const item of [{ status: 'Reported', final: false }, { status: 'Reporting', final: true }, { status: 'Available', final: false }, { status: 'bogus', final: false }, { status: 'Reporting', final: false, reason: 'short' }, { status: 'Reporting', final: false, stale: true }]) {
    const { db, writes, updatedAt } = fixture(item.final);
    await assert.rejects(correctStudyStatus('study', { status: item.status, reason: item.reason ?? 'Verified administrative correction', expectedUpdatedAt: item.stale ? new Date().toISOString() : updatedAt.toISOString() }, 'admin', undefined, db));
    assert.equal(writes.length, 0);
  }
});
