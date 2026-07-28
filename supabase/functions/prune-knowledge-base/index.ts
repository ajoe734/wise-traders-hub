// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
// 知識庫清理：自動把死庫存 / 實戰打臉的條目降級為 archived。
// 規則（兩條獨立，符合任一即降級）：
//   1. 死庫存：建立 > 30 天 + 過去 90 天 0 命中
//   2. 實戰打臉：sample_size >= 20 且 win_rate < 0.4
//
// 模式：
//   - dryRun=true（預設）→ 只回傳候選清單，不寫入
//   - dryRun=false → 真的把 lifecycle_status 設為 'archived'
//
// 由 pg_cron 每週日 03:00 (UTC+8) 觸發 dryRun=false。
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { corsHeaders } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
const STALE_DAYS = 90;
const MIN_AGE_DAYS = 30;
const MIN_SAMPLE_SIZE = 20;
const LOW_WIN_RATE = 0.4;

Deno.serve(withLogging('prune-knowledge-base', async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun !== false;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const now = Date.now();
    const staleSince = new Date(now - STALE_DAYS * 86400000).toISOString();
    const minAgeBefore = new Date(now - MIN_AGE_DAYS * 86400000).toISOString();

    // 撈所有目前 active/rescue 的條目
    const { data: items, error: itemsErr } = await supabase
      .from('checkup_knowledge_items')
      .select('id, item_id, category, title, created_at, win_rate, sample_size, lifecycle_status, source_type')
      .in('lifecycle_status', ['active', 'rescue']);
    if (itemsErr) throw itemsErr;

    // 撈近 90 天的命中數，按 knowledge_item_id 統計
    const { data: hits, error: hitsErr } = await supabase
      .from('checkup_knowledge_hits')
      .select('knowledge_item_id')
      .gte('created_at', staleSince);
    if (hitsErr) throw hitsErr;

    const hitCount = new Map<string, number>();
    for (const h of hits ?? []) {
      const k = h.knowledge_item_id as string;
      hitCount.set(k, (hitCount.get(k) ?? 0) + 1);
    }

    const stale: any[] = [];
    const lowWin: any[] = [];

    for (const it of items ?? []) {
      const recentHits = hitCount.get(it.id) ?? 0;
      const isOldEnough = it.created_at && it.created_at < minAgeBefore;
      // 規則 1：死庫存
      if (isOldEnough && recentHits === 0) {
        stale.push({
          id: it.id, item_id: it.item_id, category: it.category, title: it.title,
          reason: `${STALE_DAYS}d_no_hits`,
          recent_hits: recentHits,
        });
        continue;
      }
      // 規則 2：實戰打臉
      if ((it.sample_size ?? 0) >= MIN_SAMPLE_SIZE && it.win_rate != null && Number(it.win_rate) < LOW_WIN_RATE) {
        lowWin.push({
          id: it.id, item_id: it.item_id, category: it.category, title: it.title,
          reason: `low_win_rate_${(Number(it.win_rate) * 100).toFixed(0)}pct_n${it.sample_size}`,
          win_rate: Number(it.win_rate),
          sample_size: it.sample_size,
        });
      }
    }

    const all = [...stale, ...lowWin];
    const summary = {
      dryRun,
      thresholds: {
        stale_days: STALE_DAYS,
        min_age_days: MIN_AGE_DAYS,
        min_sample_size: MIN_SAMPLE_SIZE,
        low_win_rate: LOW_WIN_RATE,
      },
      counts: {
        total_active_items: items?.length ?? 0,
        candidates_stale: stale.length,
        candidates_low_win: lowWin.length,
        candidates_total: all.length,
      },
      candidates_stale: stale,
      candidates_low_win: lowWin,
    };

    if (dryRun) {
      return new Response(JSON.stringify({ success: true, ...summary }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 寫入：批次 update lifecycle_status='archived'
    let archived = 0;
    const errors: string[] = [];
    const archivedAt = new Date().toISOString();
    for (const c of all) {
      const { error } = await supabase
        .from('checkup_knowledge_items')
        .update({
          lifecycle_status: 'archived',
          archived_at: archivedAt,
          archived_reason: `auto_prune:${c.reason}`,
        })
        .eq('id', c.id);
      if (error) errors.push(`${c.item_id}: ${error.message}`);
      else archived++;
    }

    // audit log
    await supabase.from('audit_logs').insert({
      action: 'knowledge.auto_prune',
      target_type: 'checkup_knowledge_items',
      actor_id: null,
      detail: { ...summary, archived, errors },
    });

    return new Response(JSON.stringify({ success: errors.length === 0, ...summary, archived, errors }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('prune-knowledge-base error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}));
