/**
 * valuation-fundamentals —— 持倉抽屜三把尺（PE/PB/PS）唯讀情境資料。
 *
 * - 一般登入者可呼叫；只讀，不寫任何資料表。
 * - FinMind token 只在後端（FINMIND_TOKEN），回應不含 token 或原始 URL。
 * - 不讀 stock_fundamentals（維持管理員限定），直接即時讀 FinMind 公開財報。
 * - 同業名單讀 stock_industry_map（公開分類），以 service role 唯讀查詢。
 */
// AUTH: user
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { fetchWithRetry } from '../_shared/retryFetch.ts';
import { requireCaller, AuthError } from '../_shared/authGuard.ts';
import {
  buildScenarioRows, closeOn, computeCompanyBasis, historyPoints, rankByScale, selectPeerCandidates,
  type FinRow, type PriceRow, type PeerInput,
} from '../_shared/fundamentalsBasis.ts';

const FINMIND = 'https://api.finmindtrade.com/api/v4/data';
const MAX_PREFETCH = 12;
const MAX_PEERS = 6;
const CACHE_TTL_MS = 6 * 3600 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

async function finmind<T>(dataset: string, id: string, start: string): Promise<T[]> {
  const key = `${dataset}:${id}:${start}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T[];
  const token = Deno.env.get('FINMIND_TOKEN') || '';
  const url = `${FINMIND}?dataset=${dataset}&data_id=${encodeURIComponent(id)}&start_date=${start}`;
  const res = await fetchWithRetry(url, token ? { headers: { Authorization: `Bearer ${token}` } } : {}, {
    source: `finmind_${dataset}`, policy: { maxAttempts: 3 },
  });
  const json = await res.json();
  if (json?.status !== 200 || !Array.isArray(json?.data)) {
    throw new Error(`finmind ${dataset} ${id} status=${json?.status} msg=${json?.msg}`);
  }
  cache.set(key, { at: Date.now(), value: json.data });
  return json.data as T[];
}

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

async function loadCompany(symbol: string, priceDays = 20) {
  const start = isoDaysAgo(5 * 365);
  const [fs, bs, px] = await Promise.all([
    finmind<FinRow>('TaiwanStockFinancialStatements', symbol, start),
    finmind<FinRow>('TaiwanStockBalanceSheet', symbol, start),
    finmind<{ date: string; close: number }>('TaiwanStockPrice', symbol, isoDaysAgo(priceDays)),
  ]);
  const prices: PriceRow[] = px.map((p) => ({ date: p.date, close: Number(p.close) }));
  return { fs, bs, prices };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    await requireCaller(req);
  } catch (e) {
    if (e instanceof AuthError) return errorResponse(e.message, e.status, { code: e.code }, req);
    throw e;
  }
  let symbol = '';
  try {
    const body = await req.json();
    symbol = String(body?.symbol ?? '').trim();
  } catch { /* fallthrough */ }
  if (!/^\d{4,6}$/.test(symbol)) return errorResponse('symbol 必須為 4–6 位台股代碼', 400, { code: 'BAD_SYMBOL' }, req);

  try {
    const supa = serviceClient();
    const { data: meta, error } = await supa.from('stock_industry_map').select('symbol,name,industries').eq('symbol', symbol).maybeSingle();
    if (error) throw new Error(`industry_map: ${error.message}`);
    const target = await loadCompany(symbol, 4 * 365);
    const asOf = target.prices.map((p) => p.date).sort().at(-1) ?? null;
    if (!asOf) return jsonResponse({ ok: true, symbol, asOf: null, rows: [], reason: '近 20 日無收盤價' }, {}, req);
    const targetBasis = computeCompanyBasis(symbol, target.fs, target.bs, asOf);

    const industries: string[] = meta?.industries ?? [];
    let candidates: Array<{ symbol: string; name: string }> = [];
    if (industries.length) {
      const { data: uni, error: uErr } = await supa.from('stock_industry_map').select('symbol,name,industries').contains('industries', industries).limit(200);
      if (uErr) throw new Error(`peer_universe: ${uErr.message}`);
      candidates = selectPeerCandidates({ symbol, industries }, (uni ?? []) as any).sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
    const truncated = candidates.length > MAX_PREFETCH;
    const loaded: PeerInput[] = [];
    for (const c of candidates.slice(0, MAX_PREFETCH)) {
      try {
        const d = await loadCompany(c.symbol);
        loaded.push({ symbol: c.symbol, name: c.name, basis: computeCompanyBasis(c.symbol, d.fs, d.bs, asOf), close: closeOn(d.prices, asOf) });
      } catch (e) {
        console.error('peer_load_failed', c.symbol, String(e));
      }
    }
    const peers = rankByScale(targetBasis, loaded, MAX_PEERS);
    const peerRule = `與本檔共用全部細分產業標籤（${industries.join('＋') || '無'}）`
      + (truncated ? `；候選 ${candidates.length} 家，依代碼取前 ${MAX_PREFETCH} 家後` : '')
      + (loaded.length > MAX_PEERS ? `；取近四季營收規模最接近的 ${MAX_PEERS} 家` : '')
      + '；虧損、分母≤0、股數無法核對或無收盤者不列入';
    const history = historyPoints(symbol, target.fs, target.bs, target.prices, asOf);
    const rows = buildScenarioRows(targetBasis, peers, peerRule, history);
    return jsonResponse({
      ok: true,
      symbol,
      name: meta?.name ?? null,
      asOf,
      close: closeOn(target.prices, asOf),
      basis: targetBasis,
      peerRule,
      rows,
    }, {}, req);
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : String(e), 502, { code: 'UPSTREAM_FAILED' }, req);
  }
});
