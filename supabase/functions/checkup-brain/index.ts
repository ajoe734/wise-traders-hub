// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { validateInput, validationResponse } from "../_shared/inputValidator.ts";

import { corsHeaders } from '../_shared/checkupCors.ts';

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

      return validationResponse(
        [{ key: 'action', label: 'action', reason: '值需為 brain / history / all' }],
        corsHeaders,
      );
    }

    // POST — write
    if (req.method === 'POST') {
      let body: any = {};
      try { body = await req.json(); } catch { body = {}; }
      const { action, data } = body;

      const POST_ACTIONS = ['save-brain','save-analysis','save-events','load-events','delete-analysis','save-holdings','get-holdings','get-brain','get-analysis-history','get-research-history','save-research-history'];
      if (!action || !POST_ACTIONS.includes(action)) {
        return validationResponse(
          [{ key: 'action', label: 'action', reason: `值需為 ${POST_ACTIONS.join(' / ')}` }],
          corsHeaders,
        );
      }
      const NEEDS_DATA = ['save-brain','save-analysis','save-events','delete-analysis','save-holdings','save-research-history'];
      if (NEEDS_DATA.includes(action) && (data === undefined || data === null)) {
        return validationResponse(
          [{ key: 'data', label: 'data', reason: `action=${action} 需要 data 欄位` }],
          corsHeaders,
        );
      }

      if (action === 'save-brain') {
        await supabase
          .from('checkup_storage')
          .upsert({ key: 'strategy-brain', data, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'save-analysis') {
        // data 為陣列時視為覆蓋（可用 [] 清空），否則為 append（保留舊行為）
        let updated: any[] = [];

        if (Array.isArray(data)) {
          updated = data.slice(0, 30);
        } else if (data == null) {
          updated = [];
        } else {
          const { data: existing } = await supabase
            .from('checkup_storage')
            .select('data')
            .eq('key', 'analysis-history')
            .maybeSingle();
          const history = Array.isArray(existing?.data) ? existing.data : [];
          updated = [data, ...history].slice(0, 30);
        }

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

      if (action === 'delete-analysis') {
        if (!data?.id) {
          return new Response(JSON.stringify({ error: '缺少 id' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const { data: existing } = await supabase
          .from('checkup_storage').select('data').eq('key', 'analysis-history').maybeSingle();
        const history = Array.isArray(existing?.data) ? existing.data : [];
        const filtered = history.filter((item: any) => item.id !== data.id);
        await supabase.from('checkup_storage').upsert(
          { key: 'analysis-history', data: filtered, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'save-holdings') {
        await supabase.from('checkup_storage').upsert(
          { key: 'cloud-holdings', data, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'get-holdings') {
        const { data: row } = await supabase
          .from('checkup_storage').select('data').eq('key', 'cloud-holdings').maybeSingle();
        return new Response(JSON.stringify({ content: row?.data || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'get-brain') {
        const { data: row } = await supabase
          .from('checkup_storage').select('data').eq('key', 'strategy-brain').maybeSingle();
        return new Response(JSON.stringify({ content: row?.data || null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'get-analysis-history') {
        const { data: row } = await supabase
          .from('checkup_storage').select('data').eq('key', 'analysis-history').maybeSingle();
        return new Response(JSON.stringify({ content: row?.data || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'get-research-history') {
        const { data: row } = await supabase
          .from('checkup_storage').select('data').eq('key', 'research-history').maybeSingle();
        return new Response(JSON.stringify({ content: row?.data || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'save-research-history') {
        await supabase.from('checkup_storage').upsert(
          { key: 'research-history', data, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
        return new Response(JSON.stringify({ ok: true }), {
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
