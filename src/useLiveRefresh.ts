import { useEffect, useLayoutEffect, useRef } from 'react';
import { startLiveRefresh } from './liveRefresh';

export function useLiveRefresh(refresh: (signal: AbortSignal) => Promise<void>, {
  enabled = true, immediate = true, intervalMs = 30_000, refreshKey = '',
}: { enabled?: boolean; immediate?: boolean; intervalMs?: number; refreshKey?: string } = {}) {
  const latest = useRef(refresh);
  useLayoutEffect(() => { latest.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!enabled) return;
    const subscription = startLiveRefresh((signal) => latest.current(signal), {
      intervalMs, immediate,
      canRefresh: () => document.visibilityState === 'visible' && navigator.onLine,
    });
    const resume = () => subscription.resume();
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      subscription.stop();
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [enabled, immediate, intervalMs, refreshKey]);
}
