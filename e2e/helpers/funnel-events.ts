/**
 * Funnel-event collector for E2E.
 *
 * Hooks `navigator.sendBeacon` + `fetch` so calls to the traffic-ingest edge
 * function (used by `src/lib/trafficTracker.ts`) become observable from the
 * test, and exposes `window.__funnelEvents` for the spec to read.
 *
 * Usage:
 *   await installFunnelCollector(page);
 *   // ...drive the UI...
 *   const events = await readFunnelEvents(page);
 *   expect(events.map(e => e.event_name)).toContain('checkout_open');
 */
import type { Page } from '@playwright/test';

export interface FunnelEvent {
  event_name?: string;
  routes?: string[];
  route?: string;
  event_props?: Record<string, unknown> | null;
  kind?: string;
}

export async function installFunnelCollector(page: Page) {
  await page.addInitScript(() => {
    (window as any).__funnelEvents = [] as FunnelEvent[];
    const sink = (window as any).__funnelEvents as FunnelEvent[];

    // 2026-08-30 成本控制後，具名事件改成單一 POST 的 body.events[]，
    // 欄位是 { name, route, props }。collector 必須攤平回逐事件視角，
    // 否則所有漏斗 spec 只會看到一顆沒有 event_name 的信封。
    const ingest = (body: string | Blob | undefined) => {
      try {
        const text = typeof body === 'string' ? body : '';
        if (!text) return;
        const json = JSON.parse(text) as Record<string, any>;
        const batched = Array.isArray(json.events) ? json.events : null;
        if (batched) {
          for (const ev of batched) {
            sink.push({
              kind: json.kind,
              event_name: ev?.name ?? ev?.event_name,
              route: ev?.route ?? json.route,
              event_props: ev?.props ?? ev?.event_props ?? null,
            });
          }
          // page-view 與具名事件可能同批送出：信封若帶 routes 仍要保留。
          if (Array.isArray(json.routes) && json.routes.length) {
            sink.push({ kind: json.kind, routes: json.routes });
          }
          return;
        }
        sink.push(json);
      } catch { /* ignore non-json */ }
    };


    const origBeacon = navigator.sendBeacon?.bind(navigator);
    navigator.sendBeacon = ((url: string, data?: BodyInit | null) => {
      if (typeof url === 'string' && url.includes('/functions/v1/traffic-ingest')) {
        if (data && typeof (data as Blob).text === 'function') {
          (data as Blob).text().then(ingest).catch(() => {});
        } else {
          ingest(data as string | undefined);
        }
        return true;
      }
      return origBeacon ? origBeacon(url, data as any) : true;
    }) as typeof navigator.sendBeacon;

    const origFetch = window.fetch.bind(window);
    window.fetch = ((...args: Parameters<typeof fetch>) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
      if (url.includes('/functions/v1/traffic-ingest')) {
        const init = args[1] as RequestInit | undefined;
        ingest(init?.body as string | undefined);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      return origFetch(...args);
    }) as typeof fetch;
  });
}

export async function readFunnelEvents(page: Page): Promise<FunnelEvent[]> {
  // Force any queued setTimeout flush to run (`scheduleFlush` is 500ms).
  await page.waitForTimeout(900);
  return page.evaluate(() => (window as any).__funnelEvents as FunnelEvent[]);
}

export function eventNames(events: FunnelEvent[]): string[] {
  return events.flatMap((e) => (e.event_name ? [e.event_name] : []));
}

export function pageViewRoutes(events: FunnelEvent[]): string[] {
  return events.flatMap((e) => e.routes ?? []);
}

/**
 * 攤平 traffic-ingest 的 request body。
 *
 * 2026-08-30 成本控制後，具名事件改為單一 POST 的 `events: [{name, route, props}]`。
 * 任何直接攔 postData 的 spec 都必須經過這裡，否則只會看到沒有 event_name 的信封。
 */
export function flattenIngestBody(body: unknown): FunnelEvent[] {
  const b = body as Record<string, any> | null;
  if (!b || typeof b !== 'object') return [];
  const out: FunnelEvent[] = [];
  if (Array.isArray(b.events)) {
    for (const ev of b.events) {
      out.push({
        kind: b.kind,
        event_name: ev?.name ?? ev?.event_name,
        route: ev?.route ?? b.route,
        event_props: ev?.props ?? ev?.event_props ?? null,
      });
    }
  }
  if (Array.isArray(b.routes) && b.routes.length) out.push({ kind: b.kind, routes: b.routes });
  if (!Array.isArray(b.events) && !Array.isArray(b.routes)) out.push(b as FunnelEvent);
  return out;
}
