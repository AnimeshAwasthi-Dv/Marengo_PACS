import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import FormData from 'form-data';
import { postMultipartStream } from './renewistAdapter';
import { submissionRetryDue } from './submissionRetryPolicy';
import { reportInstanceUid } from './reportInstanceUid';
import { technicalAlertExcluded } from './technicalAlertPolicy';
import type { TestContext } from 'node:test';
import { renewistCallbackIdentity } from './renewistCallbackIdentity';

test('fallback becomes due after exactly three minutes and is limited to one attempt', () => {
  const failedAt = new Date('2026-10-08T00:00:00Z');
  assert.equal(submissionRetryDue(0, failedAt)?.toISOString(), '2026-10-08T00:03:00.000Z');
  assert.equal(submissionRetryDue(1, failedAt), null);
  assert.equal(submissionRetryDue(2, failedAt), null);
});

test('operational failures bypass health-probe notification exclusions', () => {
  assert.equal(technicalAlertExcluded({ id: 'operation:WhatsApp:outbox1', service: 'WhatsApp' }), false);
});

test('callback retries have stable identities despite new temporary paths and default timestamps', () => {
  const report = { dectrocel_job_id: 'job-a', renewist_job_id: 'provider-a', report_version: 1, report_status: 'FINAL', reportChecksum: 'signed-content' };
  const id = renewistCallbackIdentity({ ...report, reported_at: 'first', reportFilePath: '/first.pdf' });
  assert.equal(id, renewistCallbackIdentity({ ...report, reported_at: 'second', reportFilePath: '/second.pdf' }));
  assert.notEqual(id, renewistCallbackIdentity({ ...report, report_version: 2 }));
  assert.notEqual(id, renewistCallbackIdentity({ ...report, reportChecksum: 'amended-content' }));
});

test('PACS retries preserve instance identity, amendments and other reports get different identities', () => {
  const uid = reportInstanceUid('report-1', Buffer.from('signed PDF'), 'PDF');
  assert.equal(uid, reportInstanceUid('report-1', Buffer.from('signed PDF'), 'PDF'));
  assert.notEqual(uid, reportInstanceUid('report-1', Buffer.from('amended PDF'), 'PDF'));
  assert.notEqual(uid, reportInstanceUid('report-2', Buffer.from('signed PDF'), 'PDF'));
  assert.match(uid, /^2\.25\.\d+$/);
  assert.ok(uid.length <= 64);
});

