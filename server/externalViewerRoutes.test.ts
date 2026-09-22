import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerExternalViewerRoutes } from './viewer/routes';

test('viewer entry points enforce authorization, center scope and public share scope', async () => {
  const app = express();
  let publicRequiresImages = false;
  const pass = (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers.authorization !== 'Bearer test-session') { res.status(401).json({ message: 'Missing session' }); return; }
    req.user = { sub: 'tester', role: 'CLIENT_USER', clientId: 'allowed-center' }; next();
  };
  registerExternalViewerRoutes(app, {
    prisma: { patientStudyArchive: { findUnique: async () => ({ clientId: 'other-center', studyInstanceUid: '1.2.3' }) }, availableBridgeStudy: { findFirst: async () => null } },
    requireAuth, requireRadiologist: pass,
    accessibleClientIds: async () => ['allowed-center'], workspaceStudyScope: async () => ({ clientId: 'allowed-center' }),
    getAccessibleProcessingJob: async () => null, extractQueuedMetadata: () => ({}),
    publicSharedReport: async (_token: string, requireViewer: boolean) => { publicRequiresImages = requireViewer; return null; },
    getAuthorizedReport: async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); },
    canRadiologistAccessReport: async () => false, isGroupRadiologistProfile: async () => false,
    getDicomMetadataValue: () => null,
  } as unknown as Parameters<typeof registerExternalViewerRoutes>[1]);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const headers = { Authorization: 'Bearer test-session' };
  try {
    assert.equal((await fetch(`${base}/api/reports/report/viewer-session`)).status, 401);
    assert.equal((await fetch(`${base}/api/reports/report/viewer-session`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/api/patient-study-archives/archive/viewer-session`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/api/client/study-sync/available-studies/study/viewer-session`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/api/public/reports/report-only-share/viewer-session`)).status, 404);
    assert.equal(publicRequiresImages, true);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
