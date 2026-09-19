/**
 * valuation-sync —— 估值三把尺 ingest（VALUATION_THREE_RULERS_PLAN_V1 · S2）
 *
 * 來源：
 *   - 主來源 FinMind `TaiwanStockPER`（逐日 PER / PBR / dividend_yield，含上櫃）
 *   - 對帳 TWSE `openapi/v1/exchangeReport/BWIBBU_ALL`（當日上市，免 token）
 *   - 產業分類 FinMind `TaiwanStockInfo` → public.tw_industry_peers
 *
 * 規則：
 *   - PER/PBR 空或 <= 0 一律寫 NULL（近四季無獲利），不得寫 0。
 *   - 外部呼叫一律走 _shared/retryFetch.ts（專案憲法）。
 *   - 僅接受排程金鑰（X-Cron-Key）。
 */
// AUTH: cron-key
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { fetchWithRetry } from '../_shared/retryFetch.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';

const FINMIND = 'https://api.finmindtrade.com/api/v4/data';
const TWSE_BWIBBU = 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL';

type Row = {
  symbol: string;
  trade_date: string;
  per: number | null;
  pbr: number | null;
  dividend_yield: number | null;
  market: string | null;
  source: string;
};

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
  return Number.isFinite(n) ? n : null;
}
function positive(v: unknown): number | null {
  const n = num(v);
  return n != null && n > 0 ? n : null;
}
function nonNegative(v: unknown): number | null {
  const n = num(v);
  return n != null && n >= 0 ? n : null;
}

export async function fetchFinmindPer(
  stockId: string,
  startDate: string,
  endDate: string,
  token: string,
): Promise<Row[]> {
  const url = `${FINMIND}?dataset=TaiwanStockPER&data_id=${encodeURIComponent(stockId)}&start_date=${startDate}&end_date=${endDate}${token ? `&token=${token}` : ''}`;
  const res = await fetchWithRetry(url, {}, { source: 'finmind_per', policy: { maxAttempts: 3 } });
  const json = await res.json();
  if (json?.status !== 200 || !Array.isArray(json?.data)) return [];
  return json.data.map((d: Record<string, unknown>) => ({
    symbol: String(d.stock_id),
    trade_date: String(d.date),
    per: positive(d.PER),
    pbr: positive(d.PBR),
    dividend_yield: nonNegative(d.dividend_yield),
    market: null,
    source: 'finmind',
  }));
}

export async function fetchTwseParity(): Promise<Row[]> {
  const res = await fetchWithRetry(TWSE_BWIBBU, {}, { source: 'twse_bwibbu', policy: { maxAttempts: 2 } });
  const arr = await res.json();
  if (!Array.isArray(arr)) return [];
  return arr.map((r: Record<string, unknown>) => {
    const raw = String(r.Date || '');
    const y = Number(raw.slice(0, 3)) + 1911;
    const iso = `${y}-${raw.slice(3, 5)}-${raw.slice(5, 7)}`;
    return {
      symbol: String(r.Code),
      trade_date: iso,
      per: positive(r.PEratio),
      pbr: positive(r.PBratio),
      dividend_yield: nonNegative(r.DividendYield),
      market: 'TWSE',
      source: 'twse_bwibbu',
    };
  });
}

/** 兩來源同日同檔的相對差；> 5% 視為 parity 異常。 */
export function parityDiff(a: number | null, b: number | null): number | null {
  if (a == null || b == null || a <= 0) return null;
  return Math.abs(b - a) / a;
}

