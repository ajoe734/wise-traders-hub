// Ingest anonymous + authenticated traffic events.
//
// Two payload kinds:
//   - kind=visit  → upsert traffic_visits (first-touch attribution + last_seen bump)
//   - kind=event  → insert a single row into traffic_events (page view)
//
// Designed for navigator.sendBeacon — never returns 4xx for valid shapes; logs
// and returns 200 even on partial errors so the client never retries indefinitely.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { jsonResponse, corsPreflight } from '../_shared/cors.ts';
import { serviceClient, getCallerUserId } from '../_shared/supabaseClients.ts';

import { withLogging } from '../_shared/edgeLogger.ts';
function safeHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeRoute(path: string): string {
  return (path || '/')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d{4,}/g, '/:id')
    .slice(0, 200);
}

function isInternalRoute(path: string): boolean {
  return path.startsWith('/company') || path.startsWith('/admin');
}

Deno.serve(withLogging('traffic-ingest', async (req) => {
  // traffic-ingest is called via navigator.sendBeacon which forces credentials
  // → we must echo the request origin instead of using wildcard `*`.
  const CORS_OPTS = { credentials: true } as const;
  if (req.method === 'OPTIONS') return corsPreflight(req, CORS_OPTS);
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false }, { status: 405 }, req, CORS_OPTS);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }

  const supabase = serviceClient();
  const userId = await getCallerUserId(req);

  // Validate envelope: kind + visitor_id required, the rest validated per-branch
  const { validateInput, validationJsonResponse } = await import('../_shared/inputValidator.ts');
  const issues = validateInput({
    fields: {
      kind: { required: true, type: 'string', label: 'kind', oneOf: ['visit', 'event'] },
      visitor_id: { required: true, type: 'string', label: 'visitor_id', minLength: 1 },
    },
    source: body,
  });
  if (issues.length) return validationJsonResponse(issues);
  const kind = String(body.kind || '');
  const visitor_id = (body.visitor_id as string).slice(0, 128);

  try {
    if (kind === 'visit') {
      const landing_path = normalizeRoute(String(body.landing_path || '/'));
      const referrer = typeof body.referrer === 'string' ? body.referrer.slice(0, 1000) : null;
      const referrer_host = safeHost(referrer);
      const utm_source = (body.utm_source as string | null) || null;
      const utm_medium = (body.utm_medium as string | null) || null;
      const utm_campaign = (body.utm_campaign as string | null) || null;
      const utm_content = (body.utm_content as string | null) || null;
      const utm_term = (body.utm_term as string | null) || null;
      const ref_code = (body.ref_code as string | null) || null;
      const device_kind = (body.device_kind as string | null) || null;

      const { data: channelRow } = await supabase.rpc('derive_traffic_channel', {
        _utm_medium: utm_medium,
        _utm_source: utm_source,
        _referrer_host: referrer_host,
      });
      const channel = (typeof channelRow === 'string' && channelRow) || 'direct';

      // Check if visitor exists (no UPSERT — we want to preserve first-touch fields).
      const { data: existing } = await supabase
        .from('traffic_visits')
        .select('id, page_views, user_id')
        .eq('visitor_id', visitor_id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('traffic_visits')
          .update({
            last_seen_at: new Date().toISOString(),
            page_views: (existing.page_views || 0) + 1,
            user_id: existing.user_id || userId || null,
          })
          .eq('id', existing.id);
      } else {
        await supabase.from('traffic_visits').insert({
          visitor_id,
          user_id: userId || null,
          first_landing_path: landing_path,
          first_referrer: referrer,
          first_referrer_host: referrer_host,
          utm_source, utm_medium, utm_campaign, utm_content, utm_term, ref_code,
          channel,
          device_kind,
        });
      }

      return jsonResponse({ ok: true, channel }, {}, req, CORS_OPTS);
    }

    if (kind === 'event') {
      const route = normalizeRoute(String(body.route || '/'));
      const referrer = typeof body.referrer === 'string' ? body.referrer.slice(0, 1000) : null;
      const event_name = typeof body.event_name === 'string' ? body.event_name.slice(0, 80) : null;
      const event_props = body.event_props && typeof body.event_props === 'object' ? body.event_props : null;

      // Two paths:
      //  - batch page views: body.routes = string[]  → many rows, no event_name
      //  - single named event: body.event_name set   → one row with name+props
      let rows: Array<Record<string, unknown>>;
      if (event_name) {
        rows = [{
          visitor_id,
          user_id: userId || null,
          route,
          referrer_host: safeHost(referrer),
          event_name,
          event_props,
          is_internal: isInternalRoute(route),
        }];
      } else {
        const routes = Array.isArray(body.routes) ? (body.routes as string[]).slice(0, 50) : [route];
        rows = routes.map((r) => {
          const nr = normalizeRoute(String(r || '/'));
          return {
            visitor_id,
            user_id: userId || null,
            route: nr,
            referrer_host: safeHost(referrer),
            is_internal: isInternalRoute(nr),
          };
        });
      }
      await supabase.from('traffic_events').insert(rows);

      // Also bump traffic_visits.last_seen_at + user_id backfill (best-effort, async)
      supabase.from('traffic_visits').update({
        last_seen_at: new Date().toISOString(),
        user_id: userId || undefined,
      }).eq('visitor_id', visitor_id).then(() => {});

      return jsonResponse({ ok: true, count: rows.length }, {}, req, CORS_OPTS);
    }


    return jsonResponse({ ok: false, error: 'unknown_kind' }, {}, req, CORS_OPTS);
  } catch (e) {
    console.error('[traffic-ingest] error', (e as Error).message);
    return jsonResponse({ ok: false }, { status: 200 }, req, CORS_OPTS);
  }
}));
