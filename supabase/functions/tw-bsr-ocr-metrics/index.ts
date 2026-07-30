// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file no-explicit-any
// tw-bsr-ocr-metrics
// OCR 指標面板：
//  - variantStats: 每個 preprocessing variant (raw/otsu/adaptive/dilate/loose_crop)
//      的參與次數、非空猜測率、被 consensus 採用次數、採用後 TWSE accepted 率
//  - modeStats:    每個 ocr_mode (fast/standard/aggressive) 的採用與成功率
//  - consensusStats: majority / fallback_first / none 的分布
//  - dailyTrend:   逐日 captcha_retry_exhausted 次數與率、OCR 嘗試總次數
//  - postOutcomeDaily: 逐日 accepted / mismatch / empty 分布
// 僅 company_admin 可存取。
import { corsHeaders } from "../_shared/cors.ts";
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

type VariantName = "raw" | "otsu" | "adaptive" | "dilate" | "loose_crop";
const VARIANTS: VariantName[] = ["raw", "otsu", "adaptive", "dilate", "loose_crop"];
const MODES = ["fast", "standard", "aggressive"] as const;
const CONSENSUSES = ["majority", "fallback_first", "none"] as const;

Deno.serve(async (req) => {
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

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  // AUTH: company_admin (unified contract — see _shared/adminGuard.ts)
  let callerId: string;
  try {
    callerId = await requireCompanyAdmin(req);
  } catch (e) {
    return authErrorResponse(e, req);
  }

  const url = new URL(req.url);
  const today = new Date();
  const toStr = url.searchParams.get("to") || today.toISOString().slice(0, 10);
  const days = clamp(parseInt(url.searchParams.get("days") || "14", 10), 1, 90);
  const from = new Date(toStr + "T00:00:00Z");
  from.setUTCDate(from.getUTCDate() - (days - 1));
  const fromStr = from.toISOString().slice(0, 10);
  const stockFilter = (url.searchParams.get("stock_id") || "").trim();

  // --- fetch attempt logs with ocr_trace ---
  const pageSize = 1000;
  let offset = 0;
  const logs: any[] = [];
  for (;;) {
    let u = `${SUPABASE_URL}/rest/v1/tw_bsr_attempt_logs?select=stock_id,trade_date,attempted_at,ocr_mode,outcome,ocr_trace` +
      `&trade_date=gte.${fromStr}&trade_date=lte.${toStr}` +
      `&ocr_trace=not.is.null&order=attempted_at.desc&limit=${pageSize}&offset=${offset}`;
    if (stockFilter) u += `&stock_id=eq.${encodeURIComponent(stockFilter)}`;
    const r = await fetch(u, { headers: srHeaders() });
    if (!r.ok) return json({ error: "LOG_FETCH_FAILED", status: r.status }, 500);
    const chunk = await r.json();
    logs.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
    if (offset >= 20000) break;
  }

  // --- fetch daily failures for captcha_retry_exhausted trend ---
  let failuresUrl = `${SUPABASE_URL}/rest/v1/tw_bsr_fetch_failures?select=stock_id,trade_date,reason,error_class,attempts` +
    `&trade_date=gte.${fromStr}&trade_date=lte.${toStr}&limit=10000`;
  if (stockFilter) failuresUrl += `&stock_id=eq.${encodeURIComponent(stockFilter)}`;
  const fr = await fetch(failuresUrl, { headers: srHeaders() });
  const failures: any[] = fr.ok ? await fr.json() : [];

  // --- fetch daily sync attempts count for denominator ---
  let statsUrl = `${SUPABASE_URL}/rest/v1/tw_bsr_daily?select=stock_id,trade_date&trade_date=gte.${fromStr}&trade_date=lte.${toStr}&limit=20000`;
  if (stockFilter) statsUrl += `&stock_id=eq.${encodeURIComponent(stockFilter)}`;
  const sr = await fetch(statsUrl, { headers: srHeaders() });
  const successRows: any[] = sr.ok ? await sr.json() : [];

  // --- variant / mode / consensus aggregations ---
  const variantAgg: Record<string, { attempts: number; non_null: number; adopted: number; accepted_after_adoption: number; total_elapsed_ms: number }> = {};
  for (const v of VARIANTS) variantAgg[v] = { attempts: 0, non_null: 0, adopted: 0, accepted_after_adoption: 0, total_elapsed_ms: 0 };

  const modeAgg: Record<string, { entries: number; accepted: number; mismatch: number; empty: number }> = {};
  for (const m of MODES) modeAgg[m] = { entries: 0, accepted: 0, mismatch: 0, empty: 0 };

  const consensusAgg: Record<string, number> = { majority: 0, fallback_first: 0, none: 0 };

  const postOutcomeByDay = new Map<string, { accepted: number; mismatch: number; empty: number }>();
  const attemptsByDay = new Map<string, number>();

  for (const row of logs) {
    const day = String(row.trade_date).slice(0, 10);
    const trace: any[] = Array.isArray(row.ocr_trace) ? row.ocr_trace : [];
    if (!trace.length) continue;
    attemptsByDay.set(day, (attemptsByDay.get(day) || 0) + trace.length);
    const post = postOutcomeByDay.get(day) || { accepted: 0, mismatch: 0, empty: 0 };

    for (const entry of trace) {
      const mode = String(entry?.mode || "");
      if (modeAgg[mode]) modeAgg[mode].entries += 1;
      const cons = String(entry?.consensus || "none");
      if (consensusAgg[cons] !== undefined) consensusAgg[cons] += 1;

      const variants: any[] = Array.isArray(entry?.variants) ? entry.variants : [];
      for (const v of variants) {
        const vn = String(v?.variant || "");
        const agg = variantAgg[vn];
        if (!agg) continue;
        agg.attempts += 1;
        if (v?.guess) agg.non_null += 1;
        if (typeof v?.elapsed_ms === "number") agg.total_elapsed_ms += v.elapsed_ms;
      }

      const adopted = entry?.adopted;
      const outcome = String(entry?.post_outcome || "empty");
      if (adopted?.variant && variantAgg[adopted.variant]) {
        variantAgg[adopted.variant].adopted += 1;
        if (outcome === "accepted") variantAgg[adopted.variant].accepted_after_adoption += 1;
      }
      if (modeAgg[mode]) {
        if (outcome === "accepted") modeAgg[mode].accepted += 1;
        else if (outcome === "mismatch") modeAgg[mode].mismatch += 1;
        else modeAgg[mode].empty += 1;
      }
      if (outcome === "accepted") post.accepted += 1;
      else if (outcome === "mismatch") post.mismatch += 1;
      else post.empty += 1;
    }
    postOutcomeByDay.set(day, post);
  }

  // --- daily trend: captcha_retry_exhausted 次數 / 率 ---
  const exhaustedByDay = new Map<string, number>();
  const failByDay = new Map<string, number>();
  for (const f of failures) {
    const d = String(f.trade_date).slice(0, 10);
    failByDay.set(d, (failByDay.get(d) || 0) + 1);
    if (f.reason === "captcha_retry_exhausted") {
      exhaustedByDay.set(d, (exhaustedByDay.get(d) || 0) + 1);
    }
  }
  const successByDay = new Map<string, number>();
  for (const s of successRows) {
    const d = String(s.trade_date).slice(0, 10);
    successByDay.set(d, (successByDay.get(d) || 0) + 1);
  }

  const dailyTrend: Array<{ date: string; exhausted: number; success: number; total: number; exhausted_rate: number; ocr_entries: number }> = [];
  const dayList: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + i);
    dayList.push(d.toISOString().slice(0, 10));
  }
  for (const d of dayList) {
    const exhausted = exhaustedByDay.get(d) || 0;
    const success = successByDay.get(d) || 0;
    const failTotal = failByDay.get(d) || 0;
    const total = success + failTotal;
    dailyTrend.push({
      date: d,
      exhausted,
      success,
      total,
      exhausted_rate: total > 0 ? exhausted / total : 0,
      ocr_entries: attemptsByDay.get(d) || 0,
    });
  }

  const postOutcomeDaily = dayList.map((d) => {
    const p = postOutcomeByDay.get(d) || { accepted: 0, mismatch: 0, empty: 0 };
    return { date: d, ...p };
  });

  // --- shape variantStats ---
  const variantStats = VARIANTS.map((v) => {
    const a = variantAgg[v];
    return {
      variant: v,
      attempts: a.attempts,
      non_null: a.non_null,
      non_null_rate: a.attempts > 0 ? a.non_null / a.attempts : 0,
      adopted: a.adopted,
      accepted_after_adoption: a.accepted_after_adoption,
      adoption_success_rate: a.adopted > 0 ? a.accepted_after_adoption / a.adopted : 0,
      adoption_share: 0, // filled below
      avg_latency_ms: a.attempts > 0 ? Math.round(a.total_elapsed_ms / a.attempts) : 0,
    };
  });
  const totalAdopted = variantStats.reduce((s, v) => s + v.adopted, 0);
  for (const v of variantStats) v.adoption_share = totalAdopted > 0 ? v.adopted / totalAdopted : 0;

  const modeStats = MODES.map((m) => {
    const a = modeAgg[m];
    return {
      mode: m,
      entries: a.entries,
      accepted: a.accepted,
      mismatch: a.mismatch,
      empty: a.empty,
      accept_rate: a.entries > 0 ? a.accepted / a.entries : 0,
    };
  });

  const consensusStats = CONSENSUSES.map((c) => ({ consensus: c, count: consensusAgg[c] || 0 }));
  const totalConsensus = consensusStats.reduce((s, x) => s + x.count, 0);
  for (const c of consensusStats as any[]) c.share = totalConsensus > 0 ? c.count / totalConsensus : 0;

  // trend delta: first-half vs second-half exhausted_rate
  const half = Math.floor(dailyTrend.length / 2);
  const firstHalf = dailyTrend.slice(0, half);
  const secondHalf = dailyTrend.slice(half);
  const avg = (arr: typeof dailyTrend) => arr.length ? arr.reduce((s, x) => s + x.exhausted_rate, 0) / arr.length : 0;
  const firstRate = avg(firstHalf);
  const secondRate = avg(secondHalf);

  return json({
    range: { from: fromStr, to: toStr, days },
    variantStats,
    modeStats,
    consensusStats,
    dailyTrend,
    postOutcomeDaily,
    totals: {
      log_rows: logs.length,
      total_ocr_entries: Array.from(attemptsByDay.values()).reduce((s, x) => s + x, 0),
      total_exhausted: Array.from(exhaustedByDay.values()).reduce((s, x) => s + x, 0),
      total_success: Array.from(successByDay.values()).reduce((s, x) => s + x, 0),
    },
    trend_delta: {
      first_half_rate: firstRate,
      second_half_rate: secondRate,
      change: secondRate - firstRate, // 負值代表下降
    },
    generated_at: new Date().toISOString(),
  });
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function srHeaders() {
  return { "Content-Type": "application/json", apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };
}
function clamp(n: number, mn: number, mx: number) { if (!Number.isFinite(n)) return mn; return Math.min(Math.max(n, mn), mx); }
