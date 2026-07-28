// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { serviceClient } from '../_shared/supabaseClients.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { jsonResponse } from '../_shared/cors.ts';

Deno.serve(withLogging('cleanup-announcements-cron', async (_req) => {
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

  // OPTIONS preflight handled by withLogging via _shared/cors corsPreflight().
  try {
    const supabase = serviceClient();
    const { error } = await supabase.rpc('cleanup_old_announcements');

    if (error) {
      console.error('cleanup_old_announcements error:', error);
      return jsonResponse({ error: error.message }, { status: 500 });
    }

    const now = new Date().toISOString();
    console.log(`[${now}] cleanup_old_announcements executed successfully`);
    return jsonResponse({ success: true, executed_at: now });
  } catch (err) {
    console.error('Unexpected error:', err);
    return jsonResponse({ error: String(err) }, { status: 500 });
  }
}));
