// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
// 知識庫盲測回填 + 自動降權
// 由 pg_cron 每週日 03:00 UTC+8 觸發
// 流程：
// 1. 取最近 N 天 checkup_knowledge_hits（尚未驗證的）
// 2. 對應 expected_outcome.horizon_days，用 daily_price_snapshots 比對股價變化
// 3. 寫入 checkup_knowledge_validations
// 4. 重算每條主表的 win_rate / sample_size / last_validated_at
// 5. 若 sample_size>=20 且 win_rate<0.4 → confidence -0.05（floor 0.3）
//    若 win_rate>=0.7 → confidence +0.03（ceil 0.95）
// 6. 任何自動調整寫 audit log
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
const SYSTEM_UID = '00000000-0000-0000-0000-000000000000';
const LOOKBACK_DAYS = 90; // 取最近 90 天的命中
const MIN_SAMPLE_FOR_ADJUST = 20;
const LOW_WIN_THRESHOLD = 0.4;
const HIGH_WIN_THRESHOLD = 0.7;
const CONFIDENCE_STEP_DOWN = 0.05;
const CONFIDENCE_STEP_UP = 0.03;
const CONFIDENCE_FLOOR = 0.3;
const CONFIDENCE_CEILING = 0.95;

interface Hit {
  id: string;
  knowledge_item_id: string;
  stock_code: string | null;
  created_at: string;
}

interface Item {
  id: string;
  item_id: string;
  category: string;
  expected_outcome: { direction?: string; horizon_days?: number; min_pct?: number } | null;
  confidence: number | null;
}

