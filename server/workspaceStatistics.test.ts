import assert from 'node:assert/strict';
import test from 'node:test';
import { csvDocument, durationSeconds, istDay, statisticsRange, summarizeStudies, type StatisticsRow } from './workspaceStatistics';

test('daily statistics use IST midnight, not server timezone', () => {
  const range = statisticsRange('2026-09-22', '2026-09-22');
  assert.equal(range.start.toISOString(), '2026-09-21T18:30:00.000Z');
  assert.equal(range.end.toISOString(), '2026-09-22T18:30:00.000Z');
  assert.equal(istDay('2026-09-21T18:29:59Z'), '2026-09-21');
  assert.equal(istDay('2026-09-21T18:30:00Z'), '2026-09-22');
});
test('range rejects invalid dates, reverse ranges and excessive ranges', () => {
  for (const [from, to] of [['2026-02-30', '2026-03-01'], ['2026-09-23', '2026-09-22'], ['2020-01-01', '2026-09-22'], ['junk', '2026-09-22']]) assert.throws(() => statisticsRange(from, to));
});
test('TAT preserves zero seconds, excludes negative or incomplete durations', () => {
  assert.equal(durationSeconds('2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z'), 0);
  assert.equal(durationSeconds('2026-09-22T00:00:00Z', '2026-09-22T01:01:01Z'), 3661);
  assert.equal(durationSeconds(null, '2026-09-22T00:00:00Z'), null);
  assert.equal(durationSeconds('2026-09-22T01:00:00Z', '2026-09-22T00:00:00Z'), null);
});
test('daily event counts include carry-in processing and exclude exclusive end boundary', () => {
  const row = { received: '2026-09-20T00:00:00Z', processed: '2026-09-21T18:30:00Z', reported: '2026-09-22T00:00:00Z', tatSeconds: 0 } as StatisticsRow;
  const result = summarizeStudies([row], [{ at: row.reported! }, { at: '2026-09-22T18:30:00Z' }], statisticsRange('2026-09-22', '2026-09-22'));
  assert.deepEqual(result.totals, { received: 0, processed: 1, reported: 1, averageTatSeconds: 0, tatSampleSize: 1 });
  assert.equal(result.daily.length, 1);
});
test('empty period has zero-filled days and no fabricated average', () => {
  const result = summarizeStudies([], [], statisticsRange('2026-09-21', '2026-09-22'));
  assert.equal(result.daily.length, 2);
  assert.equal(result.totals.averageTatSeconds, null);
});
test('CSV quotes values and protects spreadsheet formula injection', () => {
  const text = csvDocument([['=CMD()', '  +formula', '@SUM(A1)', 'Doe, Jane', 'line\nbreak', 'a"b', null, 0]]);
  assert(text.startsWith('\uFEFF'));
  assert(text.includes('"\'=CMD()"'));
  assert(text.includes('"\'  +formula"'));
  assert(text.includes('"Doe, Jane"'));
  assert(text.includes('"a""b"'));
  assert(text.endsWith('"","0"'));
});
