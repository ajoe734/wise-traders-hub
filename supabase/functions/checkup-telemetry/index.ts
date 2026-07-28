// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireCaller, AuthError } from '../_shared/authGuard.ts';
import { codedErrorResponse } from '../_shared/errorCodes.ts';
import { validateInput, validationResponse } from "../_shared/inputValidator.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

const TELEMETRY_LIMIT = 200;
const SYSTEM_UID = '00000000-0000-0000-0000-000000000000';

function normalizeEntry(value: any) {
  if (!value || typeof value !== 'object') return null;
  return {
    id: String(value.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    kind: String(value.kind || 'unknown'),
    timestamp: String(value.timestamp || new Date().toISOString()),
    level: ['warn', 'error'].includes(String(value.level || '')) ? String(value.level) : 'error',
    error: typeof value.error === 'object' ? {
      name: String(value.error?.name || 'RuntimeDiagnostic'),
      message: String(value.error?.message || 'unknown'),
    } : { name: 'RuntimeDiagnostic', message: String(value.error || 'unknown') },
    context: typeof value.context === 'object' ? value.context : {},
  };
}

const handler = withLogging('checkup-telemetry', async (req, log) => {
  // AUTH: user (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { await requireCaller(req); }
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

  const supabase = serviceClient();

  try {
    if (req.method === 'GET') {
      const { data: row } = await supabase
        .from('checkup_storage').select('data').eq('user_id', SYSTEM_UID).eq('key', 'telemetry-events').maybeSingle();
      const entries = Array.isArray(row?.data) ? row.data.slice(0, 50) : [];
      return jsonResponse({ entries });
    }

    if (req.method === 'POST') {
      let body: any = {};
      try { body = await req.json(); } catch { body = {}; }

      const issues = validateInput({
        fields: {
          action: { required: true, type: 'string', oneOf: ['capture-diagnostics'], label: 'action' },
          data: { required: true, type: 'object', label: 'data' },
        },
        source: body,
      });
      if (issues.length) return validationResponse(issues, corsHeaders);

      const { data } = body;

      const incoming = (data?.entries || []).map(normalizeEntry).filter(Boolean);
      const { data: existing } = await supabase
        .from('checkup_storage').select('data').eq('user_id', SYSTEM_UID).eq('key', 'telemetry-events').maybeSingle();
      const current = Array.isArray(existing?.data) ? existing.data : [];
      const merged = [...incoming, ...current].slice(0, TELEMETRY_LIMIT);

      await supabase.from('checkup_storage').upsert(
        { user_id: SYSTEM_UID, key: 'telemetry-events', data: merged, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,key' }
      );

      return jsonResponse({ ok: true, accepted: incoming.length, stored: merged.length });
    }

    return codedErrorResponse('METHOD_NOT_ALLOWED', '不支援的 HTTP 方法');
  } catch (err) {
    log.error('handler_error', { msg: (err as Error).message });
    return jsonResponse({ error: (err as Error).message }, { status: 500 });
  }
});

Deno.serve(handler);