async function getPriceAt(supabase: any, symbol: string, dateISO: string): Promise<number | null> {
  // 找該日或前一個交易日
  const { data } = await supabase
    .from('daily_price_snapshots')
    .select('close_price, trade_date')
    .eq('symbol', symbol)
    .lte('trade_date', dateISO)
    .order('trade_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.close_price != null ? Number(data.close_price) : null;
}

Deno.serve(withLogging('knowledge-validate', async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = serviceClient();

    const now = new Date();
    const since = new Date(now.getTime() - LOOKBACK_DAYS * 86400000).toISOString();

    // 1. 取近期所有 hits（含已驗證的，因為 horizon 可能還沒到）
    const { data: allHits, error: hitsErr } = await supabase
      .from('checkup_knowledge_hits')
      .select('id, knowledge_item_id, stock_code, created_at')
      .gte('created_at', since)
      .not('stock_code', 'is', null);
    if (hitsErr) throw new Error(`fetch hits: ${hitsErr.message}`);

    // 已驗證的 hit_id 排除
    const { data: doneRows } = await supabase
      .from('checkup_knowledge_validations')
      .select('hit_id')
      .gte('evaluated_at', since)
      .not('hit_id', 'is', null);
    const doneIds = new Set((doneRows ?? []).map((r: any) => r.hit_id));

    const hits: Hit[] = (allHits ?? []).filter((h: any) => !doneIds.has(h.id));

    // 2. 取所有相關 items
    const itemIds = Array.from(new Set(hits.map(h => h.knowledge_item_id)));
    const { data: itemsRaw } = await supabase
      .from('checkup_knowledge_items')
      .select('id, item_id, category, expected_outcome, confidence')
      .in('id', itemIds.length > 0 ? itemIds : ['00000000-0000-0000-0000-000000000000']);
    const itemsMap = new Map<string, Item>();
    for (const it of (itemsRaw ?? [])) itemsMap.set(it.id, it as Item);

    // 3. 逐筆驗證
    const validations: any[] = [];
    let evaluated = 0;
    let skipped = 0;
    for (const hit of hits) {
      const item = itemsMap.get(hit.knowledge_item_id);
      if (!item || !item.expected_outcome) { skipped++; continue; }
      const horizon = Number(item.expected_outcome.horizon_days ?? 0);
      const direction = String(item.expected_outcome.direction ?? '');
      const minPct = Number(item.expected_outcome.min_pct ?? 0);
      if (!horizon || horizon <= 0 || !hit.stock_code) { skipped++; continue; }

      const hitDate = new Date(hit.created_at);
      const targetDate = new Date(hitDate.getTime() + horizon * 86400000);
      // horizon 還沒到 → 跳過下次再評
      if (targetDate.getTime() > now.getTime()) { skipped++; continue; }

      const baseISO = hitDate.toISOString().slice(0, 10);
      const targetISO = targetDate.toISOString().slice(0, 10);

      const basePrice = await getPriceAt(supabase, hit.stock_code, baseISO);
      const targetPrice = await getPriceAt(supabase, hit.stock_code, targetISO);
      if (basePrice == null || targetPrice == null || basePrice === 0) { skipped++; continue; }

      const changePct = ((targetPrice - basePrice) / basePrice) * 100;
      let isCorrect = false;
      if (direction === 'up') isCorrect = changePct >= (minPct || 0);
      else if (direction === 'down') isCorrect = changePct <= -(minPct || 0);
      else if (direction === 'sideways') isCorrect = Math.abs(changePct) <= (minPct || 3);
      else isCorrect = changePct >= 0;

      validations.push({
        knowledge_item_id: item.id,
        hit_id: hit.id,
        stock_code: hit.stock_code,
        horizon_days: horizon,
        expected_direction: direction,
        actual_change_pct: Number(changePct.toFixed(2)),
        is_correct: isCorrect,
        details: { base_price: basePrice, target_price: targetPrice, base_date: baseISO, target_date: targetISO },
      });
      evaluated++;
    }

    if (validations.length > 0) {
      // 分批 insert（避免單批太大）
      const CHUNK = 500;
      for (let i = 0; i < validations.length; i += CHUNK) {
        const chunk = validations.slice(i, i + CHUNK);
        const { error } = await supabase.from('checkup_knowledge_validations').insert(chunk);
        if (error) console.error('insert validations error:', error.message);
      }
    }

    // 4. 重算每條 item 的 win_rate / sample_size
    const adjustments: any[] = [];
    for (const itemId of itemIds) {
      const { data: stats, error: statsErr } = await supabase
        .from('checkup_knowledge_validations')
        .select('is_correct')
        .eq('knowledge_item_id', itemId);
      if (statsErr) continue;
      const total = stats?.length ?? 0;
      const correct = (stats ?? []).filter((r: any) => r.is_correct === true).length;
      const winRate = total > 0 ? correct / total : null;

      const item = itemsMap.get(itemId);
      const oldConf = Number(item?.confidence ?? 0.7);
      let newConf = oldConf;
      let adjustReason: string | null = null;
      if (winRate != null && total >= MIN_SAMPLE_FOR_ADJUST) {
        if (winRate < LOW_WIN_THRESHOLD) {
          newConf = Math.max(CONFIDENCE_FLOOR, oldConf - CONFIDENCE_STEP_DOWN);
          adjustReason = 'low_win_rate';
        } else if (winRate >= HIGH_WIN_THRESHOLD) {
          newConf = Math.min(CONFIDENCE_CEILING, oldConf + CONFIDENCE_STEP_UP);
          adjustReason = 'high_win_rate';
        }
      }

      const update: any = {
        win_rate: winRate != null ? Number(winRate.toFixed(3)) : null,
        sample_size: total,
        last_validated_at: new Date().toISOString(),
      };
      if (adjustReason) update.confidence = Number(newConf.toFixed(2));

      const { error: updErr } = await supabase
        .from('checkup_knowledge_items')
        .update(update)
        .eq('id', itemId);
      if (updErr) console.error('update item error:', updErr.message);

      if (adjustReason) {
        adjustments.push({
          item_id: itemId,
          old_confidence: oldConf,
          new_confidence: newConf,
          win_rate: winRate,
          sample_size: total,
          reason: adjustReason,
        });
      }
    }

    // 5. 寫 audit log（合併一筆）
    if (adjustments.length > 0) {
      await supabase.from('audit_logs').insert({
        actor_id: SYSTEM_UID,
        action: 'knowledge.auto_adjust',
        target_type: 'checkup_knowledge_items',
        detail: { adjustments, run_at: new Date().toISOString() },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      evaluated,
      skipped,
      validations_inserted: validations.length,
      items_updated: itemIds.length,
      adjustments,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('knowledge-validate error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}));
