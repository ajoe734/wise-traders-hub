/**
 * valuation-fundamentals v2（待核准；套用時覆蓋 supabase/functions/valuation-fundamentals/index.ts，
 * 並將同目錄 fundamentalsBasis.ts 覆蓋 supabase/functions/_shared/fundamentalsBasis.ts）。
 *
 * - 一般登入者可呼叫；只讀，不寫任何資料表。FinMind token 只在後端。
 * - 股數面額：證交所 t187ap03_L／櫃買 mopsfin_t187ap03_O 官方公司基本資料（各 1 次請求、整表快取）。
 * - 請求預算（冷快取單檔）：目標 3 次 FinMind（損益、資產負債、4 年股價）＋官方名錄 ≤2 次
 *   ＋同業最多 6 家 × 3 次（3 年財報、10 日股價）= 上限 23 次；同業併發 3、單次逾時 8 秒、
 *   整體同業預算 15 秒，逾時者標「逾時未列入」。
 * - 記憶體快取只在同一 isolate 有效（冷啟動會重抓），回應帶 meta.requests 供觀測。
 */
// AUTH: user
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { fetchWithRetry } from '../_shared/retryFetch.ts';
import { requireCaller, AuthError } from '../_shared/authGuard.ts';
import {
  buildScenarioRows, closeOn, computeCompanyBasis, historyPoints, mapLimit, officialFromTpex, officialFromTwse, rankByScale,
  selectPeerCandidates, type FinRow, type OfficialShares, type PeerInput, type PriceRow,
} from '../_shared/fundamentalsBasis.ts';

const FINMIND = 'https://api.finmindtrade.com/api/v4/data';
const TWSE_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L';
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O';
const MAX_PEERS = 6;
const PEER_CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 8_000;
const OFFICIAL_TIMEOUT_MS = 25_000;
const PEER_BUDGET_MS = 15_000;
const CACHE_TTL_MS = 6 * 3600 * 1000;
const OFFICIAL_TTL_MS = 12 * 3600 * 1000;

const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

type Meter = { finmind: number; official: number; cacheHits: number; timeouts: number };

async function cached<T>(key: string, ttl: number, meter: Meter, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) { meter.cacheHits++; return hit.value as T; }
  const running = inflight.get(key);
  if (running) { meter.cacheHits++; return running as Promise<T>; }
  const p = load().then((v) => { cache.set(key, { at: Date.now(), value: v }); return v; }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function withTimeout<T>(ms: number, meter: Meter, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await run(ctl.signal); } catch (e) { if (ctl.signal.aborted) meter.timeouts++; throw e; } finally { clearTimeout(t); }
}

function finmind<T>(meter: Meter, dataset: string, id: string, start: string): Promise<T[]> {
  return cached(`${dataset}:${id}:${start}`, CACHE_TTL_MS, meter, () => withTimeout(REQUEST_TIMEOUT_MS, meter, async (signal) => {
    meter.finmind++;
    const token = Deno.env.get('FINMIND_TOKEN') || '';
    const url = `${FINMIND}?dataset=${dataset}&data_id=${encodeURIComponent(id)}&start_date=${start}`;
    const res = await fetchWithRetry(url, { ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}), signal }, {
      source: `finmind_${dataset}`, policy: { maxAttempts: 2 },
    });
    const json = await res.json();
    if (json?.status !== 200 || !Array.isArray(json?.data)) throw new Error(`finmind ${dataset} ${id} status=${json?.status}`);
    return json.data as T[];
  }));
}

function officialList(meter: Meter, url: string, src: 'TWSE' | 'TPEx'): Promise<Array<Record<string, string>>> {
  return cached(`official:${src}`, OFFICIAL_TTL_MS, meter, () => withTimeout(OFFICIAL_TIMEOUT_MS, meter, async (signal) => {
    meter.official++;
    const res = await fetchWithRetry(url, { signal }, { source: `official_${src}`, policy: { maxAttempts: 2 } });
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error(`${src} 公司基本資料格式錯誤`);
    return json as Array<Record<string, string>>;
  }));
}

async function officialShares(meter: Meter, symbol: string): Promise<OfficialShares | null> {
  const [l, o] = await Promise.allSettled([officialList(meter, TWSE_URL, 'TWSE'), officialList(meter, TPEX_URL, 'TPEx')]);
  if (l.status === 'fulfilled') {
    const row = l.value.find((r) => r['公司代號'] === symbol);
    if (row) return officialFromTwse(row);
  }
  if (o.status === 'fulfilled') {
    const row = o.value.find((r) => r['SecuritiesCompanyCode'] === symbol);
    if (row) return officialFromTpex(row);
  }
  return null;
}

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

