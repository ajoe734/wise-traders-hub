// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const TELEMETRY_LIMIT = 200;

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    if (req.method === 'GET') {
      const SYSTEM_UID = '00000000-0000-0000-0000-000000000000';
      const { data: row } = await supabase
        .from('checkup_storage').select('data').eq('user_id', SYSTEM_UID).eq('key', 'telemetry-events').maybeSingle();
      const entries = Array.isArray(row?.data) ? row.data.slice(0, 50) : [];
      return new Response(JSON.stringify({ entries }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST') {
      const SYSTEM_UID = '00000000-0000-0000-0000-000000000000';
      const { action, data } = await req.json();
      if (action !== 'capture-diagnostics') {
        return new Response(JSON.stringify({ error: '未知 action' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const incoming = (data?.entries || []).map(normalizeEntry).filter(Boolean);
      const { data: existing } = await supabase
        .from('checkup_storage').select('data').eq('user_id', SYSTEM_UID).eq('key', 'telemetry-events').maybeSingle();
      const current = Array.isArray(existing?.data) ? existing.data : [];
      const merged = [...incoming, ...current].slice(0, TELEMETRY_LIMIT);

      await supabase.from('checkup_storage').upsert(
        { user_id: SYSTEM_UID, key: 'telemetry-events', data: merged, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,key' }
      );

      return new Response(JSON.stringify({ ok: true, accepted: incoming.length, stored: merged.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
