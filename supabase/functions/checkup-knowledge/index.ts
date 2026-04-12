// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Knowledge stored in checkup_storage with key prefix 'knowledge-'
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const action = url.searchParams.get('action');
      const q = url.searchParams.get('q') || '';
      const category = url.searchParams.get('category');
      const stockId = url.searchParams.get('stockId');

      const SYSTEM_UID = '00000000-0000-0000-0000-000000000000';
      if (action === 'search' && q) {
        const { data: rows } = await supabase
          .from('checkup_storage')
          .select('key, data')
          .eq('user_id', SYSTEM_UID)
          .like('key', 'knowledge-%');

        const results: any[] = [];
        const queryLower = q.toLowerCase();
        for (const row of (rows || [])) {
          const d = row.data as any;
          if (!d?.items) continue;
          if (category && d.category !== category) continue;
          for (const item of d.items) {
            const haystack = `${item.title || ''} ${item.fact || ''} ${item.interpretation || ''} ${item.action || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
            if (haystack.includes(queryLower)) {
              results.push({ ...item, category: d.category, categoryName: d.name });
            }
          }
        }
        return new Response(JSON.stringify({ success: true, results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'similar' && stockId) {
        const { data: row } = await supabase
          .from('checkup_storage')
          .select('data')
          .eq('user_id', SYSTEM_UID)
          .eq('key', 'knowledge-strategy-cases')
          .maybeSingle();
        const items = (row?.data as any)?.items || [];
        const stockLower = stockId.toLowerCase();
        const byTag = items.filter((i: any) => i.tags?.some((t: string) => t.toLowerCase().includes(stockLower)));
        const fallback = items.filter((i: any) => i.outcome === 'success').slice(0, 5);
        return new Response(JSON.stringify({ success: true, cases: (byTag.length > 0 ? byTag : fallback).slice(0, 5) }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'stats') {
        const { data: rows } = await supabase
          .from('checkup_storage')
          .select('key, data')
          .eq('user_id', SYSTEM_UID)
          .like('key', 'knowledge-%');
        const stats = (rows || []).map(r => {
          const d = r.data as any;
          return { category: d?.category, name: d?.name, itemCount: d?.items?.length || 0 };
        });
        return new Response(JSON.stringify({ success: true, stats }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, index: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST') {
      const { action, category, item } = await req.json();
      if (action === 'add' && category && item) {
        const key = `knowledge-${category}`;
        const { data: existing } = await supabase
          .from('checkup_storage').select('data').eq('user_id', SYSTEM_UID).eq('key', key).maybeSingle();
        const d = (existing?.data as any) || { category, name: category, items: [] };
        d.items = [...(d.items || []), { ...item, id: `${Date.now()}`, createdAt: new Date().toISOString().split('T')[0] }];
        await supabase.from('checkup_storage').upsert(
          { user_id: SYSTEM_UID, key, data: d, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,key' }
        );
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Knowledge error:', err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
