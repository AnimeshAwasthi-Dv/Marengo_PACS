import test from 'node:test';
import assert from 'node:assert/strict';
import { istTimestamp, worklistDuration, worklistStatus, worklistPriority, worklistFacets, worklistModality } from '../src/pacsWorklist';

const facetRow = (receivedAt: string, modalities: string[], state: 'AVAILABLE' | 'REPORTING' | 'REPORTED' = 'AVAILABLE', priority: 'REGULAR' | 'URGENT' = 'REGULAR', needsAttention = false) => ({ receivedAt, study: { modalities }, state, priority, needsAttention });

test('Today modality counts use received time at IST midnight with overlapping urgency and attention', () => {
  const rows = [
    facetRow('2026-09-21T18:29:59Z', ['CT']),
    facetRow('2026-09-21T18:30:00Z', ['CT']),
    facetRow('2026-09-22T04:00:00Z', ['CT'], 'REPORTING', 'URGENT', true),
    facetRow('2026-09-22T18:29:59Z', ['CT'], 'REPORTED'),
    facetRow('2026-09-22T18:30:00Z', ['CT']),
    facetRow('2026-09-22T03:00:00Z', ['MR']),
    facetRow('invalid', ['CT']),
  ];
  const result = worklistFacets(rows, 'TODAY', 'CT', Date.parse('2026-09-22T10:00:00Z'));
  assert.deepEqual(result.counts, { ALL: 3, AVAILABLE: 1, REPORTING: 1, REPORTED: 1, URGENT: 1, FAILED: 1 });
  assert.deepEqual(result.modalityCounts, { CT: 3, MR: 1 });
  assert.equal(result.receivedCount, 4);
  assert.equal(worklistFacets(rows, 'TODAY', 'US', Date.parse('2026-09-22T10:00:00Z')).counts.ALL, 0);
});

test('Modality aliases group X-rays and MRI without double-counting multi-series studies', () => {
  const rows = [facetRow('2026-09-22T01:00:00Z', ['CR', 'DX', 'XR']), facetRow('2026-09-22T02:00:00Z', ['MRI'])];
  const result = worklistFacets(rows, 'ALL', 'X RAY', Date.now());
  assert.equal(result.counts.ALL, 1);
  assert.deepEqual(result.modalityCounts, { XR: 1, MR: 1 });
  assert.equal(worklistModality(' x-ray '), 'XR');
  assert.equal(result.receivedCount, 2);
});

test('Last seven days uses inclusive IST calendar days and excludes future dates', () => {
  const rows = [facetRow('2026-09-15T18:29:59Z', ['CT']), facetRow('2026-09-15T18:30:00Z', ['CT']), facetRow('2026-09-22T18:30:00Z', ['CT'])];
  assert.equal(worklistFacets(rows, 'WEEK', 'ALL', Date.parse('2026-09-22T10:00:00Z')).counts.ALL, 1);
  assert.equal(worklistFacets(rows, 'ALL', 'ALL', Date.now()).counts.ALL, 3);
});

test('Counts refresh across IST midnight and reflect new priority/status observations', () => {
  const rows = [facetRow('2026-09-22T18:30:00Z', ['CT'], 'REPORTING', 'URGENT')];
  assert.equal(worklistFacets(rows, 'TODAY', 'CT', Date.parse('2026-09-22T18:29:59Z')).counts.ALL, 0);
  assert.equal(worklistFacets(rows, 'TODAY', 'CT', Date.parse('2026-09-22T18:30:00Z')).counts.URGENT, 1);
  rows[0].state = 'REPORTED';
  assert.equal(worklistFacets(rows, 'TODAY', 'CT', Date.parse('2026-09-22T18:30:01Z')).counts.REPORTED, 1);
});

test('worklist priority normalizes urgent and maps regular or absent values to routine', () => {
  assert.equal(worklistPriority('URGENT'), 'URGENT');
  assert.equal(worklistPriority(' urgent '), 'URGENT');
  for (const value of ['REGULAR', 'ROUTINE', '', null, undefined]) assert.equal(worklistPriority(value), 'REGULAR');
});

test('IST timestamps cross UTC midnight and do not use the host timezone', () => {
  assert.deepEqual(istTimestamp('2026-09-22T20:00:00Z'), { date: '23 Sept 2026', time: '01:30:00', full: '23 Sept 2026 01:30:00 IST' });
  assert.equal(istTimestamp(null).full, '-');
  assert.equal(istTimestamp('invalid').full, '-');
});
test('TAT is a duration, stays fixed on completion, and supports more than 24 hours', () => {
  assert.equal(worklistDuration('2026-09-22T00:00:00Z', '2026-09-22T01:02:03Z'), '01:02:03');
  assert.equal(worklistDuration('2026-09-22T00:00:00Z', null, Date.parse('2026-09-23T02:03:04Z')), '26:03:04');
  assert.equal(worklistDuration('2026-09-22T01:00:00Z', '2026-09-22T00:00:00Z'), '-');
});
test('worklist has three clinical statuses and preserves reported delivery failures', () => {
  assert.equal(worklistStatus({workflowStatus:'Available'}), 'AVAILABLE');
  assert.equal(worklistStatus({workflowStatus:'Failed', processingJobId:'job'}), 'REPORTING');
  assert.equal(worklistStatus({workflowStatus:'AI Processing'}), 'REPORTING');
  assert.equal(worklistStatus({workflowStatus:'Failed', reportStatus:'APPROVED'}), 'REPORTED');
  assert.equal(worklistStatus({workflowStatus:'PACS Sent'}), 'REPORTED');
});
