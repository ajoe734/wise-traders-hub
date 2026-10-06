/**
 * valuation-fundamentals（版本見 VERSION；回應帶 version）。
 * - 官方名錄只等 OFFICIAL_WAIT_MS；逾時改用 FinMind 已發行股數＋股本推定面額（特別股未核實另行判定），名錄於背景續抓暖快取。
 * - 目標公司 FinMind 單次逾時 TARGET_TIMEOUT_MS，同業維持 REQUEST_TIMEOUT_MS。
 *
 * - 一般登入者可呼叫；只讀，不寫任何資料表。FinMind token 只在後端。
 * - 股數面額：證交所 t187ap03_L／櫃買 mopsfin_t187ap03_O 官方公司基本資料（各 1 次請求、整表快取）。
 * - 請求預算（冷快取單檔）：目標 3 次 FinMind（損益、資產負債、5 年股價）＋官方名錄 2 次
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
  auditPeers, buildScenarioRows, latestOrdinaryShare, officialFromIssuedShares, closeOn, computeCompanyBasis, mapLimit, monthlyHistory, officialFromTpex, officialFromTwse,
  rankPeerCandidates, type FinRow, type OfficialShares, type PeerInput, type PriceRow,
} from '../_shared/fundamentalsBasis.ts';

const FINMIND = 'https://api.finmindtrade.com/api/v4/data';
const TWSE_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L';
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O';
const MAX_PEERS = 6;
/** 目標財報抓 7 年：前 4 季需再往前 4 季才能算近四季營收年增，5 年會讓最早一年的景氣判斷全為「不明」。 */
const TARGET_FIN_YEARS = 7;
const PEER_CONCURRENCY = 3;
export const VERSION = 'valuation-fundamentals@2026-10-06.1';
const REQUEST_TIMEOUT_MS = 8_000;
const TARGET_TIMEOUT_MS = 20_000;
const OFFICIAL_TIMEOUT_MS = 60_000;
const OFFICIAL_WAIT_MS = 3_000;
const PEER_BUDGET_MS = 15_000;
const CACHE_TTL_MS = 6 * 3600 * 1000;
const OFFICIAL_TTL_MS = 12 * 3600 * 1000;

const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

/** finmind/official = 邏輯請求；httpAttempts = 實際 HTTP 次數（含重試）。 */
type Meter = { finmind: number; official: number; httpAttempts: number; retries: number; cacheHits: number; timeouts: number };

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

function finmind<T>(meter: Meter, dataset: string, id: string, start: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T[]> {
  return cached(`${dataset}:${id}:${start}`, CACHE_TTL_MS, meter, () => withTimeout(timeoutMs, meter, async (signal) => {
    meter.finmind++;
    const token = Deno.env.get('FINMIND_TOKEN') || '';
    const url = `${FINMIND}?dataset=${dataset}&data_id=${encodeURIComponent(id)}&start_date=${start}`;
    const res = await fetchWithRetry(url, { ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}), signal }, {
      source: `finmind_${dataset}`, policy: { maxAttempts: 2 },
      onAttempt: (a) => { meter.httpAttempts++; if (a.attempt > 1) meter.retries++; },
    });
    const json = await res.json();
    if (json?.status !== 200 || !Array.isArray(json?.data)) throw new Error(`finmind ${dataset} ${id} status=${json?.status}`);
    return json.data as T[];
  }));
}

function officialList(meter: Meter, url: string, src: 'TWSE' | 'TPEx'): Promise<Array<Record<string, string>>> {
  return cached(`official:${src}`, OFFICIAL_TTL_MS, meter, () => withTimeout(OFFICIAL_TIMEOUT_MS, meter, async (signal) => {
    meter.official++;
    const res = await fetchWithRetry(url, { signal }, {
      source: `official_${src}`, policy: { maxAttempts: 2 },
      onAttempt: (a) => { meter.httpAttempts++; if (a.attempt > 1) meter.retries++; },
    });
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error(`${src} 公司基本資料格式錯誤`);
    return json as Array<Record<string, string>>;
  }));
}

type OfficialIndex = (symbol: string) => OfficialShares | null;
async function officialIndex(meter: Meter): Promise<OfficialIndex> {
  const [l, o] = await Promise.allSettled([officialList(meter, TWSE_URL, 'TWSE'), officialList(meter, TPEX_URL, 'TPEx')]);
  const map = new Map<string, OfficialShares | null>();
  if (o.status === 'fulfilled') for (const r of o.value) map.set(r['SecuritiesCompanyCode'], officialFromTpex(r));
  if (l.status === 'fulfilled') for (const r of l.value) map.set(r['公司代號'], officialFromTwse(r));
  return (symbol) => map.get(symbol) ?? null;
}

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

