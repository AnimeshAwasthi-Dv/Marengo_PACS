import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, nonOverlapping } from './runtime/tasks';
import { encodeBmp } from './platform/reportImages';

test('limiter bounds simultaneous jobs and releases slots after failures', async () => {
  const limit = createLimiter(2);
  let active = 0, peak = 0;
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => limit(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    if (i === 2) throw new Error('expected failure');
    return i;
  })));
  assert.equal(peak, 2); assert.equal(results.filter(r => r.status === 'fulfilled').length, 7);
});
test('periodic work skips overlapping calls and can run again', async () => {
  let finish!: () => void, calls = 0;
  const run = nonOverlapping(async () => { calls++; await new Promise<void>(resolve => { finish = resolve; }); });
  const first = run(); await run(); assert.equal(calls, 1); finish(); await first;
  const second = run(); assert.equal(calls, 2); finish(); await second;
});
test('BMP encoder preserves RGB colors, bottom-up rows and padding', () => {
  const bmp = encodeBmp(Buffer.from([255, 0, 0, 0, 0, 255]), 1, 2);
  assert.equal(bmp.toString('ascii', 0, 2), 'BM'); assert.equal(bmp.length, 62);
  assert.deepEqual([...bmp.subarray(54)], [255, 0, 0, 0, 0, 0, 255, 0]);
});
