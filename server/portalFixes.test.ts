import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeCallPhone, preferredCallWindows, withoutCharges } from './callScheduling';
import { followUpStatusFilter } from './followUps';
import { resolveArchivePath } from './viewer/archivePaths';

test('preferred windows do not require availability and preserve requested duration', () => {
  const now = Date.parse('2026-09-24T10:01:00Z');
  const windows = preferredCallWindows(20, now);
  assert.equal(windows.length, 336);
  assert(Date.parse(windows[0].slotStart) > now);
  assert.equal(Date.parse(windows[0].slotEnd) - Date.parse(windows[0].slotStart), 20 * 60_000);
  assert.equal(new Set(windows.map(window => window.id)).size, windows.length);
});
test('phone requests normalize Indian and international numbers and reject invalid input', () => {
  assert.equal(normalizeCallPhone('98765 43210'), '+919876543210');
  assert.equal(normalizeCallPhone('+44 7700 900123'), '+447700900123');
  assert.throws(() => normalizeCallPhone('123'));
});
test('charge redaction covers nested bookings without removing call links or dates', () => {
  const when = new Date();
  const value = { bookings: [{ estimatedAmountMinor: 1000, finalAmountMinor: 1200, pricePerMinuteMinor: 10, slotStart: when, meetingUrl: 'https://meet.jit.si/test' }], billing: { amount: 12 } };
  assert.deepEqual(withoutCharges(value), { bookings: [{ slotStart: when, meetingUrl: 'https://meet.jit.si/test' }] });
  assert.equal(value.bookings[0].estimatedAmountMinor, 1000);
});
test('overdue filter includes scheduled and pending records before pagination', () => {
  const now = new Date();
  assert.deepEqual(followUpStatusFilter('OVERDUE', now), { OR: [{ status: 'OVERDUE' }, { status: { in: ['PENDING','SCHEDULED'] }, followUpDate: { lt: now } }] });
  assert.deepEqual(followUpStatusFilter('COMPLETED', now), { status: 'COMPLETED' });
  assert.deepEqual(followUpStatusFilter('PENDING', now), { status: 'PENDING', followUpDate: { gte: now } });
});
test('legacy archives resolve inside configured roots and reject path traversal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'marengo-archive-test-'));
  try {
    const uploads = path.join(root, 'uploads'); await mkdir(path.join(uploads, 'bridge'), { recursive: true });
    const file = path.join(uploads, 'bridge', 'study.zip'); await writeFile(file, 'fixture'); await writeFile(path.join(root, 'outside.zip'), 'outside');
    assert.equal(await resolveArchivePath('C:\\old-server\\uploads\\bridge\\study.zip', [uploads]), await import('node:fs/promises').then(fs => fs.realpath(file)));
    assert.equal(await resolveArchivePath('C:\\old-server\\uploads\\..\\outside.zip', [uploads]), null);
    assert.equal(await resolveArchivePath('s3://bucket/key', [uploads]), null);
  } finally { if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unexpected test path'); await rm(root, { recursive: true }); }
});
