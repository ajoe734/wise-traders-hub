// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

/**
 * reconcile-warrant-quantities
 * -----------------------------
 * 用 warrant_expiry.exercise_ratio 自動修正 trade_records.quantity。
 *
 * 規則（張 → 股）：
 *   權證張數固定 = 1000 個單位
 *   股數 = signal.quantity(張) × 1000 × exercise_ratio
 *
 *   例：
 *     - ratio = 0.025 → 20 張 × 1000 × 0.025 = 500 股
 *     - ratio = 2.5   → 20 張 × 1000 × 2.5   = 50000 股
 *     - ratio = 1.0   → 20 張 × 1000 × 1.0   = 20000 股
 *
 * 若 warrant_expiry 沒有 ratio → 觸發 TWSE singleWarrant fallback 補抓；
 * 補不到才降級為 system_alert 告警管理員（不是預設路徑）。
 */

const TWSE_SINGLE = 'https://www.twse.com.tw/zh/warrant/warrantByStockNo';

// 提取 HTML 中 "行使比例" 對應值。TWSE 頁面用 <td> 排版，抓 "行使比例" 之後第一個數字 cell。
function parseRatioFromHtml(html: string): number | null {
  // 相容 "行使比例 (行使比率)" / 空白 / <br>
  const idx = html.search(/行使比[例率]/);
  if (idx < 0) return null;
  const tail = html.slice(idx, idx + 800);
  const m = tail.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchRatioFallback(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`${TWSE_SINGLE}?stkNo=${symbol}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 legendflow-reconcile/1.0' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return parseRatioFromHtml(html);
  } catch {
    return null;
  }
}

// 從 instrument 前綴取 6 碼權證代號
function warrantCode(instrument: string): string | null {
  const m = String(instrument || '').trim().match(/^(\d{6})(?=\s|$)/);
  return m ? m[1] : null;
}

const handler = withLogging("reconcile-warrant-quantities", async (req, log) => {
  const supabase = serviceClient();
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';
  const symbolFilter = url.searchParams.get('symbol');

  // 1. 抓所有 6 碼權證的 trade_records + signal
  const { data: trades, error: tradesErr } = await supabase
    .from('trade_records')
    .select('id, instrument, quantity, quantity_unit, signal_id, expert_id, expert_signals(id, quantity, quantity_unit)')
    .not('signal_id', 'is', null);
  if (tradesErr) {
    return jsonResponse({ ok: false, error: tradesErr.message }, { status: 500 });
  }

  const warrantTrades = (trades ?? [])
    .map((t: any) => ({ ...t, warrantCode: warrantCode(t.instrument) }))
    .filter((t: any) => t.warrantCode && (!symbolFilter || t.warrantCode === symbolFilter));

  if (warrantTrades.length === 0) {
    return jsonResponse({ ok: true, checked: 0, fixed: 0, missing_ratio: 0 });
  }

  // 2. 拉 warrant_expiry ratio
  const codes = [...new Set(warrantTrades.map((t: any) => t.warrantCode))];
  const { data: warrants } = await supabase
    .from('warrant_expiry')
    .select('symbol, exercise_ratio, ratio_source')
    .in('symbol', codes);
  const ratioMap = new Map<string, { ratio: number | null; source: string | null }>();
  for (const w of warrants ?? []) {
    ratioMap.set(w.symbol as string, { ratio: (w as any).exercise_ratio, source: (w as any).ratio_source });
  }

  // 3. 對缺 ratio 的補打 TWSE singleWarrant fallback
  const missingCodes = codes.filter((c) => !ratioMap.get(c)?.ratio);
  const fallbackResults: Record<string, number | null> = {};
  for (const c of missingCodes) {
    const r = await fetchRatioFallback(c);
    fallbackResults[c] = r;
    if (r !== null && !dryRun) {
      await supabase.from('warrant_expiry').upsert(
        {
          symbol: c,
          exercise_ratio: r,
          ratio_source: 'twse_single',
          ratio_updated_at: new Date().toISOString(),
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'symbol' },
      );
      ratioMap.set(c, { ratio: r, source: 'twse_single' });
    }
    // TWSE 禮貌 delay
    await new Promise((r) => setTimeout(r, 500));
  }

  // 4. 逐筆對帳
  let fixed = 0;
  let missingRatio = 0;
  const details: Array<Record<string, unknown>> = [];
  const missingAlerts: string[] = [];

  for (const t of warrantTrades) {
    const entry = ratioMap.get(t.warrantCode!);
    const ratio = entry?.ratio;
    const signalQty = Number((t.expert_signals as any)?.quantity ?? 0);
    const signalUnit = (t.expert_signals as any)?.quantity_unit ?? '張';
    if (!ratio) {
      missingRatio++;
      missingAlerts.push(t.warrantCode!);
      details.push({ trade_id: t.id, symbol: t.warrantCode, reason: 'ratio_unknown' });
      continue;
    }
    if (signalUnit !== '張' || !signalQty) continue;

    const expected = Math.round(signalQty * 1000 * ratio);
    const current = Number(t.quantity ?? 0);
    if (Math.abs(current - expected) <= 1) continue;

    details.push({
      trade_id: t.id,
      symbol: t.warrantCode,
      signal_qty_lot: signalQty,
      exercise_ratio: ratio,
      before: current,
      after: expected,
    });

    if (!dryRun) {
      const { error: updErr } = await supabase
        .from('trade_records')
        .update({ quantity: expected, quantity_unit: '股' })
        .eq('id', t.id);
      if (updErr) {
        log.error('trade_update_error', { id: t.id, message: updErr.message });
        continue;
      }
      await supabase.from('audit_logs').insert({
        action: 'warrant_ratio_reconcile',
        target_type: 'trade_records',
        target_id: t.id,
        detail: {
          symbol: t.warrantCode,
          exercise_ratio: ratio,
          ratio_source: entry?.source,
          signal_qty_lot: signalQty,
          quantity_before: current,
          quantity_after: expected,
        },
      });
      fixed++;
    } else {
      fixed++;
    }
  }

  // 5. 對真正找不到 ratio 的權證發告警
  if (!dryRun && missingAlerts.length > 0) {
    const uniq = [...new Set(missingAlerts)];
    await supabase.from('system_alerts').insert(
      uniq.map((code) => ({
        alert_type: 'warrant_ratio_missing',
        severity: 'warning',
        title: `權證 ${code} 找不到行使比例`,
        detail: { symbol: code, source_attempts: ['twse_daily', 'twse_single'] },
      })),
    ).select().maybeSingle().then(() => {}, () => {});
  }

  return jsonResponse({
    ok: true,
    dry_run: dryRun,
    checked: warrantTrades.length,
    fixed,
    missing_ratio: missingRatio,
    fallback_filled: Object.entries(fallbackResults).filter(([, v]) => v !== null).length,
    details,
  });
});

Deno.serve(handler);
