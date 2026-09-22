/** Skip overlapping ticks so slow disk/network work cannot pile up. */
export function nonOverlapping(task: () => Promise<unknown>, onError: (error: unknown) => void = console.error) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try { await task(); } catch (error) { onError(error); } finally { running = false; }
  };
}

/** Bounds expensive report browser processes without changing report output. */
export function createLimiter(concurrency: number) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Concurrency must be a positive integer');
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>(resolve => waiting.push(resolve));
    else active++;
    try { return await task(); } finally {
      const next = waiting.shift();
      if (next) next(); else active--;
    }
  };
}
