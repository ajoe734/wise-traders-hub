/**
 * Schedule a low-priority task during browser idle time.
 *
 * Falls back to `setTimeout` in environments without `requestIdleCallback`
 * (Safari, jsdom). The caller can rely on the callback running unless the
 * tab is closed.
 */
export function runWhenIdle(cb: () => void, timeoutMs = 2500) {
  if (typeof window === "undefined") {
    cb();
    return;
  }
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (typeof w.requestIdleCallback === "function") {
    w.requestIdleCallback(cb, { timeout: timeoutMs });
  } else {
    window.setTimeout(cb, Math.min(timeoutMs, 250));
  }
}
