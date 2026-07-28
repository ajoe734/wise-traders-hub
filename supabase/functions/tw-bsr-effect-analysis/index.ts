// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file no-explicit-any
// tw-bsr-effect-analysis
// UA 池 / backoff / 連續失敗次數 對成功率影響的分析。
// 資料來源：public.tw_bsr_attempt_logs
// 僅 company_admin 可存取。
import { corsHeaders } from "../_shared/cors.ts";
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

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "AUTH_REQUIRED" }, 401);

  let callerId = "";
  try {
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: SERVICE_ROLE_KEY },
    });
    if (!ur.ok) return json({ error: "AUTH_FAILED" }, 401);
    callerId = (await ur.json())?.id || "";
  } catch { return json({ error: "AUTH_FAILED" }, 401); }
  if (!callerId) return json({ error: "AUTH_FAILED" }, 401);

  const roleRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/has_role`, {
    method: "POST", headers: srHeaders(),
    body: JSON.stringify({ _user_id: callerId, _role: "company_admin" }),
  });
  if (!roleRes.ok) return json({ error: "ROLE_CHECK_FAILED" }, 500);
  if ((await roleRes.json()) !== true) return json({ error: "FORBIDDEN" }, 403);

  const url = new URL(req.url);
  const today = new Date();
  const toStr = url.searchParams.get("to") || today.toISOString().slice(0, 10);
  const days = clamp(parseInt(url.searchParams.get("days") || "14", 10), 1, 90);
  const from = new Date(toStr + "T00:00:00Z");
  from.setUTCDate(from.getUTCDate() - (days - 1));
  const fromStr = from.toISOString().slice(0, 10);
  const uaFilter = (url.searchParams.get("ua_hash") || "").trim();

  // fetch attempt logs
  let logsUrl =
    `${SUPABASE_URL}/rest/v1/tw_bsr_attempt_logs?select=attempted_at,ua_label,ua_hash,backoff_seconds_before,consecutive_failures_before,ocr_mode,latency_ms,outcome` +
    `&attempted_at=gte.${fromStr}T00:00:00Z&attempted_at=lte.${toStr}T23:59:59Z` +
    `&order=attempted_at.desc&limit=50000`;
  if (uaFilter) logsUrl += `&ua_hash=eq.${encodeURIComponent(uaFilter)}`;

  const lr = await fetch(logsUrl, { headers: srHeaders() });
  if (!lr.ok) return json({ error: "LOGS_QUERY_FAILED", detail: await lr.text() }, 500);
  const logs: any[] = await lr.json();

  const emptyBucket = () => ({ attempts: 0, success: 0, captcha: 0, block: 0, empty: 0, other_fail: 0, latency_sum: 0 });

  // ---- group by UA ----
  const uaMap: Record<string, ReturnType<typeof emptyBucket> & { label: string; hash: string }> = {};
  // ---- group by backoff bucket ----
  const backoffBuckets = [
    { key: "0", min: 0, max: 0 },
    { key: "1-60", min: 1, max: 60 },
    { key: "61-300", min: 61, max: 300 },
    { key: "301-900", min: 301, max: 900 },
    { key: "901-1800", min: 901, max: 1800 },
    { key: "1801-3600", min: 1801, max: 3600 },
    { key: "3601+", min: 3601, max: Number.POSITIVE_INFINITY },
  ];
  const boMap: Record<string, ReturnType<typeof emptyBucket>> = {};
  backoffBuckets.forEach((b) => (boMap[b.key] = emptyBucket()));
  // ---- group by consecutive_failures ----
  const consecBuckets = ["0", "1", "2", "3", "4", "5+"];
  const csMap: Record<string, ReturnType<typeof emptyBucket>> = {};
  consecBuckets.forEach((k) => (csMap[k] = emptyBucket()));
  // ---- global daily series ----
  const dailyMap: Record<string, ReturnType<typeof emptyBucket>> = {};

  for (const l of logs) {
    const out = String(l.outcome || "");
    const isSuccess = out === "success";
    const isCaptcha = out === "captcha_retry_exhausted";
    const isBlock = out === "http_block";
    const isEmpty = out === "empty_rows";
    const latency = Number(l.latency_ms || 0);

    const bump = (b: ReturnType<typeof emptyBucket>) => {
      b.attempts += 1;
      if (isSuccess) b.success += 1;
      else if (isCaptcha) b.captcha += 1;
      else if (isBlock) b.block += 1;
      else if (isEmpty) b.empty += 1;
      else b.other_fail += 1;
      b.latency_sum += latency;
    };

    // UA
    const uaKey = String(l.ua_hash || "unknown");
    if (!uaMap[uaKey]) uaMap[uaKey] = { ...emptyBucket(), label: String(l.ua_label || uaKey), hash: uaKey };
    bump(uaMap[uaKey]);
    // backoff
    const bo = Number(l.backoff_seconds_before || 0);
    const boKey = backoffBuckets.find((b) => bo >= b.min && bo <= b.max)?.key || "0";
    bump(boMap[boKey]);
    // consec
    const cs = Number(l.consecutive_failures_before || 0);
    const csKey = cs >= 5 ? "5+" : String(cs);
    bump(csMap[csKey]);
    // daily
    const d = String(l.attempted_at).slice(0, 10);
    if (!dailyMap[d]) dailyMap[d] = emptyBucket();
    bump(dailyMap[d]);
  }

  const finalize = (b: ReturnType<typeof emptyBucket>) => {
    const total = b.attempts || 1;
    return {
      attempts: b.attempts,
      success: b.success,
      captcha: b.captcha,
      block: b.block,
      empty: b.empty,
      other_fail: b.other_fail,
      success_rate: +(b.success / total).toFixed(4),
      captcha_rate: +(b.captcha / total).toFixed(4),
      block_rate: +(b.block / total).toFixed(4),
      avg_latency_ms: Math.round(b.latency_sum / total),
    };
  };

  const byUa = Object.values(uaMap)
    .map((u) => ({ ua_label: u.label, ua_hash: u.hash, ...finalize(u) }))
    .sort((a, b) => b.attempts - a.attempts);

  const byBackoff = backoffBuckets.map((b) => ({ bucket: b.key, range_sec: [b.min, b.max === Infinity ? null : b.max], ...finalize(boMap[b.key]) }));
  const byConsecutive = consecBuckets.map((k) => ({ bucket: k, ...finalize(csMap[k]) }));
  const daily = Object.entries(dailyMap)
    .map(([date, v]) => ({ date, ...finalize(v) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const totals = finalize(logs.reduce((acc, l) => {
    const out = String(l.outcome || "");
    acc.attempts += 1;
    if (out === "success") acc.success += 1;
    else if (out === "captcha_retry_exhausted") acc.captcha += 1;
    else if (out === "http_block") acc.block += 1;
    else if (out === "empty_rows") acc.empty += 1;
    else acc.other_fail += 1;
    acc.latency_sum += Number(l.latency_ms || 0);
    return acc;
  }, emptyBucket()));

  return json({
    range: { from: fromStr, to: toStr, days },
    filters: { ua_hash: uaFilter || null },
    totals,
    byUa,
    byBackoff,
    byConsecutive,
    daily,
    generated_at: new Date().toISOString(),
  });
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function srHeaders() {
  return { "Content-Type": "application/json", apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };
}
function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}
