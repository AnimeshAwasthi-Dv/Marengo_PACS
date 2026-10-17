import test from 'node:test';
import assert from 'node:assert/strict';
import { markProcessingJobUrgent, markWorklistUrgent, setWorklistPriority } from './worklistPriority';
import { canChangeJobPriority, canChangeStudyPriority } from '../src/studyPriority';

function fixture({ jobStatus = '', priority = 'REGULAR', final = false, visible = true, providerJobId = null as string | null, submissionRetryCount = 0, mapped = false, claimedDuringUpdate = false } = {}) {
  const changes: { table: string; data: Record<string, unknown> }[] = [];
  const job = { id: 'job-a', clientId: 'center-a', priority, status: jobStatus, providerJobId, submissionRetryCount, createdAt: new Date(), upstreamStatus: {}, uploadName: 'study.zip' };
  const study = { id: 'study-a', clientId: 'center-a', studyInstanceUid: 'uid-a', priority, workflowStatus: 'Available', processingJobId: jobStatus ? job.id : null, processingJob: jobStatus ? job : null };
  const tx = {
    availableBridgeStudy: {
      findFirst: async ({ where }: { where: { id: string; clientId: { in: string[] } } }) => { assert.equal(where.id, study.id); assert.deepEqual(where.clientId.in, ['center-a']); return visible ? study : null; },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { changes.push({ table: 'study', data }); return { count: 1 }; },
    },
    processingJob: {
      findFirst: async ({ where }: { where: { id: string; clientId: string } }) => { assert.equal(where.id, 'job-a'); assert.equal(where.clientId, 'center-a'); return visible ? job : null; },
      findUniqueOrThrow: async () => ({ ...job, priority: 'URGENT' }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        assert.equal(where.status, 'queued'); assert.equal(where.providerJobId, null); assert.equal(where.submissionRetryCount, 0);
        if (claimedDuringUpdate) return { count: 0 };
        changes.push({ table: 'job', data }); return { count: 1 };
      },
    },
    providerJobMapping: { findFirst: async () => mapped ? { id: 'mapping' } : null },
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

test('Urgent can be changed back to Routine while still queued before submission', async () => {
  const { db, changes } = fixture({ priority: 'URGENT', jobStatus: 'queued' });
  const result = await setWorklistPriority('study-a', ['center-a'], 'actor', 'REGULAR', db);
  assert.equal(result.priority, 'REGULAR');
  assert.equal(result.requiresProviderFollowUp, false);
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

test('Both priority directions are blocked once submission starts, including failed and requeued submissions', async () => {
  const options = [
    ...['submitting_to_renewist', 'processing', 'submitted_to_outsourced_teleradiology', 'sent_to_radiologist', 'outbound_submission_failed', 'failed', 'cancelled'].map(jobStatus => ({ jobStatus })),
    { jobStatus: 'queued', providerJobId: 'renewist-accepted' }, { jobStatus: 'queued', submissionRetryCount: 1 }, { jobStatus: 'queued', mapped: true },
  ];
  for (const option of options) for (const priority of ['URGENT', 'REGULAR'] as const) {
    const { db, changes } = fixture({ ...option, priority: priority === 'URGENT' ? 'REGULAR' : 'URGENT' });
    await assert.rejects(setWorklistPriority('study-a', ['center-a'], 'actor', priority, db), error => (error as Error & { status: number }).status === 409);
    assert.equal(changes.length, 0);
  }
});

test('A worker claiming the job during a priority request prevents all changes', async () => {
  const { db, changes } = fixture({ jobStatus: 'queued', claimedDuringUpdate: true });
  await assert.rejects(markWorklistUrgent('study-a', ['center-a'], 'actor', db), /submission to Renewist has started/);
  assert.equal(changes.length, 0);
});

test('Legacy processing-job priority endpoint uses the same atomic submission guard and keeps the study in sync', async () => {
  const before = fixture({ jobStatus: 'queued' });
  assert.equal((await markProcessingJobUrgent('job-a', 'center-a', 'actor', before.db)).priority, 'URGENT');
  assert.deepEqual(before.changes.map(change => change.table), ['job', 'study', 'audit']);
  for (const options of [{ jobStatus: 'submitting_to_renewist' }, { jobStatus: 'queued', mapped: true }, { jobStatus: 'queued', providerJobId: 'accepted' }, { jobStatus: 'queued', claimedDuringUpdate: true }, { jobStatus: 'queued', visible: false }]) {
    const blocked = fixture(options);
    await assert.rejects(markProcessingJobUrgent('job-a', 'center-a', 'actor', blocked.db));
    assert.equal(blocked.changes.length, 0);
  }
  await assert.rejects(markProcessingJobUrgent('job-a', '', 'actor', before.db), /center account/);
});

test('Worklist controls are read-only during and after submission, with queued studies editable', () => {
  const base = { workflowStatus: 'Available', processingJobId: null };
  assert.equal(canChangeStudyPriority(base), true);
  assert.equal(canChangeStudyPriority({ ...base, processingJobId: 'job' }), false);
  for (const status of ['submitting_to_renewist', 'processing', 'submitted_to_outsourced_teleradiology', 'completed', 'failed']) {
    assert.equal(canChangeStudyPriority({ ...base, processingJob: { status } }), false);
    assert.equal(canChangeJobPriority({ status }), false);
  }
  assert.equal(canChangeJobPriority({ status: 'queued', providerJobId: 'accepted' }), false);
  assert.equal(canChangeJobPriority({ status: 'queued', submissionRetryCount: 1 }), false);
  assert.equal(canChangeStudyPriority({ ...base, workflowStatus: 'SubmittedToRenewist' }), false);
  assert.equal(canChangeStudyPriority({ ...base, processingJob: { status: 'queued' } }), true);
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
