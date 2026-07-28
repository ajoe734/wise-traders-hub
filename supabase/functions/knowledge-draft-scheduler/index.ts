// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
// 自動排程器：把每個 category 的候選池 + 主表補到目標 100 條
// - 由 pg_cron 每 2 分鐘呼叫一次
// - 內部呼叫 knowledge-draft-claude（帶 x-cron-secret 旁路）
// - 每次處理「最缺的那一類」一個 batch（20 條），跑完就 return
// - 達標後回 { done: true }，可手動 unschedule cron
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
const CATS = ['chip_analysis', 'technical_analysis', 'industry_trends', 'strategy_cases', 'news_correlation'] as const;
const TARGET_PER_CAT = 100;
const BATCH_SIZE = 20;
const PREFIX: Record<string, string> = {
  chip_analysis: 'ca',
  technical_analysis: 'ta',
  industry_trends: 'it',
  strategy_cases: 'sc',
  news_correlation: 'nc',
};

Deno.serve(withLogging('knowledge-draft-scheduler', async (req) => {
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

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const cronSecret = Deno.env.get('DATA_UPSERT_API_KEY') ?? '';

    // 驗呼叫者：允許 service_role JWT 或 x-cron-secret
    const auth = req.headers.get('Authorization') ?? '';
    const provided = req.headers.get('x-cron-secret') ?? '';
    const isService = auth === `Bearer ${serviceRoleKey}`;
    const isCron = cronSecret && provided === cronSecret;
    if (!isService && !isCron) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = serviceClient();

    // 統計：每類 candidates(pending) + items(active) 總和
    const counts: Record<string, number> = {};
    for (const cat of CATS) {
      const { count: candCount } = await admin
        .from('checkup_knowledge_candidates')
        .select('id', { count: 'exact', head: true })
        .eq('category', cat)
        .eq('status', 'pending');
      const { count: itemCount } = await admin
        .from('checkup_knowledge_items')
        .select('id', { count: 'exact', head: true })
        .eq('category', cat)
        .eq('is_active', true);
      counts[cat] = (candCount ?? 0) + (itemCount ?? 0);
    }

    // 找最缺的那一類
    let target: string | null = null;
    let minVal = Infinity;
    for (const cat of CATS) {
      if (counts[cat] < TARGET_PER_CAT && counts[cat] < minVal) {
        minVal = counts[cat];
        target = cat;
      }
    }

    if (!target) {
      return new Response(JSON.stringify({ done: true, counts, message: 'All categories at target' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const need = TARGET_PER_CAT - counts[target];
    const batchCount = Math.min(BATCH_SIZE, need);

    // 算 seq_start：找該類目前 candidates + items 中最大的 PREFIX-NN 編號
    const prefix = PREFIX[target];
    const { data: candIds } = await admin
      .from('checkup_knowledge_candidates')
      .select('item_id')
      .eq('category', target)
      .like('item_id', `${prefix}-%`);
    const { data: itemIds } = await admin
      .from('checkup_knowledge_items')
      .select('item_id')
      .eq('category', target)
      .like('item_id', `${prefix}-%`);

    let maxSeq = 0;
    for (const r of [...(candIds ?? []), ...(itemIds ?? [])]) {
      const m = String(r.item_id ?? '').match(new RegExp(`^${prefix}-(\\d+)`));
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxSeq) maxSeq = n;
      }
    }
    const seqStart = maxSeq + 1;

    // 呼叫 knowledge-draft-claude（用 service_role 旁路）
    const draftUrl = `${supabaseUrl}/functions/v1/knowledge-draft-claude`;
    const draftResp = await fetch(draftUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
      },
      body: JSON.stringify({
        category: target,
        count: batchCount,
        focus: `本批編號從 ${prefix}-${String(seqStart).padStart(2, '0')} 起遞增，請避免與既有條目重複`,
      }),
    });

    const draftText = await draftResp.text();
    let draftJson: any = null;
    try { draftJson = JSON.parse(draftText); } catch { /* leave null */ }

    if (!draftResp.ok) {
      console.error(`[scheduler] draft failed: ${draftResp.status}`, draftText.slice(0, 500));
      return new Response(JSON.stringify({
        ok: false,
        target,
        seq_start: seqStart,
        batch_count: batchCount,
        draft_status: draftResp.status,
        draft_error: draftJson?.error ?? draftText.slice(0, 500),
        counts,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      target,
      seq_start: seqStart,
      batch_count: batchCount,
      inserted: draftJson?.inserted ?? 0,
      counts_before: counts,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('scheduler error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}));
