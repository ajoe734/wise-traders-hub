// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// Daily cron: prune old traffic_events (>90d) and anonymous traffic_visits (>365d).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { jsonResponse, corsPreflight } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';

import { withLogging } from '../_shared/edgeLogger.ts';
Deno.serve(withLogging('traffic-cleanup', async (req) => {
  // AUTH: cron (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { requireCronKey(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }

  if (req.method === 'OPTIONS') return corsPreflight();
  const supabase = serviceClient();
  try {
    const { error } = await supabase.rpc('cleanup_old_traffic');
    if (error) throw error;
    return jsonResponse({ ok: true, ran_at: new Date().toISOString() });
  } catch (e) {
    return jsonResponse({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}));
