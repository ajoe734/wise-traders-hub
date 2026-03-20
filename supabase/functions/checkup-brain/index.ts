// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // GET — read
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const action = url.searchParams.get('action');

      if (action === 'brain') {
        const { data } = await supabase
          .from('checkup_storage')
          .select('data')
          .eq('key', 'strategy-brain')
          .maybeSingle();
        return new Response(JSON.stringify({ brain: data?.data || null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'history') {
        const { data } = await supabase
          .from('checkup_storage')
          .select('data')
          .eq('key', 'analysis-history')
          .maybeSingle();
        return new Response(JSON.stringify({ history: data?.data || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'all') {
        const { data: rows } = await supabase
          .from('checkup_storage')
          .select('key, data')
          .in('key', ['strategy-brain', 'analysis-history', 'events']);
        const map: Record<string, any> = {};
        (rows || []).forEach((r: any) => { map[r.key] = r.data; });
        return new Response(JSON.stringify({
          brain: map['strategy-brain'] || null,
          history: map['analysis-history'] || [],
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: '需要 action 參數 (brain/history/all)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST — write
    if (req.method === 'POST') {
      const { action, data } = await req.json();

      if (action === 'save-brain') {
        await supabase
          .from('checkup_storage')
          .upsert({ key: 'strategy-brain', data, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'save-analysis') {
        // Append to history array (keep last 30)
        const { data: existing } = await supabase
          .from('checkup_storage')
          .select('data')
          .eq('key', 'analysis-history')
          .maybeSingle();
        const history = Array.isArray(existing?.data) ? existing.data : [];
        const updated = [data, ...history].slice(0, 30);
        await supabase
          .from('checkup_storage')
          .upsert({ key: 'analysis-history', data: updated, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'save-events') {
        await supabase
          .from('checkup_storage')
          .upsert({ key: 'events', data, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'load-events') {
        const { data: row } = await supabase
          .from('checkup_storage')
          .select('data')
          .eq('key', 'events')
          .maybeSingle();
        return new Response(JSON.stringify({ events: row?.data || null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: '未知 action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Brain storage error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
