// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file no-explicit-any
// tw-bsr-failure-dashboard
// 後台 BSR OCR 失敗看板：
//   - globalDaily: 逐日抓取嘗試、成功、captcha/http_block/empty 次數
//   - perStock:    逐檔的每日失敗細節與 fallback 對齊日 (tw_chips_rollup.as_of_date)
//   - topOffenders: 近 N 日 captcha 率最高的檔
// 僅 company_admin 可存取。
import { corsHeaders } from "../_shared/cors.ts";
import { requireCompanyAdmin, authErrorResponse } from '../_shared/adminGuard.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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

  // --- auth ---
  // AUTH: company_admin (unified contract — see _shared/adminGuard.ts)
  try {
    await requireCompanyAdmin(req);
  } catch (e) {
    return authErrorResponse(e, req);
  }

  // --- params ---
  const url = new URL(req.url);
  const today = new Date();
  const toStr = (url.searchParams.get("to") || today.toISOString().slice(0, 10));
  const days = clamp(parseInt(url.searchParams.get("days") || "14", 10), 1, 90);
  const from = new Date(toStr + "T00:00:00Z");
  from.setUTCDate(from.getUTCDate() - (days - 1));
  const fromStr = from.toISOString().slice(0, 10);
  const stockFilter = (url.searchParams.get("stock_id") || "").trim();
  const reasonFilter = (url.searchParams.get("reason") || "").trim();
  const errorClassFilter = (url.searchParams.get("error_class") || "").trim();

  // --- fetch failures ---
  let failuresUrl =
    `${SUPABASE_URL}/rest/v1/tw_bsr_fetch_failures?select=stock_id,trade_date,reason,error_class,attempts,last_error,resolved_at,consecutive_failures,next_retry_at,backoff_seconds,updated_at` +
    `&trade_date=gte.${fromStr}&trade_date=lte.${toStr}` +
    `&order=trade_date.desc&limit=5000`;
  if (stockFilter) failuresUrl += `&stock_id=eq.${encodeURIComponent(stockFilter)}`;
  if (reasonFilter) failuresUrl += `&reason=eq.${encodeURIComponent(reasonFilter)}`;
  if (errorClassFilter) failuresUrl += `&error_class=eq.${encodeURIComponent(errorClassFilter)}`;

  const failuresRes = await fetch(failuresUrl, { headers: srHeaders() });
  if (!failuresRes.ok) return json({ error: "FAILURES_QUERY_FAILED" }, 500);
  const failures: any[] = await failuresRes.json();

  // --- fetch metrics (global daily) ---
  const metricsUrl =
    `${SUPABASE_URL}/rest/v1/tw_bsr_sync_metrics?select=bucket_at,total,success,ocr_fail,http_block,empty,avg_latency_ms` +
    `&bucket_at=gte.${fromStr}T00:00:00Z&bucket_at=lte.${toStr}T23:59:59Z&order=bucket_at.desc&limit=5000`;
  const metricsRes = await fetch(metricsUrl, { headers: srHeaders() });
  const metrics: any[] = metricsRes.ok ? await metricsRes.json() : [];

  // --- rollup for fallback as_of_date per stock ---
  const stockIds = Array.from(new Set(failures.map((f) => f.stock_id))).filter(Boolean);
  let rollupMap: Record<string, { as_of_date: string; bsr_available: boolean }> = {};
  if (stockIds.length) {
    const inList = stockIds.map((s) => encodeURIComponent(s)).join(",");
    const rollupUrl =
      `${SUPABASE_URL}/rest/v1/tw_chips_rollup?select=stock_id,as_of_date,bsr_available` +
      `&stock_id=in.(${inList})&window_days=eq.20&order=as_of_date.desc&limit=5000`;
    const rr = await fetch(rollupUrl, { headers: srHeaders() });
    if (rr.ok) {
      const rows: any[] = await rr.json();
      for (const r of rows) {
        if (!rollupMap[r.stock_id]) rollupMap[r.stock_id] = { as_of_date: r.as_of_date, bsr_available: !!r.bsr_available };
      }
    }
  }

  // --- fetch stock names for display ---
  let nameMap: Record<string, string> = {};
  if (stockIds.length) {
    const inList = stockIds.map((s) => encodeURIComponent(s)).join(",");
    const nr = await fetch(
      `${SUPABASE_URL}/rest/v1/stock_names?select=stock_id,name&stock_id=in.(${inList})&limit=5000`,
      { headers: srHeaders() },
    );
    if (nr.ok) {
      const rows: any[] = await nr.json();
      for (const r of rows) nameMap[r.stock_id] = r.name;
    }
  }

  // --- aggregate globalDaily from metrics ---
  const globalByDate: Record<string, { attempts: number; success: number; ocr_fail: number; http_block: number; empty: number }> = {};
  for (const m of metrics) {
    const d = String(m.bucket_at).slice(0, 10);
    const b = (globalByDate[d] ||= { attempts: 0, success: 0, ocr_fail: 0, http_block: 0, empty: 0 });
    b.attempts += Number(m.total || 0);
    b.success += Number(m.success || 0);
    b.ocr_fail += Number(m.ocr_fail || 0);
    b.http_block += Number(m.http_block || 0);
    b.empty += Number(m.empty || 0);
  }
  const globalDaily = Object.entries(globalByDate)
    .map(([date, v]) => ({
      date,
      ...v,
      captcha_rate: v.attempts > 0 ? +(v.ocr_fail / v.attempts).toFixed(4) : 0,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  // --- per-stock aggregation ---
  type PS = {
    stock_id: string;
    name: string | null;
    total_failures: number;
    captcha_retry_exhausted: number;
    other_failures: number;
    latest_target_date: string | null;
    latest_reason: string | null;
    unresolved: number;
    consecutive_failures: number;
    next_retry_at: string | null;
    fallback_as_of_date: string | null;
    fallback_lag_days: number | null;
    dailyBreakdown: { date: string; reason: string; error_class: string; attempts: number; resolved: boolean }[];
  };
  const psMap: Record<string, PS> = {};
  // 日期 → error_class → 次數 累計，供 UI 堆疊圖使用
  const stackByDate: Record<string, Record<string, number>> = {};
  // 全域 error_class 分佈
  const classTotals: Record<string, number> = {};

  for (const f of failures) {
    const p = (psMap[f.stock_id] ||= {
      stock_id: f.stock_id,
      name: nameMap[f.stock_id] || null,
      total_failures: 0,
      captcha_retry_exhausted: 0,
      other_failures: 0,
      latest_target_date: null,
      latest_reason: null,
      unresolved: 0,
      consecutive_failures: 0,
      next_retry_at: null,
      fallback_as_of_date: null,
      fallback_lag_days: null,
      dailyBreakdown: [],
    });
    p.total_failures += 1;
    if (f.reason === "captcha_retry_exhausted") p.captcha_retry_exhausted += 1;
    else p.other_failures += 1;
    if (!f.resolved_at) p.unresolved += 1;
    // error_class：DB 未回填時，用 reason/last_error 現場推導，向後相容舊資料
    const cls: string = f.error_class || classifyErrorFallback(f.reason, f.last_error);
    if (!p.latest_target_date || String(f.trade_date) > p.latest_target_date) {
      p.latest_target_date = String(f.trade_date);
      p.latest_reason = f.reason;
      p.consecutive_failures = Number(f.consecutive_failures || 0);
      p.next_retry_at = f.next_retry_at || null;
    }
    p.dailyBreakdown.push({
      date: String(f.trade_date),
      reason: f.reason,
      error_class: cls,
      attempts: Number(f.attempts || 0),
      resolved: !!f.resolved_at,
    });
    const dayKey = String(f.trade_date);
    (stackByDate[dayKey] ||= {})[cls] = (stackByDate[dayKey][cls] || 0) + 1;
    classTotals[cls] = (classTotals[cls] || 0) + 1;
  }

  // attach rollup fallback
  const toDate = new Date(toStr + "T00:00:00Z");
  for (const p of Object.values(psMap)) {
    const rl = rollupMap[p.stock_id];
    if (rl?.as_of_date) {
      p.fallback_as_of_date = rl.as_of_date;
      const d = new Date(rl.as_of_date + "T00:00:00Z");
      p.fallback_lag_days = Math.max(0, Math.round((toDate.getTime() - d.getTime()) / 86400000));
    }
    p.dailyBreakdown.sort((a, b) => (a.date < b.date ? 1 : -1));
  }
  const perStock = Object.values(psMap).sort((a, b) => b.captcha_retry_exhausted - a.captcha_retry_exhausted || b.total_failures - a.total_failures);

  const topOffenders = perStock
    .filter((p) => p.total_failures >= 2)
    .slice(0, 20)
    .map((p) => ({
      stock_id: p.stock_id,
      name: p.name,
      captcha_retry_exhausted: p.captcha_retry_exhausted,
      total_failures: p.total_failures,
      captcha_rate: p.total_failures > 0 ? +(p.captcha_retry_exhausted / p.total_failures).toFixed(4) : 0,
      consecutive_failures: p.consecutive_failures,
      next_retry_at: p.next_retry_at,
      fallback_as_of_date: p.fallback_as_of_date,
      fallback_lag_days: p.fallback_lag_days,
    }));

  // 全部觀察到的 error_class，供前端渲染堆疊圖固定欄位
  const errorClasses = Object.keys(classTotals).sort((a, b) => classTotals[b] - classTotals[a]);
  const dailyErrorClassStack = Object.entries(stackByDate)
    .map(([date, buckets]) => {
      const row: Record<string, any> = { date, total: 0 };
      for (const c of errorClasses) row[c] = buckets[c] || 0;
      row.total = Object.values(buckets).reduce((a, b) => a + b, 0);
      return row;
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const errorClassDistribution = errorClasses.map((c) => ({
    error_class: c,
    count: classTotals[c],
    share: failures.length > 0 ? +(classTotals[c] / failures.length).toFixed(4) : 0,
  }));

  return json({
    range: { from: fromStr, to: toStr, days },
    filters: { stock_id: stockFilter || null, reason: reasonFilter || null, error_class: errorClassFilter || null },
    globalDaily,
    perStock,
    topOffenders,
    errorClasses,
    errorClassDistribution,
    dailyErrorClassStack,
    totals: {
      total_failures: failures.length,
      captcha_retry_exhausted: failures.filter((f) => f.reason === "captcha_retry_exhausted").length,
      unresolved: failures.filter((f) => !f.resolved_at).length,
      affected_stocks: perStock.length,
      fallback_used: perStock.filter((p) => p.fallback_as_of_date).length,
    },
    generated_at: new Date().toISOString(),
  });
});

// 舊資料 error_class 為空時的即時推導：match daily-sync 的 classifyBsrError
function classifyErrorFallback(reason: string | null, lastError: string | null): string {
  const s = `${reason || ""} ${lastError || ""}`;
  if (/http_block_403/.test(s)) return "http_block_403";
  if (/http_block_429/.test(s)) return "http_block_429";
  if (/http_block/.test(s)) return "http_block";
  if (/captcha_http/.test(s)) return "captcha_http";
  if (/menu_parse_failed/.test(s)) return "menu_parse_failed";
  if (/empty_rows/.test(s)) return "empty_rows";
  if (/db_insert/.test(s)) return "db_insert_failed";
  if (/captcha_retry_exhausted:ocr_mismatch/.test(s)) return "ocr_mismatch";
  if (/captcha_retry_exhausted:ocr_null/.test(s)) return "ocr_null";
  if (/captcha_retry_exhausted/.test(s)) return "captcha_retry_exhausted";
  if (reason) return reason;
  return "unknown";
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function srHeaders() {
  return {
    "Content-Type": "application/json",
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  };
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}
