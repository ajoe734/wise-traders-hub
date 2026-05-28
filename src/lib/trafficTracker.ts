/**
 * Anonymous + authenticated traffic tracker.
 *
 * Captures:
 *  - first-touch attribution (utm, referrer, landing) once per visitor
 *  - per-route page-view events (batched, flushed on visibility/pagehide)
 *
 * Sends to the `traffic-ingest` edge function via fetch + sendBeacon.
 *
 * Coexists with `useAttributionTracking` (legacy `referral_attributions`) —
 * both share the same `lf_visitor_id` localStorage key so analytics line up.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const VISITOR_KEY = 'lf_visitor_id';
const VISIT_LOGGED_KEY = 'lf_visit_logged_at';
const VISIT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function getOrCreateVisitorId(): string {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v) {
      v = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) + '_' + Date.now();
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function deviceKind(): string {
  return typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 768
    ? 'mobile' : 'desktop';
}

function isInternalRoute(path: string): boolean {
  return path.startsWith('/company') || path.startsWith('/admin');
}

const INGEST_URL = `${SUPABASE_URL}/functions/v1/traffic-ingest`;

async function post(payload: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify(payload);
  try {
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      // Beacon doesn't send custom auth header, that's fine — endpoint is verify_jwt=false.
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(INGEST_URL, blob);
      return;
    }
  } catch { /* fall through */ }
  try {
    await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
      body,
      keepalive: true,
    });
  } catch { /* swallow */ }
}

let inited = false;
let queue: string[] = [];
let flushTimer: number | null = null;
const visitor_id = (() => {
  try { return getOrCreateVisitorId(); } catch { return ''; }
})();

function flushEvents() {
  if (!queue.length) return;
  const routes = queue.slice(0, 50);
  queue = queue.slice(routes.length);
  post({ kind: 'event', visitor_id, routes, referrer: document.referrer || null });
}

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushEvents();
  }, 2000);
}

export function trackPageView(pathname: string) {
  if (!inited || !visitor_id) return;
  if (isInternalRoute(pathname)) return;
  queue.push(pathname);
  scheduleFlush();
}

function logFirstVisit() {
  if (!visitor_id) return;
  try {
    const last = Number(localStorage.getItem(VISIT_LOGGED_KEY) || 0);
    if (Date.now() - last < VISIT_TTL_MS) return;
    localStorage.setItem(VISIT_LOGGED_KEY, String(Date.now()));
  } catch { /* ignore */ }

  const url = new URL(window.location.href);
  const sp = url.searchParams;
  post({
    kind: 'visit',
    visitor_id,
    landing_path: url.pathname,
    referrer: document.referrer || null,
    utm_source: sp.get('utm_source'),
    utm_medium: sp.get('utm_medium'),
    utm_campaign: sp.get('utm_campaign'),
    utm_content: sp.get('utm_content'),
    utm_term: sp.get('utm_term'),
    ref_code: sp.get('ref') || sp.get('ref_code'),
    device_kind: deviceKind(),
  });
}

export function initTrafficTracker() {
  if (inited || typeof window === 'undefined') return;
  inited = true;

  const path = window.location.pathname;
  if (!isInternalRoute(path)) {
    logFirstVisit();
    // First page view
    queue.push(path);
    scheduleFlush();
  }

  const flushNow = () => {
    if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; }
    flushEvents();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });
  window.addEventListener('pagehide', flushNow);
}
