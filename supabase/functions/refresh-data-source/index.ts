// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// refresh-data-source: 立即重新抓取指定的免費資料源，回傳最新筆數並寫入 refresh log
//
// 支援的 source_key：
//   - twse-isin        TWSE 上市（mode=2）+ 上櫃（mode=4）ISIN 產業別
//   - finmind          FinMind TaiwanStockInfo
//   - twse-openapi     TWSE OpenAPI 個股基本資料（連通性 + 筆數）
//   - tpex-openapi     TPEx OpenAPI 上櫃基本資料（連通性 + 筆數）
//   - data-gov-tw      data.gov.tw 上市公司資料集
//
// 只有 company_admin 可觸發。回傳 { ok, source_key, row_count, duration_ms, log_id }。
import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
import { fetchWithRateLimit } from '../_shared/finmindRateLimit.ts';

// service role client for rate-limit RPCs (RLS-safe)
const _rlClient = serviceClient();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// ============ 各資料源抓取器（都只做「取回並算筆數」，不寫回 bundle） ============

async function fetchTwseIsin(): Promise<{ rowCount: number; meta: Record<string, unknown> }> {
  const modes = [2, 4];
  let total = 0;
  const per: Record<string, number> = {};
  for (const m of modes) {
    const res = await fetch(`https://isin.twse.com.tw/isin/C_public.jsp?strMode=${m}`);
    if (!res.ok) throw new Error(`TWSE mode=${m} status ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    // Big5 → utf8：粗略計算 <tr> 數即可，不需精確 decode
    const text = new TextDecoder('big5', { fatal: false }).decode(buf);
    const rows = (text.match(/<tr>/g) || []).length;
    per[`mode${m}`] = rows;
    total += rows;
  }
  return { rowCount: total, meta: { per_mode: per } };
}

async function fetchFinmind(): Promise<{ rowCount: number; meta: Record<string, unknown> }> {
  const token = Deno.env.get('FINMIND_TOKEN') || Deno.env.get('FINMIND_API_TOKEN');
  const params = new URLSearchParams({ dataset: 'TaiwanStockInfo' });
  if (token) params.set('token', token);
  // 原子預留由 fetchWithRateLimit 內部完成；禁止再做非原子的 pre-check。
  const res = await fetchWithRateLimit(
    _rlClient,
    `https://api.finmindtrade.com/api/v4/data?${params}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (res.status === 429) throw new Error('finmind_rate_limited (429 after retries)');
  if (!res.ok) throw new Error(`FinMind status ${res.status}`);
  const j = await res.json();
  const rows = Array.isArray(j.data) ? j.data.length : 0;
  if (!rows) throw new Error(`FinMind returned no rows: ${JSON.stringify(j).slice(0, 200)}`);
  return { rowCount: rows, meta: { token_used: Boolean(token) } };
}


async function fetchTwseOpenapi(): Promise<{ rowCount: number; meta: Record<string, unknown> }> {
  const res = await fetch('https://openapi.twse.com.tw/v1/opendata/t187ap03_L');
  if (!res.ok) throw new Error(`TWSE OpenAPI status ${res.status}`);
  const arr = await res.json();
  return { rowCount: Array.isArray(arr) ? arr.length : 0, meta: { endpoint: 't187ap03_L' } };
}

async function fetchTpexOpenapi(): Promise<{ rowCount: number; meta: Record<string, unknown> }> {
  // 上櫃股票每日行情
  const res = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes');
  if (!res.ok) throw new Error(`TPEx OpenAPI status ${res.status}`);
  const arr = await res.json();
  return { rowCount: Array.isArray(arr) ? arr.length : 0, meta: { endpoint: 'daily_close_quotes' } };
}

async function fetchDataGovTw(): Promise<{ rowCount: number; meta: Record<string, unknown> }> {
  // 上市公司基本資料 dataset ID 10454（同 TWSE OpenAPI t187ap03_L 內容源）
  const res = await fetch('https://openapi.twse.com.tw/v1/opendata/t187ap03_L');
  if (!res.ok) throw new Error(`data.gov.tw upstream status ${res.status}`);
  const arr = await res.json();
  return { rowCount: Array.isArray(arr) ? arr.length : 0, meta: { via: 'twse-openapi (data.gov.tw 上市公司 mirror)' } };
}

const HANDLERS: Record<string, () => Promise<{ rowCount: number; meta: Record<string, unknown> }>> = {
  'twse-isin': fetchTwseIsin,
  'finmind': fetchFinmind,
  'twse-openapi': fetchTwseOpenapi,
  'tpex-openapi': fetchTpexOpenapi,
  'data-gov-tw': fetchDataGovTw,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

    const userClient = userClient(req);
    const admin = serviceClient();

    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json({ error: 'unauthorized' }, 401);
    const callerId = claims.claims.sub as string;

    const { data: isAdmin } = await admin.rpc('has_role', { _user_id: callerId, _role: 'company_admin' });
    if (!isAdmin) return json({ error: 'forbidden', message: '僅 company_admin 可觸發' }, 403);

    const body = await req.json().catch(() => ({}));
    const sourceKey = String(body?.source_key || '');
    const handler = HANDLERS[sourceKey];
    if (!handler) return json({ error: 'invalid_source', supported: Object.keys(HANDLERS) }, 400);

    // 開 log
    const { data: logRow, error: logErr } = await admin
      .from('data_source_refresh_logs')
      .insert({ source_key: sourceKey, triggered_by: callerId, status: 'running' })
      .select('id, started_at')
      .single();
    if (logErr || !logRow) return json({ error: 'log_insert_failed', detail: logErr?.message }, 500);

    const t0 = Date.now();
    try {
      const { rowCount, meta } = await handler();
      const duration = Date.now() - t0;
      await admin
        .from('data_source_refresh_logs')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          duration_ms: duration,
          row_count: rowCount,
          metadata: meta,
        })
        .eq('id', logRow.id);
      return json({
        ok: true,
        source_key: sourceKey,
        row_count: rowCount,
        duration_ms: duration,
        log_id: logRow.id,
        metadata: meta,
      });
    } catch (e) {
      const duration = Date.now() - t0;
      const msg = e instanceof Error ? e.message : String(e);
      await admin
        .from('data_source_refresh_logs')
        .update({
          status: 'error',
          finished_at: new Date().toISOString(),
          duration_ms: duration,
          error_message: msg,
        })
        .eq('id', logRow.id);
      return json({ ok: false, source_key: sourceKey, error: msg, log_id: logRow.id, duration_ms: duration }, 502);
    }
  } catch (e) {
    return json({ error: 'internal', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