async function refreshIndustryPeers(supa: ReturnType<typeof createClient>, token: string) {
  const url = `${FINMIND}?dataset=TaiwanStockInfo${token ? `&token=${token}` : ''}`;
  const res = await fetchWithRetry(url, {}, { source: 'finmind_stock_info', policy: { maxAttempts: 3 } });
  const json = await res.json();
  if (!Array.isArray(json?.data)) return 0;
  const rows = json.data
    .filter((d: Record<string, unknown>) => /^\d{4,6}$/.test(String(d.stock_id || '')) && d.industry_category)
    .map((d: Record<string, unknown>) => ({
      symbol: String(d.stock_id),
      industry: String(d.industry_category),
      market: String(d.type || '').toLowerCase() === 'twse' ? 'TWSE' : 'TPEX',
      updated_at: new Date().toISOString(),
    }));
  const seen = new Set<string>();
  const unique = rows.filter((r: { symbol: string }) => (seen.has(r.symbol) ? false : (seen.add(r.symbol), true)));
  for (let i = 0; i < unique.length; i += 500) {
    const { error } = await supa.from('tw_industry_peers').upsert(unique.slice(i, i + 500), { onConflict: 'symbol' });
    if (error) throw new Error(`industry_upsert_failed: ${error.message}`);
  }
  return unique.length;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    requireCronKey(req);
  } catch (e) {
    const err = e as AuthError;
    return new Response(JSON.stringify({ error: err.message || 'forbidden' }), {
      status: err.status || 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const token = Deno.env.get('FINMIND_TOKEN') || '';

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* 允許空 body */ }

  const days = Number(body?.days) > 0 ? Number(body.days) : 5;
  const mode = String(body?.mode || 'symbols');

  let industryCount: number | null = null;
  if (mode === 'industry' || body?.refresh_industry === true) {
    try {
      industryCount = await refreshIndustryPeers(supa, token);
    } catch (e) {
      return new Response(JSON.stringify({ error: String((e as Error).message) }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (mode === 'industry') {
      return new Response(JSON.stringify({ ok: true, industry_upserted: industryCount }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // 目標清單：明確傳入，或以目前持倉／已有序列的股票為母體
  let symbols: string[] = Array.isArray(body?.symbols) ? (body.symbols as unknown[]).map(String) : [];
  if (symbols.length === 0) {
    const { data } = await supa.from('tw_valuation_daily').select('symbol').limit(5000);
    symbols = Array.from(new Set((data || []).map((r: { symbol: string }) => r.symbol)));
  }

  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const perSymbol: Record<string, { rows: number; latest: string | null }> = {};
  const failures: Record<string, string> = {};
  const rows: Row[] = [];
  for (const s of symbols) {
    try {
      const r = await fetchFinmindPer(s, iso(start), iso(end), token);
      rows.push(...r);
      perSymbol[s] = {
        rows: r.length,
        latest: r.length ? r.map((x) => x.trade_date).sort().slice(-1)[0] : null,
      };
    } catch (e) {
      failures[s] = String((e as Error).message);
      console.error('finmind_failed', s, String(e));
    }
  }

  let upserted = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const { error } = await supa
      .from('tw_valuation_daily')
      .upsert(chunk, { onConflict: 'symbol,trade_date' });
    if (error) {
      return new Response(JSON.stringify({ error: error.message, upserted }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    upserted += chunk.length;
  }

  // TWSE parity（僅對帳，不覆寫主來源）
  let parity: { checked: number; mismatched: string[] } | null = null;
  if (body?.parity !== false) {
    try {
      const twse = await fetchTwseParity();
      const byKey = new Map(twse.map((r) => [`${r.symbol}|${r.trade_date}`, r]));
      const mismatched: string[] = [];
      let checked = 0;
      for (const r of rows) {
        const t = byKey.get(`${r.symbol}|${r.trade_date}`);
        if (!t) continue;
        checked++;
        const d = parityDiff(r.per, t.per);
        if (d != null && d > 0.05) mismatched.push(`${r.symbol}@${r.trade_date}:${d.toFixed(3)}`);
      }
      parity = { checked, mismatched };
    } catch (e) {
      console.error('twse_parity_failed', String(e));
    }
  }

  return new Response(JSON.stringify({
    ok: Object.keys(failures).length === 0,
    upserted,
    symbols: symbols.length,
    per_symbol: perSymbol,
    failures,
    parity,
    industry_upserted: industryCount,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
