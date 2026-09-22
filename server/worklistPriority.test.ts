import test from 'node:test';
import assert from 'node:assert/strict';
import { markWorklistUrgent, setWorklistPriority } from './worklistPriority';

function fixture({ jobStatus = '', priority = 'REGULAR', final = false, visible = true } = {}) {
  const changes: { table: string; data: Record<string, unknown> }[] = [];
  const study = { id: 'study-a', clientId: 'center-a', studyInstanceUid: 'uid-a', priority, workflowStatus: 'Available', processingJob: jobStatus ? { id: 'job-a', priority, status: jobStatus, providerJobId: null } : null };
  const tx = {
    availableBridgeStudy: {
      findFirst: async ({ where }: { where: { id: string; clientId: { in: string[] } } }) => { assert.equal(where.id, study.id); assert.deepEqual(where.clientId.in, ['center-a']); return visible ? study : null; },
      update: async ({ data }: { data: Record<string, unknown> }) => { changes.push({ table: 'study', data }); },
    },
    processingJob: { update: async ({ data }: { data: Record<string, unknown> }) => { changes.push({ table: 'job', data }); } },
    reportReview: { findFirst: async ({ where }: { where: { clientId: string; studyUid: string } }) => { assert.equal(where.clientId, study.clientId); assert.equal(where.studyUid, study.studyInstanceUid); return final ? { id: 'final-report' } : null; } },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { changes.push({ table: 'audit', data }); } },
  };
  const db = { $transaction: async (run: (tx: unknown) => unknown, options: { isolationLevel: string }) => { assert.equal(options.isolationLevel, 'Serializable'); return run(tx); } } as unknown as Parameters<typeof markWorklistUrgent>[3];
  return { db, changes };
}

test('Unsubmitted study can be marked Urgent without creating a processing job', async () => {
  const { db, changes } = fixture();
  const result = await markWorklistUrgent('study-a', ['center-a'], 'actor', db);
  assert.equal(result.priority, 'URGENT');
  assert.equal(result.requiresProviderFollowUp, false);
  assert.deepEqual(changes.map(c => c.table), ['study', 'audit']);
  assert.equal(changes[1].data.actorUserId, 'actor');
});

test('Urgent can be changed back to Routine on study and job, with audit and provider warning', async () => {
  const { db, changes } = fixture({ priority: 'URGENT', jobStatus: 'processing' });
  const result = await setWorklistPriority('study-a', ['center-a'], 'actor', 'REGULAR', db);
  assert.equal(result.priority, 'REGULAR');
  assert.equal(result.requiresProviderFollowUp, true);
  assert.equal(changes[0].data.priority, 'REGULAR');
  assert.equal(changes[1].data.priority, 'REGULAR');
  assert.equal(changes[2].data.action, 'STUDY_MARKED_ROUTINE');
  const unchanged = fixture();
  await setWorklistPriority('study-a', ['center-a'], 'actor', 'REGULAR', unchanged.db);
  assert.equal(unchanged.changes.length, 0);
  for (const options of [{ final: true }, { visible: false }]) {
    const blocked = fixture({ priority: 'URGENT', ...options });
    await assert.rejects(setWorklistPriority('study-a', ['center-a'], 'actor', 'REGULAR', blocked.db));
    assert.equal(blocked.changes.length, 0);
  }
});

test('Queued and active studies update both persisted priorities and clearly distinguish provider follow-up', async () => {
  for (const status of ['queued', 'processing', 'submitted_to_outsourced_teleradiology']) {
    const { db, changes } = fixture({ jobStatus: status });
    const result = await markWorklistUrgent('study-a', ['center-a'], 'actor', db);
    assert.deepEqual(changes.map(c => c.table), ['study', 'job', 'audit']);
    assert.equal(changes[0].data.priority, 'URGENT');
    assert.equal(changes[1].data.priority, 'URGENT');
    assert.equal(result.requiresProviderFollowUp, status !== 'queued');
  }
});

test('Marking an already urgent study is idempotent and creates no duplicate audit event', async () => {
  const { db, changes } = fixture({ priority: 'URGENT' });
  assert.equal((await markWorklistUrgent('study-a', ['center-a'], 'actor', db)).priority, 'URGENT');
  assert.equal(changes.length, 0);
});

test('Final reports, completed jobs and unrelated centers cannot be modified', async () => {
  for (const options of [{ final: true }, { jobStatus: 'completed' }, { visible: false }]) {
    const { db, changes } = fixture(options);
    await assert.rejects(markWorklistUrgent('study-a', ['center-a'], 'actor', db), error => {
      assert.equal((error as Error & { status: number }).status, options.visible === false ? 404 : 409);
      return true;
    });
    assert.equal(changes.length, 0);
  }
});
