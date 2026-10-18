/**
 * valuation-fundamentals（版本見 VERSION；回應帶 version）。
 * 只讀資料庫：財報 valuation_filing_versions、股價 tw_price_history、月營收 tw_month_revenue、股數 official_share_registry。
 * 請求中不打 FinMind／證交所／櫃買；缺資料回 DATA_PENDING 並登記 market_data_requests，
 * 由 market-data-sync（股價、月營收）與 valuation-ps-sync（財報）排程補。
 * 一般登入者可呼叫（範例持股免登入）；除回補登記外不寫資料表。
 */
// AUTH: user
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { requireCaller, AuthError } from '../_shared/authGuard.ts';
import { revenue3mYoY, nextQuarterBasis } from '../_shared/monthRevenue.ts';
import { DEMO_FUNDAMENTALS_SYMBOLS } from '../_shared/demoFundamentalsSymbols.ts';
import { taipeiDate, completeFinancialPeriods } from '../_shared/filingRefreshCore.ts';
import { readMonthRevenue, readPriceHistory, requestSymbols } from '../_shared/marketDataStore.ts';
import {
  auditPeers, buildScenarioRows, closeOn, computeCompanyBasis, dailyPsSeries, mapLimit, monthlyHistory,
  rankPeerCandidates, type FinRow, type OfficialShares, type PeerInput, type PriceRow,
} from '../_shared/fundamentalsBasis.ts';

const MAX_PEERS = 6;
/** 目標財報取 7 年：前 4 季需再往前 4 季才能算近四季營收年增。 */
const TARGET_FIN_YEARS = 7;
const PEER_CONCURRENCY = 3;
export const VERSION = 'valuation-fundamentals@2026-10-19.1-db-only';

type Meter = { dbReads: number; missing: string[] };
type OfficialIndex = (symbol: string) => OfficialShares | null;
const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

async function loadCompany(meter: Meter, symbol: string, finYears: number, priceDays: number, official: OfficialShares | null) {
  const db = serviceClient();
  meter.dbReads += 2;
  const [{ data: committed, error: versionError }, px] = await Promise.all([
    db.from('valuation_filing_versions').select('statements,balance_sheet,version,latest_period,expected_period,state,reason,fetched_at').eq('symbol', symbol).maybeSingle(),
    readPriceHistory(db, symbol, isoDaysAgo(priceDays)),
  ]);
  if (versionError) throw new Error(`filing_version: ${versionError.message}`);
  const cutoff = isoDaysAgo(finYears * 365);
  const fs = (Array.isArray(committed?.statements) ? committed.statements as FinRow[] : []).filter((r) => r.date >= cutoff);
  const bs = (Array.isArray(committed?.balance_sheet) ? committed.balance_sheet as FinRow[] : []).filter((r) => r.date >= cutoff);
  const hasFilings = fs.length > 0 && bs.length > 0;
  const hasPrices = px.length > 0;
  if (!hasFilings) meter.missing.push(`${symbol}:財報`);
  if (!hasPrices) meter.missing.push(`${symbol}:日線`);
  const prices: PriceRow[] = px.map((p) => ({ date: p.date, close: p.close }));
  const periods = new Set(completeFinancialPeriods(fs, bs));
  return {
    fs: fs.filter((r) => periods.has(r.date)), bs: bs.filter((r) => periods.has(r.date)), prices, official, hasFilings, hasPrices,
    filing: committed ? { version: committed.version, latestPeriod: committed.latest_period, expectedPeriod: committed.expected_period, state: committed.state, reason: committed.reason, fetchedAt: committed.fetched_at } : null,
  };
}