async function loadCompany(meter: Meter, symbol: string, finYears: number, priceDays: number) {
  const start = isoDaysAgo(finYears * 365);
  const [fs, bs, px, official] = await Promise.all([
    finmind<FinRow>(meter, 'TaiwanStockFinancialStatements', symbol, start),
    finmind<FinRow>(meter, 'TaiwanStockBalanceSheet', symbol, start),
    finmind<{ date: string; close: number }>(meter, 'TaiwanStockPrice', symbol, isoDaysAgo(priceDays)),
    officialShares(meter, symbol),
  ]);
  const prices: PriceRow[] = px.map((p) => ({ date: p.date, close: Number(p.close) }));
  return { fs, bs, prices, official };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try { await requireCaller(req); } catch (e) {
    if (e instanceof AuthError) return errorResponse(e.message, e.status, { code: e.code }, req);
    throw e;
  }
  let symbol = '';
  try { symbol = String((await req.json())?.symbol ?? '').trim(); } catch { /* fallthrough */ }
  if (!/^\d{4,6}$/.test(symbol)) return errorResponse('symbol 必須為 4–6 位台股代碼', 400, { code: 'BAD_SYMBOL' }, req);

  const started = Date.now();
  const meter: Meter = { finmind: 0, official: 0, cacheHits: 0, timeouts: 0 };
  const fetchedAt = new Date().toISOString();
  try {
    const supa = serviceClient();
    const { data: meta, error } = await supa.from('stock_industry_map').select('symbol,name,industries').eq('symbol', symbol).maybeSingle();
    if (error) throw new Error(`industry_map: ${error.message}`);
    const target = await loadCompany(meter, symbol, 5, 4 * 365);
    const asOf = target.prices.map((p) => p.date).sort().at(-1) ?? null;
    if (!asOf) return jsonResponse({ ok: true, symbol, asOf: null, rows: [], reason: '近期無收盤價' }, {}, req);
    const targetBasis = computeCompanyBasis(symbol, target.fs, target.bs, asOf, { mode: 'live', official: target.official, fetchedAt });

    const industries: string[] = meta?.industries ?? [];
    let candidates: Array<{ symbol: string; name: string }> = [];
    if (industries.length) {
      const { data: uni, error: uErr } = await supa.from('stock_industry_map').select('symbol,name,industries').contains('industries', industries).limit(200);
      if (uErr) throw new Error(`peer_universe: ${uErr.message}`);
      candidates = selectPeerCandidates({ symbol, industries }, (uni ?? []) as any).sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
    const picked = candidates.slice(0, MAX_PEERS);
    const peerDeadline = Date.now() + PEER_BUDGET_MS;
    const timedOut: string[] = [];
    const settled = await mapLimit(picked, PEER_CONCURRENCY, async (c) => {
      if (Date.now() > peerDeadline) { timedOut.push(`${c.name}${c.symbol}`); throw new Error('budget'); }
      const d = await loadCompany(meter, c.symbol, 3, 10);
      return { symbol: c.symbol, name: c.name, basis: computeCompanyBasis(c.symbol, d.fs, d.bs, asOf, { mode: 'live', official: d.official, fetchedAt }), close: closeOn(d.prices, asOf) } as PeerInput;
    });
    const loaded = settled.flatMap((s, i) => {
      if (s.status === 'fulfilled') return [s.value];
      if (!timedOut.includes(`${picked[i].name}${picked[i].symbol}`)) timedOut.push(`${picked[i].name}${picked[i].symbol}`);
      return [];
    });
    const peers = rankByScale(targetBasis, loaded, MAX_PEERS);
    const peerRule = `與本檔共用全部細分產業標籤（${industries.join('＋') || '無'}）`
      + (candidates.length > MAX_PEERS ? `；候選 ${candidates.length} 家，依代碼取前 ${MAX_PEERS} 家` : '')
      + (timedOut.length ? `；逾時或讀取失敗未列入：${timedOut.join('、')}` : '')
      + '；虧損、分母≤0、股數無法核對或無收盤者不列入';
    const history = historyPoints(symbol, target.fs, target.bs, target.prices, asOf, target.official);
    const rows = buildScenarioRows(targetBasis, peers, peerRule, history);
    return jsonResponse({
      ok: true, symbol, name: meta?.name ?? null, asOf, fetchedAt,
      close: closeOn(target.prices, asOf), official: target.official, basis: targetBasis, peerRule, rows,
      meta: { requests: meter, elapsedMs: Date.now() - started, isolateCache: 'per-isolate, 不保證跨冷啟動' },
    }, {}, req);
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : String(e), 502, { code: 'UPSTREAM_FAILED' }, req);
  }
});