async function loadCompany(meter: Meter, symbol: string, finYears: number, priceDays: number, official: OfficialShares | null, timeoutMs = REQUEST_TIMEOUT_MS) {
  const start = isoDaysAgo(finYears * 365);
  const [fs, bs, px, sh] = await Promise.all([
    finmind<FinRow>(meter, 'TaiwanStockFinancialStatements', symbol, start, timeoutMs),
    finmind<FinRow>(meter, 'TaiwanStockBalanceSheet', symbol, start, timeoutMs),
    finmind<{ date: string; close: number }>(meter, 'TaiwanStockPrice', symbol, isoDaysAgo(priceDays), timeoutMs),
    official ? Promise.resolve([]) : finmind<{ date: string; NumberOfSharesIssued: number }>(meter, 'TaiwanStockShareholding', symbol, isoDaysAgo(14), timeoutMs).catch(() => []),
  ]);
  const prices: PriceRow[] = px.map((p) => ({ date: p.date, close: Number(p.close) }));
  const last = (sh as Array<{ date: string; NumberOfSharesIssued: number }>).at(-1);
  const resolved = official ?? officialFromIssuedShares(last ? Number(last.NumberOfSharesIssued) : null, latestOrdinaryShare(bs), last?.date ?? null);
  return { fs, bs, prices, official: resolved };
}

/** 官方名錄最多等 OFFICIAL_WAIT_MS；逾時回 null，背景續抓供下次命中。 */
async function officialIndexFast(meter: Meter, until?: Promise<unknown>): Promise<OfficialIndex | null> {
  const p = officialIndex(meter);
  // deno-lint-ignore no-explicit-any
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(p.catch(() => null)); } catch { /* ignore */ }
  // 只算目標時：目標財報一到（+200ms）就不再等名錄，改用已發行股數後備，避免每次固定多等 3 秒。
  const stop = until ? until.then(() => new Promise<null>((r) => setTimeout(() => r(null), 200)), () => null) : null;
  return await Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), OFFICIAL_WAIT_MS)), ...(stop ? [stop] : [])]);
}

