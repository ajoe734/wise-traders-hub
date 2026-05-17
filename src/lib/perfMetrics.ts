/**
 * Front-end RUM collector — FCP & LCP per route.
 * Fire-and-forget insert into public.perf_metrics.
 * Designed to be cheap: one PerformanceObserver per page, one insert on flush.
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
  observer: PerformanceObserver | null;
  flushed: boolean;
}

let current: PageMetrics | null = null;
let inited = false;

async function flush(metrics: PageMetrics) {
  if (metrics.flushed) return;
  metrics.flushed = true;
  try {
    metrics.observer?.disconnect();
  } catch {}
  if (metrics.fcp == null && metrics.lcp == null) return;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('perf_metrics').insert({
      route: metrics.route,
      fcp_ms: metrics.fcp != null ? Math.round(metrics.fcp) : null,
      lcp_ms: metrics.lcp != null ? Math.round(metrics.lcp) : null,
      user_id: user?.id ?? null,
      session_id: getSessionId(),
      viewport_w: typeof window !== 'undefined' ? window.innerWidth : null,
      ua_kind: uaKind(),
    });
  } catch {
    // swallow — telemetry must not break UX
  }
}

function startTracking(route: string) {
  // Flush previous page (route change before flush event)
  if (current && !current.flushed) {
    flush(current);
  }

  const page: PageMetrics = {
    route,
    startedAt: performance.now(),
    fcp: null,
    lcp: null,
    observer: null,
    flushed: false,
  };
  current = page;

  if (typeof PerformanceObserver === 'undefined') return;

  // For the very first page load, paint entries may already exist.
  try {
    const paints = performance.getEntriesByType('paint');
    for (const e of paints) {
      if (e.name === 'first-contentful-paint' && page.fcp == null) {
        page.fcp = e.startTime;
      }
    }
  } catch {}

  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'paint' && entry.name === 'first-contentful-paint') {
          if (page.fcp == null) page.fcp = entry.startTime - page.startedAt;
        } else if (entry.entryType === 'largest-contentful-paint') {
          page.lcp = (entry as any).startTime - page.startedAt;
        }
      }
    });
    obs.observe({ type: 'paint', buffered: true });
    obs.observe({ type: 'largest-contentful-paint', buffered: true });
    page.observer = obs;
  } catch {}
}

export function initPerfMetrics() {
  if (inited || typeof window === 'undefined') return;
  inited = true;

  // Skip company admin pages — we measure user-facing perf, not internal tools.
  const isInternal = () => {
    const p = window.location.pathname;
    return p.startsWith('/company') || p.startsWith('/admin');
  };

  if (!isInternal()) {
    startTracking(normalizeRoute(window.location.pathname));
  }

  // Flush on hidden / unload
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
