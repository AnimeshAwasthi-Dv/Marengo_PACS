import assert from 'node:assert/strict';
import test from 'node:test';
import { startLiveRefresh } from '../src/liveRefresh';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('live refresh repeats at five seconds and stops cleanly', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const live = startLiveRefresh(async () => { count++; });
  t.mock.timers.tick(0); await flush();
  assert.equal(count, 1);
  t.mock.timers.tick(4999); assert.equal(count, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(count, 2);
  live.stop(); t.mock.timers.tick(60_000); assert.equal(count, 2);
});

test('focus/reconnect events coalesce while a request is in flight', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  let release!: () => void;
  const live = startLiveRefresh(async () => { count++; await new Promise<void>((resolve) => { release = resolve; }); });
  t.mock.timers.tick(0); live.trigger(); live.trigger(); assert.equal(count, 1);
  release(); await flush(); t.mock.timers.tick(0); assert.equal(count, 2);
  live.stop(); release(); await flush();
});

test('hidden or offline sessions pause requests and resume immediately', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let visible = false;
  let count = 0;
  const live = startLiveRefresh(async () => { count++; }, { canRefresh: () => visible });
  t.mock.timers.tick(5000); await flush(); assert.equal(count, 0);
  visible = true; live.trigger(); await flush(); assert.equal(count, 1);
  visible = false; t.mock.timers.tick(5000); await flush(); assert.equal(count, 1);
  live.stop();
});

test('failures back off and successful reconnect restores the normal interval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const live = startLiveRefresh(async () => { if (++count === 1) throw new Error('Offline'); });
  t.mock.timers.tick(0); await flush();
  t.mock.timers.tick(5000); assert.equal(count, 1);
  t.mock.timers.tick(5000); await flush(); assert.equal(count, 2);
  t.mock.timers.tick(5000); await flush(); assert.equal(count, 3);
  live.stop();
});

test('cleanup aborts pending fetches and does not schedule another update', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal!: AbortSignal;
  let count = 0;
  const live = startLiveRefresh(async (value) => {
    signal = value; count++;
    await new Promise<void>((_, reject) => value.addEventListener('abort', () => reject(value.reason)));
  });
  t.mock.timers.tick(0); assert(!signal.aborted);
  live.stop(); await flush(); assert(signal.aborted);
  t.mock.timers.tick(60_000); assert.equal(count, 1);
});
