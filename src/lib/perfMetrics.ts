/**
 * Front-end RUM collector — FCP / LCP / CLS / INP per route.
 *
 * - FCP / LCP: per-route via PerformanceObserver (relative to route start).
 * - CLS: accumulated per route from `layout-shift` entries (excludes had-recent-input).
 * - INP: per route from `event` entries, taking the max interaction duration
 *        (max ≈ INP for typical session length; full p98 not justified for our volume).
 *
 * Flushes a single insert into `public.perf_metrics` on route change /
 * visibility hidden / pagehide. Fire-and-forget; never throws.
 */
import { supabase } from '@/integrations/supabase/client';

const SESSION_KEY = 'perf_sid';

function getSessionId(): string {
  try {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return `${Date.now()}`;
  }
}

function normalizeRoute(pathname: string): string {
  return pathname
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d{4,}/g, '/:id')
    .slice(0, 200);
}

function uaKind(): string {
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  return w > 0 && w < 768 ? 'mobile' : 'desktop';
}

interface PageMetrics {
  route: string;
  startedAt: number;
  fcp: number | null;
  lcp: number | null;
  cls: number;
  inp: number;
  observers: PerformanceObserver[];
  flushed: boolean;
}

let current: PageMetrics | null = null;
let inited = false;

async function flush(metrics: PageMetrics) {
  if (metrics.flushed) return;
  metrics.flushed = true;
  for (const obs of metrics.observers) {
    try { obs.disconnect(); } catch { /* noop */ }
  }
  const hasAny =
    metrics.fcp != null || metrics.lcp != null || metrics.cls > 0 || metrics.inp > 0;
  if (!hasAny) return;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('perf_metrics').insert({
      route: metrics.route,
      fcp_ms: metrics.fcp != null ? Math.round(metrics.fcp) : null,
      lcp_ms: metrics.lcp != null ? Math.round(metrics.lcp) : null,
      inp_ms: metrics.inp > 0 ? Math.round(metrics.inp) : null,
      cls_score: metrics.cls > 0 ? Number(metrics.cls.toFixed(4)) : null,
      user_id: user?.id ?? null,
      session_id: getSessionId(),
      viewport_w: typeof window !== 'undefined' ? window.innerWidth : null,
      ua_kind: uaKind(),
    });
  } catch {
    // swallow — telemetry must not break UX
  }
}

function safeObserve(type: string, cb: (list: PerformanceObserverEntryList) => void): PerformanceObserver | null {
  try {
    const obs = new PerformanceObserver(cb);
    // `buffered` lets us pick up entries that fired before observe()
    obs.observe({ type, buffered: true } as PerformanceObserverInit);
    return obs;
  } catch {
    return null;
  }
}

function startTracking(route: string) {
  if (current && !current.flushed) flush(current);

  const page: PageMetrics = {
    route,
    startedAt: performance.now(),
    fcp: null,
    lcp: null,
    cls: 0,
    inp: 0,
    observers: [],
    flushed: false,
  };
  current = page;

  if (typeof PerformanceObserver === 'undefined') return;

  // First page: paint entries may already exist.
  try {
    for (const e of performance.getEntriesByType('paint')) {
      if (e.name === 'first-contentful-paint' && page.fcp == null) page.fcp = e.startTime;
    }
  } catch { /* noop */ }

  const paintObs = safeObserve('paint', (list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === 'first-contentful-paint' && page.fcp == null) {
        page.fcp = entry.startTime - page.startedAt;
      }
    }
  });
  if (paintObs) page.observers.push(paintObs);

  const lcpObs = safeObserve('largest-contentful-paint', (list) => {
    for (const entry of list.getEntries()) {
      page.lcp = (entry as PerformanceEntry).startTime - page.startedAt;
    }
  });
  if (lcpObs) page.observers.push(lcpObs);

  const clsObs = safeObserve('layout-shift', (list) => {
    for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
      if (!entry.hadRecentInput) page.cls += entry.value;
    }
  });
  if (clsObs) page.observers.push(clsObs);

  const evObs = safeObserve('event', (list) => {
    for (const entry of list.getEntries() as Array<PerformanceEntry & { interactionId?: number; duration: number }>) {
      if (!entry.interactionId) continue;
      if (entry.duration > page.inp) page.inp = entry.duration;
    }
  });
  if (evObs) page.observers.push(evObs);
}

export function initPerfMetrics() {
  if (inited || typeof window === 'undefined') return;
  inited = true;

  const isInternal = () => {
    const p = window.location.pathname;
    return p.startsWith('/company') || p.startsWith('/admin');
  };

  if (!isInternal()) {
    startTracking(normalizeRoute(window.location.pathname));
  }

  const onHide = () => {
    if (current && !current.flushed) flush(current);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide();
  });
  window.addEventListener('pagehide', onHide);
}

export function trackRouteChange(pathname: string) {
  if (typeof window === 'undefined') return;
  if (pathname.startsWith('/company') || pathname.startsWith('/admin')) {
    if (current && !current.flushed) flush(current);
    current = null;
    return;
  }
  startTracking(normalizeRoute(pathname));
}