async function endpoint(t: TestContext, handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/upload`;
}
function multipart() { const form = new FormData(); form.append('study', Buffer.from('test')); return form; }

test('absolute upload deadline stops a continuously streaming response', async t => {
  const url = await endpoint(t, (_req, res) => {
    res.writeHead(200); res.write(' ');
    const timer = setInterval(() => res.write(' '), 10);
    res.on('close', () => clearInterval(timer));
  });
  const form = multipart();
  await assert.rejects(postMultipartStream(url, form, form.getHeaders(), 100), /timed out/);
});

test('broken response rejects instead of hanging the submission queue', async t => {
  const url = await endpoint(t, (_req, res) => {
    res.writeHead(200, { 'Content-Length': '1000' }); res.write('partial');
    setTimeout(() => res.destroy(), 20);
  });
  const form = multipart();
  await assert.rejects(postMultipartStream(url, form, form.getHeaders(), 1000), /interrupted|aborted/);
});

test('force termination aborts an active upload', async t => {
  const url = await endpoint(t, () => {});
  const controller = new AbortController();
  const form = multipart();
  const pending = postMultipartStream(url, form, form.getHeaders(), 2000, controller.signal);
  controller.abort();
  await assert.rejects(pending, /abort/i);
});

async function studyAction(t: TestContext, options: { role?: string; linked?: boolean; final?: boolean; remove?: boolean; reason?: string } = {}) {
  process.env.JWT_SECRET ||= 'local-unit-test-secret';
  const { prisma } = await import('./db');
  const { workspaceRouter } = await import('./workspaceRouter');
  const changes: Array<{ model: string; data: any }> = [];
  const job = options.linked === false ? null : { id: 'job-a', status: 'outbound_submission_failed', clinicalStatus: 'FAILED' };
  const study = { id: 'study-a', clientId: 'center-a', publicStudyId: 'PUBLIC-A', studyInstanceUid: '1.2.3', processingJobId: job?.id ?? null, processingJob: job, workflowStatus: options.final ? 'ReportGenerated' : 'Receiving', submittedAt: null };
  const model = (name: string) => Object.fromEntries(['update', 'updateMany', 'create', 'delete', 'upsert'].map(method => [method, async (data: any) => { changes.push({ model: `${name}.${method}`, data }); return { count: 1 }; }]));
  const tx = {
    $executeRaw: async () => 1,
    availableBridgeStudy: { ...model('study'), findUnique: async () => study },
    processingJob: model('job'),
    reportReview: { findFirst: async () => options.final ? { id: 'report-a', status: 'APPROVED' } : null },
    bridgeDispatchRequest: model('dispatch'),
    providerJobMapping: { ...model('mapping'), findMany: async () => [{ reportReviewId: 'report-a' }] },
    pacsReturnJob: model('pacs'), notificationOutbox: model('notifications'), jobStatusHistory: model('history'), auditLog: model('audit'), deletedPortalStudy: model('tombstone'),
  };
  const originalTransaction = prisma.$transaction;
  prisma.$transaction = (async (callback: any) => callback(tx)) as typeof prisma.$transaction;
  t.after(() => { prisma.$transaction = originalTransaction; });
  const layer = workspaceRouter.stack.find((item: any) => Array.isArray(item.route?.path) && item.route.path.includes('/studies/:studyId/terminate-processing')) as any;
  let status = 200; let body: any;
  const res = { status(value: number) { status = value; return this; }, json(value: any) { body = value; return this; } };
  await layer.route.stack[0].handle({ method: options.remove ? 'DELETE' : 'POST', path: options.remove ? '/studies/study-a' : '/studies/study-a/terminate-processing', params: { studyId: 'study-a' }, user: { role: options.role ?? 'SUPER_ADMIN', sub: 'admin-a' }, body: { reason: options.reason ?? 'Stop this stuck study' } }, res, (error: unknown) => { if (error) throw error; });
  return { status, body, changes };
}

test('termination works without a linked job and blocks automatic resubmission', async t => {
  const result = await studyAction(t, { linked: false });
  assert.equal(result.status, 200);
  assert.equal(result.changes.find(c => c.model === 'study.update')?.data.data.autoSubmitBlocked, true);
  assert.equal(result.changes.some(c => c.model === 'job.update'), false);
});

test('termination cancels retries and PACS returns and aborts an active upload', async t => {
  const { beginProcessing } = await import('./processingControl');
  const active = beginProcessing('job-a');
  t.after(active.finish);
  const result = await studyAction(t);
  assert.equal(result.status, 200);
  assert.equal(result.changes.find(c => c.model === 'job.update')?.data.data.status, 'cancelled');
  assert.equal(result.changes.find(c => c.model === 'job.update')?.data.data.submissionRetryAt, null);
  assert.equal(result.changes.find(c => c.model === 'pacs.updateMany')?.data.data.status, 'CANCELLED');
  assert.equal(active.signal.aborted, true);
});

test('deletion retains report history and persists a reimport tombstone', async t => {
  const result = await studyAction(t, { remove: true, final: true });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'Deleted');
  assert.ok(result.changes.some(c => c.model === 'tombstone.upsert'));
  assert.ok(result.changes.some(c => c.model === 'study.delete'));
  assert.equal(result.changes.some(c => c.model.startsWith('report.')), false);
});

test('study controls reject other roles and empty reasons before mutations', async t => {
  const forbidden = await studyAction(t, { role: 'CLIENT_USER' });
  assert.equal(forbidden.status, 403); assert.equal(forbidden.changes.length, 0);
  const invalid = await studyAction(t, { reason: ' ' });
  assert.equal(invalid.status, 400); assert.equal(invalid.changes.length, 0);
});
