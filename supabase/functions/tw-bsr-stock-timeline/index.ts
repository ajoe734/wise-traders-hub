// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// 逐檔 BSR 時間軸：回傳指定股票近 N 天的所有 attempt 記錄
// 內含實際抓取時間、HTTP 狀態碼、outcome、latency、UA、backoff/consecutive 狀態、
// fallback as_of_date、next_retry_at 及其推算來源。
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  try {
    const url = new URL(req.url);
    const stockId = String(url.searchParams.get("stock_id") || "").trim();
    const days = Math.min(Math.max(Number(url.searchParams.get("days") || 14), 1), 60);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 500), 1), 2000);

    if (!/^[0-9]{4,6}$/.test(stockId)) {
      return new Response(JSON.stringify({ error: "stock_id required (4-6 digits)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

    const { data: attempts, error } = await supa
      .from("tw_bsr_attempt_logs")
      .select(
        "id, stock_id, trade_date, attempted_at, ua_label, ua_hash, "
        + "backoff_seconds_before, consecutive_failures_before, ocr_mode, "
        + "latency_ms, outcome, attempt_step, config_version, "
        + "http_status, error, fallback_used, fallback_as_of_date, "
        + "next_retry_at, next_retry_source"
      )
      .eq("stock_id", stockId)
      .gte("attempted_at", sinceIso)
      .order("attempted_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    // 目前失敗狀態
    const { data: failures } = await supa
      .from("tw_bsr_fetch_failures")
      .select("trade_date, reason, attempts, consecutive_failures, backoff_seconds, next_retry_at, resolved_at, last_error, updated_at")
      .eq("stock_id", stockId)
      .order("updated_at", { ascending: false })
      .limit(20);

    // 最近成功日
    const { data: lastOk } = await supa
      .from("tw_bsr_daily")
      .select("trade_date")
      .eq("stock_id", stockId)
      .order("trade_date", { ascending: false })
      .limit(1);

    // 匯總指標
    const rows = attempts || [];
    const totalReal = rows.filter((r) => r.attempt_step !== 99);
    const success = totalReal.filter((r) => r.outcome === "success").length;
    const captcha = totalReal.filter((r) => r.outcome === "captcha_retry_exhausted" || (r.outcome || "").startsWith("captcha_http")).length;
    const block = totalReal.filter((r) => r.outcome === "http_block").length;
    const empty = totalReal.filter((r) => r.outcome === "empty_rows").length;
    const fallbackRuns = rows.filter((r) => r.attempt_step === 99 && r.fallback_used).length;

    const summary = {
      stock_id: stockId,
      window_days: days,
      total_attempts: totalReal.length,
      success,
      captcha_exhausted: captcha,
      http_block: block,
      empty: empty,
      other_fail: totalReal.length - success - captcha - block - empty,
      finalized_with_fallback: fallbackRuns,
      last_successful_as_of: lastOk?.[0]?.trade_date || null,
      generated_at: new Date().toISOString(),
    };

    return new Response(
      JSON.stringify({
        summary,
        attempts: rows,
        failures: failures || [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
