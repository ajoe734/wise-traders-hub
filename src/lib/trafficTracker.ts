/**
 * Anonymous + authenticated traffic & feature-event tracker.
 *
 * Captures:
 *  - first-touch attribution (utm, referrer, landing) per visitor
 *  - per-route page-view events (batched, flushed on visibility/pagehide)
 *  - named feature events with optional jsonb props (funnel / heatmap)
 *
 * Sends to the `traffic-ingest` edge function via fetch + sendBeacon.
 *
 * Internal-mode opt-in: set `localStorage.lf_track_internal = '1'` to also
 * log /company and /admin routes — used by Traffic admins to debug tracking.
 *
 * Visit-row throttle is 30 minutes (was 24h) so live-debugging is responsive.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const VISITOR_KEY = 'lf_visitor_id';
const VISIT_LOGGED_KEY = 'lf_visit_logged_at';
const INTERNAL_KEY = 'lf_track_internal';
const VISIT_TTL_MS = 30 * 60 * 1000; // 30 minutes

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

function internalModeOn(): boolean {
  try { return localStorage.getItem(INTERNAL_KEY) === '1'; } catch { return false; }
}

export function setInternalTracking(on: boolean) {
  try {
    if (on) localStorage.setItem(INTERNAL_KEY, '1');
    else localStorage.removeItem(INTERNAL_KEY);
  } catch { /* noop */ }
}

export function isInternalTrackingOn(): boolean { return internalModeOn(); }

const INGEST_URL = `${SUPABASE_URL}/functions/v1/traffic-ingest`;

async function post(payload: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify(payload);
  // NOTE: traffic-ingest is one of the few endpoints that receives credentials
  // (sendBeacon always includes cookies; fetch fallback opts in explicitly).
  // The edge function echoes Origin + sets Allow-Credentials to match.
  try {
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
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
      credentials: 'include',
    });
  } catch { /* swallow */ }
}

let inited = false;
type QueuedItem = { kind: 'pv'; route: string } | { kind: 'ev'; name: string; props?: Record<string, unknown>; route: string };
let queue: QueuedItem[] = [];
let flushTimer: number | null = null;
let flushDueAt = Infinity;
const visitor_id = (() => {
  try { return getOrCreateVisitorId(); } catch { return ''; }
})();

function shouldSkip(_path: string): boolean {
  // Always log — backend tags internal routes with is_internal=true
  // and dashboards filter them out by default.
  return false;
}

/**
 * 成本控制（2026-08-30 事故）：具名事件原本是「一個事件一個 POST」，
 * 持倉看板一次開 30 檔會瞬間打出數十個 edge boot。改為：
 *   1. 同一批次內完全相同的 (name|route|props) 只送一筆
 *   2. 所有具名事件合併成單一 POST（body.events[]）
 */
function dedupeKey(ev: { name: string; route: string; props?: Record<string, unknown> }): string {
  let p = '';
  try { p = JSON.stringify(ev.props ?? null); } catch { p = '?'; }
  return `${ev.name}|${ev.route}|${p}`;
}

function flushEvents() {
  if (!queue.length) return;
  const batch = queue.slice(0, 50);
  queue = queue.slice(batch.length);
  const pvRoutes = batch.filter((b): b is { kind: 'pv'; route: string } => b.kind === 'pv').map(b => b.route);
  const named = batch.filter((b): b is { kind: 'ev'; name: string; props?: Record<string, unknown>; route: string } => b.kind === 'ev');
  if (pvRoutes.length) {
    post({ kind: 'event', visitor_id, routes: pvRoutes, referrer: document.referrer || null });
  }
  if (named.length) {
    const seen = new Set<string>();
    const events: Array<{ name: string; route: string; props: Record<string, unknown> | null }> = [];
    for (const ev of named) {
      const k = dedupeKey(ev);
      if (seen.has(k)) continue;
      seen.add(k);
      events.push({ name: ev.name, route: ev.route, props: ev.props ?? null });
    }
    post({ kind: 'event', visitor_id, events, referrer: document.referrer || null });
  }
}

function scheduleFlush(delay = 2000) {
  const dueAt = Date.now() + delay;
  if (flushTimer != null) {
    // 已排程但更晚才會送 → 縮短到較急的那一個（具名事件 500ms 不該被
    // page-view 的 2000ms 批次卡住）。
    if (dueAt >= flushDueAt) return;
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushDueAt = dueAt;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushDueAt = Infinity;
    flushEvents();
  }, delay);
}

export function trackPageView(pathname: string) {
  if (!inited || !visitor_id) return;
  if (shouldSkip(pathname)) return;
  queue.push({ kind: 'pv', route: pathname });
  scheduleFlush();
}

/**
 * Track a named feature event. Safe to call from anywhere — no-ops until init.
 * Flushes within 500ms (faster than page-view batch) so clicks register quickly.
 */
export function trackEvent(name: string, props?: Record<string, unknown>) {
  if (!inited || !visitor_id) return;
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  if (shouldSkip(path)) return;
  queue.push({ kind: 'ev', name, props, route: path });
  scheduleFlush(500);
}

function logFirstVisit() {
  if (!visitor_id) return;
  const path = window.location.pathname;
  if (shouldSkip(path)) return;
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
  if (!shouldSkip(path)) {
    logFirstVisit();
    queue.push({ kind: 'pv', route: path });
    scheduleFlush();
  }

  const flushNow = () => {
    if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; flushDueAt = Infinity; }
    flushEvents();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });
  window.addEventListener('pagehide', flushNow);
}
