import test from 'node:test';
import assert from 'node:assert/strict';
import { needsFullAdminOverview } from '../src/lib/adminOverview';
test('independent operational pages do not request the large legacy overview', () => {
  for (const section of ['Dashboard', 'Technical Alerts', 'Healthcheck', 'Analytics', 'Audit Logs', 'Patients', 'Follow-ups']) assert.equal(needsFullAdminOverview(section), false);
  for (const section of ['Centers', 'Processing', 'Radiologists', 'WhatsApp Configuration']) assert.equal(needsFullAdminOverview(section), true);
});
