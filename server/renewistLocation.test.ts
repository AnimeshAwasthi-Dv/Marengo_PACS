import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RenewistAdapter } from './renewistAdapter';

test('Renewist multipart includes configured location for each center and keeps the marengo slug', async () => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'renewist-location-'));
 const zip = path.join(dir, 'study.zip');
 await fs.writeFile(zip, 'test study archive');
 const bodies: string[] = [];
 const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
  bodies.push(Buffer.concat(chunks).toString()); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ job_id: 'accepted' }));
 });
 const previous = process.env.RENEWIST_OUTBOUND_STUDY_SUBMISSION_URL;
 try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as { port: number };
  process.env.RENEWIST_OUTBOUND_STUDY_SUBMISSION_URL = 'http://127.0.0.1:' + address.port + '/reports';
  const adapter = new RenewistAdapter({ apiKey: 'local-test-only' });
  for (const location of [' Ahmedabad ', 'Faridabad', null]) await adapter.submitStudy({ dectrocelJobId: 'test-job', workflowType: 'TELERADIOLOGY_ONLY', studyZipPath: zip, location });
  assert(bodies[0].includes('name="location"\r\n\r\nAhmedabad\r\n'));
  assert(bodies[1].includes('name="location"\r\n\r\nFaridabad\r\n'));
  assert(bodies[2].includes('name="location"\r\n\r\n\r\n'));
  for (const body of bodies) { assert(body.includes('name="hospital_slug"\r\n\r\nmarengo\r\n')); assert(body.includes('name="study"; filename="study.zip"')); }
 } finally {
  if (previous === undefined) delete process.env.RENEWIST_OUTBOUND_STUDY_SUBMISSION_URL; else process.env.RENEWIST_OUTBOUND_STUDY_SUBMISSION_URL = previous;
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  await fs.unlink(zip); await fs.rmdir(dir);
 }
});
