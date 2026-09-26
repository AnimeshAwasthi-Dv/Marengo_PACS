import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStudyPages } from '../src/lib/studyPages';

test('first page is published before subsequent pages finish, with larger continuation batches', async () => {
  let published = false;
  const rows = await loadStudyPages(async (cursor, limit) => {
    if (!cursor) {
      assert.equal(limit, 100);
      return { studies: [{ id: 'a' }], nextCursor: 'a' };
    }
    assert.equal(published, true);
    assert.equal(cursor, 'a');
    assert.equal(limit, 500);
    return { studies: [{ id: 'a' }, { id: 'b' }] };
  }, { onFirstPage: (rows) => { assert.deepEqual(rows, [{ id: 'a' }]); published = true; } });
  assert.deepEqual(rows, [{ id: 'a' }, { id: 'b' }]);
});

test('a later-page failure rejects rather than returning an incomplete snapshot', async () => {
  await assert.rejects(loadStudyPages(async (cursor) => {
    if (cursor) throw new Error('Network unavailable');
    return { studies: [{ id: 'a' }], nextCursor: 'a' };
  }), /Network unavailable/);
});

test('cancelled requests never publish data or request a continuation', async () => {
  const controller = new AbortController();
  let published = false;
  let requests = 0;
  await assert.rejects(loadStudyPages(async () => {
    requests++;
    controller.abort();
    return { studies: [{ id: 'a' }], nextCursor: 'a' };
  }, { signal: controller.signal, onFirstPage: () => { published = true; } }), { name: 'AbortError' });
  assert.equal(published, false);
  assert.equal(requests, 1);
});

test('repeating cursors fail instead of causing an infinite request loop', async () => {
  await assert.rejects(loadStudyPages(async () => ({ studies: [{ id: 'a' }], nextCursor: 'a' })), /pagination stalled/);
});

test('empty worklists complete normally', async () => {
  assert.deepEqual(await loadStudyPages(async () => ({ studies: [] })), []);
});


test('background snapshot loads use one 500-row page without dropping records', async () => {
  let requests = 0;
  const studies = Array.from({ length: 400 }, (_, index) => ({ id: String(index) }));
  const rows = await loadStudyPages(async (_cursor, limit) => {
    requests++; assert.equal(limit, 500); return { studies };
  }, { firstPageSize: 500 });
  assert.equal(requests, 1); assert.deepEqual(rows, studies);
});