// Isolate 冷啟動即背景暖抓官方名錄：請求進來時通常已在 inflight，3 秒等待窗內多數能命中；
// cached() 以 key 去重，請求內的 officialIndex() 會共用同一個 promise，不重複發 HTTP。
const warmMeter: Meter = { finmind: 0, official: 0, httpAttempts: 0, retries: 0, cacheHits: 0, timeouts: 0 };
try { void officialIndex(warmMeter).catch(() => null); } catch { /* ignore */ }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try { await requireCaller(req); } catch (e) {
    if (e instanceof AuthError) return errorResponse(e.message, e.status, { code: e.code }, req);
    throw e;
  }
  let symbol = '';
  let withPeers = true;
  try { const body = await req.json(); symbol = String(body?.symbol ?? '').trim(); withPeers = body?.peers !== false; } catch { /* fallthrough */ }
  if (!/^\d{4,6}$/.test(symbol)) return errorResponse('symbol 必須為 4–6 位台股代碼', 400, { code: 'BAD_SYMBOL' }, req);

  const started = Date.now();
  const meter: Meter = { finmind: 0, official: 0, httpAttempts: 0, retries: 0, cacheHits: 0, timeouts: 0 };
  const fetchedAt = new Date().toISOString();
  try {
    const supa = serviceClient();
    const { data: meta, error } = await supa.from('stock_industry_map').select('symbol,name,industries,market_groups').eq('symbol', symbol).maybeSingle();
    if (error) throw new Error(`industry_map: ${error.message}`);
    // 官方名錄優先讀 official_share_registry（cron 每日同步，毫秒級）；
    // 資料表為空才走 inline 抓取後備（官方站台需 30 秒以上，正常不應發生）。
    const t0 = Date.now();
    const timings = { industryMapMs: t0 - started, officialMs: 0, targetMs: 0, peersMs: 0 };
    const targetP = loadCompany(meter, symbol, TARGET_FIN_YEARS, 5 * 365, null, TARGET_TIMEOUT_MS).finally(() => { timings.targetMs = Date.now() - t0; });
    const registryP = supa.from('official_share_registry')
      .select('symbol,par,par_text,issued_shares,preferred_shares,paid_in_capital,source,report_date,fetched_at')
      .then(({ data, error: rErr }) => {
        if (rErr || !data?.length) return null;
        const map = new Map<string, OfficialShares>();
        for (const r of data) {
          map.set(r.symbol, {
            par: Number(r.par), parText: r.par_text ?? String(r.par), issuedShares: Number(r.issued_shares),
            preferredShares: Number(r.preferred_shares ?? 0), paidInCapital: r.paid_in_capital != null ? Number(r.paid_in_capital) : null,
            source: r.source as OfficialShares['source'], reportDate: r.report_date ?? '',
          });
        }
        return ((s: string) => map.get(s) ?? null) as OfficialIndex;
      })
      .catch(() => null);
    let idx = await registryP;
    let officialSource = 'registry';
    if (!idx) {
      idx = await officialIndexFast(meter, withPeers ? undefined : targetP);
      officialSource = idx ? 'live_fallback' : 'timeout_fallback';
    }
    timings.officialMs = Date.now() - t0;
    const targetRaw = await targetP;
    const official = (s: string) => (idx ? idx(s) : null);
    // 名錄兩路都失敗不得靜默：寫 system_jobs_log 供觀測（cron 失敗不靜默的同一原則）。
    if (!idx) {
      try {
        await serviceClient().from('system_jobs_log').insert({
          job_name: 'valuation-fundamentals-official-list',
          status: 'degraded',
          detail: { symbol, officialMs: timings.officialMs, note: '名錄資料表為空且 inline 抓取逾時，本次以 FinMind 已發行股數後備（特別股未核實）' },
          duration_ms: timings.officialMs,
        });
      } catch { /* 日誌失敗不阻斷主流程 */ }
    }
    // 官方名錄有資料時優先（含特別股）；否則用已發行股數後備。
    const target = { ...targetRaw, official: official(symbol) ?? targetRaw.official };
    const asOf = target.prices.map((p) => p.date).sort().at(-1) ?? null;
    if (!asOf) return jsonResponse({ ok: true, symbol, asOf: null, rows: [], reason: '近期無收盤價' }, {}, req);
    const targetBasis = computeCompanyBasis(symbol, target.fs, target.bs, asOf, { mode: 'live', official: target.official, fetchedAt });

    // 同業：核心業務（主分類）在對方業務中即入圍；題材不列條件。先依可比性排序、排除非上市櫃，再限流。
    const industries: string[] = meta?.industries ?? [];
    const core = industries[0];
    let audit: ReturnType<typeof auditPeers> = [];
    if (core && withPeers) {
      const { data: uni, error: uErr } = await supa.from('stock_industry_map').select('symbol,name,industries,market_groups').contains('industries', [core]).limit(300);
      if (uErr) throw new Error(`peer_universe: ${uErr.message}`);
      const ranked = rankPeerCandidates({ symbol, industries, market_groups: meta?.market_groups ?? [] }, (uni ?? []) as any, (s) => official(s)?.paidInCapital ?? null);
      // 名錄未取得時不預先排除；讀取時以已發行股數判定是否上市櫃（興櫃無資料 → 讀取後排除）。
      audit = auditPeers(ranked, (s) => !idx || official(s) != null, MAX_PEERS);
    }
    const tp = Date.now();
    const picked = audit.filter((a) => a.status === 'selected');
    const peerDeadline = Date.now() + PEER_BUDGET_MS;
    const settled = await mapLimit(picked, PEER_CONCURRENCY, async (c) => {
      if (Date.now() > peerDeadline) throw new Error('同業總預算 15 秒已用完');
      const d = await loadCompany(meter, c.symbol, 3, 10, official(c.symbol));
      return { symbol: c.symbol, name: c.name, basis: computeCompanyBasis(c.symbol, d.fs, d.bs, asOf, { mode: 'live', official: d.official, fetchedAt }), close: closeOn(d.prices, asOf) } as PeerInput;
    });
    const peers: PeerInput[] = [];
    settled.forEach((s, i) => {
      const a = picked[i];
      if (s.status === 'fulfilled') {
        peers.push(s.value);
        const b = s.value.basis;
        a.detail = b.ok ? `${a.detail}；已讀取，分母 PE/PB/PS ${(['pe', 'pb', 'ps'] as const).map((k) => (b.notApplicable[k] ? '×' : '✓')).join('/')}` : `${a.detail}；讀取後排除：${b.reason}`;
      } else {
        a.detail = `${a.detail}；未列入：${(s.reason as Error)?.message || '逾時或讀取失敗'}`;
      }
    });
    timings.peersMs = withPeers ? Date.now() - tp : 0;
    const peerRule = !withPeers ? '同業延後載入中（本次只算目標公司）' : `核心業務「${core ?? '無'}」同業（主業相同優先，題材不列條件；先排序再取前 ${MAX_PEERS} 家）`
      + `；候選 ${audit.length} 家：` + audit.map((a) => `${a.name}${a.symbol}（${a.detail}）`).join('；');
    const history = monthlyHistory(symbol, target.fs, target.bs, target.prices, asOf, target.official);
    const rows = buildScenarioRows(targetBasis, peers, peerRule, history);
    return jsonResponse({
      ok: true, version: VERSION, symbol, name: meta?.name ?? null, asOf, fetchedAt,
      close: closeOn(target.prices, asOf), official: target.official, basis: targetBasis, peerRule, peerAudit: audit, rows,
      peersIncluded: withPeers,
      meta: { officialList: idx ? officialSource : 'timeout_fallback', timings, requests: meter, elapsedMs: Date.now() - started, isolateCache: 'per-isolate, 不保證跨冷啟動' },
    }, {}, req);
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : String(e), 502, { code: 'UPSTREAM_FAILED' }, req);
  }
});
