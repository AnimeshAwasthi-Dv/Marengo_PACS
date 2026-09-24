export const LIVE_REFRESH_MS = 5_000;

// One in-flight refresh per subscription, including focus/reconnect triggers.
export function startLiveRefresh(refresh: (signal: AbortSignal) => Promise<void>, options: {
  intervalMs?: number;
  immediate?: boolean;
  canRefresh?: () => boolean;
} = {}) {
  const interval = options.intervalMs ?? LIVE_REFRESH_MS;
  let stopped = false;
  let running = false;
  let pending = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  function schedule(delay: number) {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => void run(), delay);
  }
  async function run() {
    if (stopped) return;
    clearTimeout(timer);
    if (running) { pending = true; return; }
    if (options.canRefresh && !options.canRefresh()) { schedule(interval); return; }
    running = true;
    controller = new AbortController();
    const signal = controller.signal;
    deadline = setTimeout(() => controller?.abort(new DOMException('Automatic refresh timed out', 'TimeoutError')), 30_000);
    try { await refresh(signal); if (signal.aborted) throw new Error('Refresh cancelled'); failures = 0; }
    catch { failures = Math.min(failures + 1, 3); }
    finally {
      clearTimeout(deadline);
      running = false;
      if (!stopped) schedule(pending ? 0 : Math.min(interval * 2 ** failures, Math.max(interval, 30_000)));
      pending = false;
    }
  }
  schedule(options.immediate === false ? interval : 0);
  return {
    trigger: () => { void run(); },
    stop: () => { stopped = true; clearTimeout(timer); clearTimeout(deadline); controller?.abort(); },
  };
}