async function readRegistry(supa: ReturnType<typeof serviceClient>): Promise<OfficialIndex | null> {
  const map = new Map<string, OfficialShares>();
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supa.from('official_share_registry')
      .select('symbol,par,par_text,issued_shares,preferred_shares,paid_in_capital,source,report_date').order('symbol').range(off, off + 999);
    if (error) return null;
    for (const r of data ?? []) {
      map.set(r.symbol, {
        par: Number(r.par), parText: r.par_text ?? String(r.par), issuedShares: Number(r.issued_shares),
        preferredShares: Number(r.preferred_shares ?? 0), paidInCapital: r.paid_in_capital != null ? Number(r.paid_in_capital) : null,
        source: r.source as OfficialShares['source'], reportDate: r.report_date ?? '',
      });
    }
    if ((data ?? []).length < 1000) break;
  }
  return map.size ? (s) => map.get(s) ?? null : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let symbol = '';
  let withPeers = true;
  try { const body = await req.json(); symbol = String(body?.symbol ?? '').trim(); withPeers = body?.peers !== false; } catch { /* fallthrough */ }
  if (!DEMO_FUNDAMENTALS_SYMBOLS.includes(symbol)) {
    try { await requireCaller(req); } catch (e) {
      if (e instanceof AuthError) return errorResponse(e.message, e.status, { code: e.code }, req);
      throw e;
    }
  }
  if (!/^\d{4,6}$/.test(symbol)) return errorResponse('symbol 必須為 4–6 位台股代碼', 400, { code: 'BAD_SYMBOL' }, req);

  const started = Date.now();
  const meter: Meter = { dbReads: 0, missing: [] };
  const fetchedAt = new Date().toISOString();
  try {
    const supa = serviceClient();
    const { data: meta, error } = await supa.from('stock_industry_map').select('symbol,name,industries,market_groups').eq('symbol', symbol).maybeSingle();
    if (error) throw new Error(`industry_map: ${error.message}`);
    const t0 = Date.now();
    const timings = { industryMapMs: t0 - started, officialMs: 0, targetMs: 0, peersMs: 0 };
    const targetP = loadCompany(meter, symbol, TARGET_FIN_YEARS, 5 * 365, null).finally(() => { timings.targetMs = Date.now() - t0; });
    const idx = await readRegistry(supa);
    timings.officialMs = Date.now() - t0;
    const monthRevP = readMonthRevenue(supa, symbol, Number(taipeiDate().slice(0, 4)) - 2).catch(() => []);
    const official = (s: string) => (idx ? idx(s) : null);
    const targetRaw = await targetP;
    const target = { ...targetRaw, official: official(symbol) };

    if (!target.hasPrices || !target.hasFilings || !target.official) {
      await requestSymbols(supa, [symbol]);
      const missing = [!target.hasFilings && '財報', !target.hasPrices && '歷史股價', !target.official && '官方股數'].filter(Boolean).join('、');
      return jsonResponse({
        ok: false, version: VERSION, symbol, asOf: null, rows: [], code: 'DATA_PENDING',
        reason: `資料準備中：資料庫尚無${missing}，已排入排程回補`, filing: target.filing,
        meta: { source: 'database-only', requests: { external: 0, ...meter } },
      }, {}, req);
    }
    const asOf = target.prices.map((p) => p.date).sort().at(-1) ?? null;
    if (!asOf) return jsonResponse({ ok: true, symbol, asOf: null, rows: [], reason: '近期無收盤價' }, {}, req);
    const targetBasis = computeCompanyBasis(symbol, target.fs, target.bs, asOf, { mode: 'live', official: target.official, fetchedAt });

    const industries: string[] = meta?.industries ?? [];
    const core = industries[0];
    let audit: ReturnType<typeof auditPeers> = [];
    if (core && withPeers) {
      const { data: uni, error: uErr } = await supa.from('stock_industry_map').select('symbol,name,industries,market_groups').contains('industries', [core]).limit(300);
      if (uErr) throw new Error(`peer_universe: ${uErr.message}`);
      const ranked = rankPeerCandidates({ symbol, industries, market_groups: meta?.market_groups ?? [] }, (uni ?? []) as any, (s) => official(s)?.paidInCapital ?? null);
      audit = auditPeers(ranked, (s) => !idx || official(s) != null, MAX_PEERS);
    }
    const tp = Date.now();
    const picked = audit.filter((a) => a.status === 'selected');
    const settled = await mapLimit(picked, PEER_CONCURRENCY, async (c) => {
      const d = await loadCompany(meter, c.symbol, 3, 20, official(c.symbol));
      if (!d.hasFilings || !d.hasPrices) throw new Error('資料庫尚無財報或股價，已排入回補');
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
        a.detail = `${a.detail}；未列入：${(s.reason as Error)?.message || '讀取失敗'}`;
      }
    });
    timings.peersMs = withPeers ? Date.now() - tp : 0;
    const missingPeers = meter.missing.map((m) => m.split(':')[0]).filter((s) => s !== symbol);
    if (missingPeers.length) await requestSymbols(supa, missingPeers);
    const peerRule = !withPeers ? '同業延後載入中（本次只算目標公司）' : `核心業務「${core ?? '無'}」同業（主業相同優先，題材不列條件；先排序再取前 ${MAX_PEERS} 家）`
      + `；候選 ${audit.length} 家：` + audit.map((a) => `${a.name}${a.symbol}（${a.detail}）`).join('；');
    const history = monthlyHistory(symbol, target.fs, target.bs, target.prices, asOf, target.official);
    const rows = buildScenarioRows(targetBasis, peers, peerRule, history);
    const psDaily = dailyPsSeries(symbol, target.fs, target.bs, target.prices, asOf, target.official);
    const monthRows = await monthRevP;
    const monthRevenue = revenue3mYoY(monthRows);
    const pendingPeriod = target.filing?.expectedPeriod;
    const actualLatest = target.fs.map((r) => r.date).sort().at(-1) ?? '';
    const pendingNew = !!pendingPeriod && pendingPeriod > actualLatest;
    const nextQuarter = pendingNew ? { stale: true, quarter: `${pendingPeriod.slice(0,4)}Q${Math.ceil(Number(pendingPeriod.slice(5,7))/3)}`,
      deadline: '', asOf: taipeiDate(), reason: `${pendingPeriod} 新季財報已出現在官方索引，完整資料尚未取得，停用同季推估（資料不足）` }
      : nextQuarterBasis(targetBasis, monthRows, taipeiDate());
    return jsonResponse({
      ok: true, version: VERSION, symbol, name: meta?.name ?? null, asOf, fetchedAt,
      close: closeOn(target.prices, asOf), official: target.official, basis: targetBasis, peerRule, peerAudit: audit, rows,
      psDaily, monthRevenue, nextQuarter, filing: target.filing, peersIncluded: withPeers,
      meta: { source: 'database-only', officialList: idx ? 'registry' : 'missing', timings, requests: { external: 0, ...meter }, elapsedMs: Date.now() - started },
    }, {}, req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorResponse(msg, 500, { code: 'DB_READ_FAILED' }, req);
  }
});
