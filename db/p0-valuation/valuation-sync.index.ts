/**
 * VALUATION_THREE_RULERS_PLAN_V1 · S2 ingest
 *
 * 狀態：**僅產出檔案，尚未部署**。核准後搬到 `supabase/functions/valuation-sync/index.ts`
 * 再 deploy；放在 db/ 底下是為了確保本輪不會自動部署。
 *
 * 來源（本輪唯讀實測過）：
 *   - 主來源 FinMind `TaiwanStockPER`：逐日 PER / PBR / dividend_yield，含上櫃，5 年以上歷史。
 *   - 對帳來源 TWSE `openapi/v1/exchangeReport/BWIBBU_ALL`：1078 檔上市，免 token，當日一筆。
 *
 * 規則：
 *   - PER 為空／<= 0 一律寫 NULL（代表近四季無獲利），**不得**寫 0。
 *   - 外部呼叫一律走 `_shared/retryFetch.ts` 的 fetchWithRetry（專案憲法）。
 *   - 每檔耗用 FinMind 配額，需經 quota pool 節流。
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { fetchWithRetry } from '../_shared/retryFetch.ts';

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
  const res = await fetchWithRetry(url, {}, { attempts: 3, baseDelayMs: 500 });
  const json = await res.json();
  if (json?.status !== 200 || !Array.isArray(json?.data)) return [];
  return json.data.map((d: any) => ({
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
  const res = await fetchWithRetry(TWSE_BWIBBU, {}, { attempts: 2, baseDelayMs: 500 });
  const arr = await res.json();
  if (!Array.isArray(arr)) return [];
  return arr.map((r: any) => {
    // TWSE 用民國年 yyymmdd
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const token = Deno.env.get('FINMIND_API_TOKEN') || '';

  let body: any = {};
  try { body = await req.json(); } catch { /* 允許空 body */ }
  const symbols: string[] = Array.isArray(body?.symbols) ? body.symbols.map(String) : [];
  const days = Number(body?.days) > 0 ? Number(body.days) : 10;

  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const rows: Row[] = [];
  for (const s of symbols) {
    try {
      rows.push(...await fetchFinmindPer(s, iso(start), iso(end), token));
    } catch (e) {
      console.error('finmind_failed', s, String(e));
    }
  }

  let upserted = 0;
  if (rows.length) {
    const { error } = await supa
      .from('tw_valuation_daily')
      .upsert(rows, { onConflict: 'symbol,trade_date' });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    upserted = rows.length;
  }

  return new Response(JSON.stringify({ ok: true, upserted, symbols: symbols.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
