// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// Phase L2-3 — TWSE STOCK_DAY_ALL bulk 回填 daily_price_snapshots
// 補齊 current_prices 沒涵蓋的大盤股（BSR 有分點但 snapshot missing 的那 487 檔）
// volume_shares 由 TradeVolume 直接取得（shares），避免張/股單位再次錯亂
//
// POST body 選填：
//   { dryRun?: boolean, refreshCoverage?: boolean, onlyCodes?: string[] }
// 預設會在寫入後呼叫 refresh_bsr_coverage_daily(10)
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { withLogging } from '../_shared/edgeLogger.ts';

const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';

function rocDateToIso(roc: string): string | null {
  // "1150724" → 民國114/7/24 → 2025-07-24
  const m = String(roc).match(/^(\d{2,3})(\d{2})(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10) + 1911;
  return `${y}-${m[2]}-${m[3]}`;
}

function num(s: unknown): number | null {
  if (s === null || s === undefined || s === '') return null;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

type TwseRow = {
  Date: string;
  Code: string;
  Name: string;
  TradeVolume: string;
  OpeningPrice: string;
  HighestPrice: string;
  LowestPrice: string;
  ClosingPrice: string;
  Change: string;
};

Deno.serve(withLogging('backfill-snapshots-twse-bulk', async (req) => {
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

  const admin = serviceClient();

  let body: { dryRun?: boolean; refreshCoverage?: boolean; onlyCodes?: string[] } = {};
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { /* ignore */ }
  }
  const dryRun = !!body.dryRun;
  const refreshCoverage = body.refreshCoverage !== false;
  const onlyCodes = Array.isArray(body.onlyCodes) && body.onlyCodes.length
    ? new Set(body.onlyCodes.map(String))
    : null;

  const started = Date.now();

  // 1. 拉 TWSE bulk
  const res = await fetch(TWSE_URL, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
  });
  if (!res.ok) {
    return new Response(JSON.stringify({ error: `TWSE ${res.status}`, body: await res.text() }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const rows = (await res.json()) as TwseRow[];
  if (!Array.isArray(rows) || !rows.length) {
    return new Response(JSON.stringify({ error: 'twse_empty' }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 2. 轉換 → daily_price_snapshots 列
  const tradeDate = rocDateToIso(rows[0]?.Date ?? '');
  if (!tradeDate) {
    return new Response(JSON.stringify({ error: 'bad_trade_date', raw: rows[0]?.Date }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const snapshotRows: Array<Record<string, unknown>> = [];
  let skipped = 0;
  for (const r of rows) {
    if (onlyCodes && !onlyCodes.has(r.Code)) { skipped++; continue; }
    const close = num(r.ClosingPrice);
    const volumeShares = num(r.TradeVolume); // TWSE STOCK_DAY_ALL 單位是股
    if (close == null || close <= 0) { skipped++; continue; }
    const change = num(r.Change);
    const yesterday = change != null ? close - change : null;
    const changePct = yesterday && yesterday > 0 ? (change! / yesterday) * 100 : null;

    snapshotRows.push({
      symbol: r.Code,
      trade_date: tradeDate,
      close_price: close,
      yesterday_close: yesterday,
      change_percent: changePct,
      is_limit_up: false, // bulk 無漲跌停基準，交由 daily-snapshot 主流程判定
      limit_up_price: null,
      volume: volumeShares,
      volume_unit: 'shares', // 明確標記 shares，交由 trigger 保持 volume_shares=volume
      volume_shares: volumeShares,
      market: 'TW',
    });
  }

  const summary: Record<string, unknown> = {
    trade_date: tradeDate,
    twse_rows: rows.length,
    prepared: snapshotRows.length,
    skipped,
    dry_run: dryRun,
  };

  if (dryRun) {
    return new Response(JSON.stringify({ ok: true, summary, sample: snapshotRows.slice(0, 3) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 3. 分批 upsert（避免單次 payload 太大）
  const BATCH = 500;
  let upserted = 0;
  const errors: string[] = [];
  for (let i = 0; i < snapshotRows.length; i += BATCH) {
    const chunk = snapshotRows.slice(i, i + BATCH);
    const { error } = await admin
      .from('daily_price_snapshots')
      .upsert(chunk, { onConflict: 'symbol,trade_date' });
    if (error) errors.push(`batch ${i}: ${error.message}`);
    else upserted += chunk.length;
  }
  summary.upserted = upserted;
  if (errors.length) summary.upsert_errors = errors.slice(0, 5);

  // 4. 觸發 coverage 重新聚合
  if (refreshCoverage && upserted > 0) {
    const { data: r, error: rerr } = await admin.rpc('refresh_bsr_coverage_daily', { days: 10 });
    summary.coverage_refresh = rerr ? { error: rerr.message } : r;
  }

  summary.duration_ms = Date.now() - started;

  return new Response(JSON.stringify({ ok: errors.length === 0, summary }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}));
