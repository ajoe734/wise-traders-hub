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

    const ingest = (body: string | Blob | undefined) => {
      try {
        const text = typeof body === 'string' ? body : '';
        if (!text) return;
        const json = JSON.parse(text);
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
  await page.waitForTimeout(2600);
  return page.evaluate(() => (window as any).__funnelEvents as FunnelEvent[]);
}

export function eventNames(events: FunnelEvent[]): string[] {
  return events.flatMap((e) => (e.event_name ? [e.event_name] : []));
}

export function pageViewRoutes(events: FunnelEvent[]): string[] {
  return events.flatMap((e) => e.routes ?? []);
}
