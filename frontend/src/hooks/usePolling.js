import { useEffect, useRef } from 'react';

/**
 * Lightweight polling hook. Calls `fn` immediately, then on `interval`.
 * Pauses when the tab is hidden.
 */
export function usePolling(fn, interval = 5000, deps = []) {
  const timer = useRef(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled || document.hidden) return;
      try { await fnRef.current(); } catch { /* swallow */ }
    };

    tick();
    timer.current = setInterval(tick, interval);

    const onVisibility = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
