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
  assert.deepEqual(result.totals, { received: 0, processed: 1, reported: 1, averageTatSeconds: 0, tatSampleSize: 1, averageTbScore: null, tbScoreSampleSize: 0, reportsReplaced: 0 });
  assert.equal(result.daily.length, 1);
});
test('analytics aggregates received rows into hourly, modality, TB and replacement summaries', () => {
  const range = statisticsRange('2026-09-22', '2026-09-22');
  const rows = [
    { received: '2026-09-21T18:30:00Z', processed: null, reported: '2026-09-21T19:00:00Z', tatSeconds: 1800, modality: 'CT, MR', tbScore: 0.8, replacementCount: 2 } as StatisticsRow,
    { received: '2026-09-22T12:15:00Z', processed: null, reported: '2026-09-22T13:15:00Z', tatSeconds: 3600, modality: '', tbScore: null, replacementCount: 0 } as StatisticsRow,
    { received: '2026-09-22T18:30:00Z', processed: null, reported: null, tatSeconds: null, modality: 'CT', tbScore: 99 } as StatisticsRow,
  ];
  const result = summarizeStudies(rows, [{ at: rows[0].reported! }, { at: rows[1].reported! }], range);
  assert.equal(result.daily[0].received, 2);
  assert.equal(result.hourly.length, 24);
  assert.equal(result.hourly[0].studies, 1);
  assert.equal(result.hourly[17].studies, 1);
  assert.deepEqual(result.modalityDistribution.map(row => [row.modality, row.count]), [['CT', 1], ['MR', 1], ['Other', 1]]);
  assert.equal(result.totals.averageTatSeconds, 2700);
  assert.equal(result.totals.averageTbScore, 0.8);
  assert.equal(result.totals.tbScoreSampleSize, 1);
  assert.equal(result.totals.reportsReplaced, 1);
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
