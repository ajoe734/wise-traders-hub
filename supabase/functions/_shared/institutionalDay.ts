// deno-lint-ignore-file no-explicit-any
/**
 * institutionalDay — 「某一交易日全市場三大法人」的單一資料源（F4）。
 *
 * 為什麼存在：T86 解析與抓取原本在 `tw-institutional-daily-sync` 內重複三次，
 * 而 `checkup-institutional` 又自己裸 fetch 一份且沒有 FinMind 備援，導致同一份資料
 * 在不同路徑上可靠度不同。這裡把「解析 + 雙軌抓取」收斂成兩個函式。
 *
 * L1 TWSE T86（rwd/zh/fund/T86）
 * L2 FinMind TaiwanStockInstitutionalInvestorsBuySell（不帶 data_id = 全市場當日）
 */
import { fetchWithRetry, isRetryExhausted, recordRetryFailure } from './retryFetch.ts';

export interface InstDayRow {
  stock_id: string;
  trade_date: string;
  foreign_net: number;
  trust_net: number;
  dealer_net: number;
  total_net: number;
}

export type InstDaySource = 'twse_t86' | 'finmind_institutional';

export interface InstDayResult {
  rows: InstDayRow[];
  source: InstDaySource | null;
  /** T86 原樣資料，供既有呼叫端沿用（FinMind 路徑為 null）。 */
  raw: any | null;
  fields: string[];
  attempts: Array<{ source: string; ok: boolean; rows: number; reason?: string }>;
}

interface MinimalSupa { from: (t: string) => any }

export interface InstDayDeps {
  fetchImpl?: typeof fetch;
  supa?: MinimalSupa | null;
  finmindToken?: string;
  sleep?: (ms: number) => Promise<void>;
  /** 測試用：覆寫熔斷寫入。 */
  recordHealth?: (source: string, ok: boolean, latencyMs: number, code?: string) => Promise<void>;
}

export function parseNum(v: unknown): number {
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

/** YYYYMMDD → YYYY-MM-DD */
export function toIsoDate(ymd: string): string {
  const s = String(ymd);
  return s.includes('-') ? s : `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export class SchemaDriftError extends Error {
  code = 'SCHEMA_DRIFT';
  constructor(public fields: string[]) {
    super('T86 fields layout unrecognized');
    this.name = 'SchemaDriftError';
  }
}

/**
 * T86 raw JSON → 正規化列。欄位名稱以關鍵字動態定位（TWSE 偶爾改名）。
 * 純函式：schema 不認得就丟 SchemaDriftError，呼叫端可據此走備援。
 */
export function parseT86(raw: any, isoDate: string): InstDayRow[] {
  const fields: string[] = raw?.fields || [];
  const rows: any[][] = raw?.data || [];
  const idxOf = (kw: string) => fields.findIndex((f: string) => f && f.includes(kw));
  const iStock = idxOf('證券代號');
  // 外資 = 外陸資買賣超（不含外資自營商） + 外資自營商買賣超
  const iForeignMain = idxOf('外陸資買賣超股數');
  const iForeignDealer = idxOf('外資自營商買賣超股數');
  const iTrust = idxOf('投信買賣超');
  // 自營商合計欄位（不含「自行買賣」「避險」細分）
  const iDealer = fields.findIndex((f: string) => f === '自營商買賣超股數');
  const iDealerSelf = idxOf('自營商買賣超股數(自行買賣)');
  const iDealerHedge = idxOf('自營商買賣超股數(避險)');
  const iTotal = idxOf('三大法人買賣超');

  if (iStock < 0 || iForeignMain < 0 || iTrust < 0 || (iDealer < 0 && iDealerSelf < 0)) {
    throw new SchemaDriftError(fields);
  }

  return rows.map((r) => {
    const stock_id = String(r[iStock] || '').trim();
    const foreign_net = parseNum(r[iForeignMain]) + (iForeignDealer >= 0 ? parseNum(r[iForeignDealer]) : 0);
    const trust_net = parseNum(r[iTrust]);
    const dealer_net = iDealer >= 0
      ? parseNum(r[iDealer])
      : parseNum(r[iDealerSelf]) + (iDealerHedge >= 0 ? parseNum(r[iDealerHedge]) : 0);
    const total_net = iTotal >= 0 ? parseNum(r[iTotal]) : foreign_net + trust_net + dealer_net;
    return { stock_id, trade_date: isoDate, foreign_net, trust_net, dealer_net, total_net };
  }).filter((r) => !!r.stock_id);
}

/** FinMind 全市場當日列（每檔每類型一列）→ 正規化列。 */
export function aggregateFinmindMarketDay(raw: any[], isoDate: string): InstDayRow[] {
  const byStock = new Map<string, { f: number; t: number; d: number }>();
  for (const r of raw ?? []) {
    const stockId = String(r?.stock_id ?? '').trim();
    if (!stockId) continue;
    const name = String(r?.name ?? '');
    const net = Number(r?.buy || 0) - Number(r?.sell || 0);
    const cur = byStock.get(stockId) ?? { f: 0, t: 0, d: 0 };
    if (name.startsWith('Foreign_Investor') || name === 'Foreign_Dealer_Self') cur.f += net;
    else if (name === 'Investment_Trust') cur.t += net;
    else if (name.startsWith('Dealer')) cur.d += net;
    byStock.set(stockId, cur);
  }
  return Array.from(byStock.entries()).map(([stock_id, v]) => ({
    stock_id,
    trade_date: isoDate,
    foreign_net: v.f,
    trust_net: v.t,
    dealer_net: v.d,
    total_net: v.f + v.t + v.d,
  }));
}

async function health(deps: InstDayDeps, source: string, ok: boolean, latencyMs: number, code?: string) {
  if (deps.recordHealth) {
    try { await deps.recordHealth(source, ok, latencyMs, code); } catch { /* 非致命 */ }
    return;
  }
  if (!deps.supa) return;
  try {
    const { recordCircuit } = await import('./circuitBreaker.ts');
    await recordCircuit(deps.supa as any, source, ok, latencyMs, code);
  } catch { /* 非致命 */ }
}

/** L1：TWSE T86 原樣 JSON。失敗回 null（已記錄熔斷）。 */
export async function fetchT86Raw(dateYmd: string, deps: InstDayDeps = {}): Promise<any | null> {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${dateYmd}&selectType=ALL&response=json`;
  const t0 = Date.now();
  try {
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LegendflowBot/1.0)', Accept: 'application/json' },
    }, {
      source: 'twse_t86',
      policy: { maxAttempts: 3, baseDelayMs: 800, timeoutMs: 15_000 },
      fetchImpl: deps.fetchImpl,
      sleep: deps.sleep,
    });
    if (!res.ok) {
      await res.text().catch(() => '');
      await health(deps, 'twse_t86', false, Date.now() - t0, `http_${res.status}`);
      return null;
    }
    const json = await res.json();
    await health(deps, 'twse_t86', true, Date.now() - t0);
    return json;
  } catch (e) {
    if (isRetryExhausted(e) && deps.supa) {
      await recordRetryFailure(deps.supa as any, e as any, {
        fn: 'institutionalDay',
        healthSource: 'twse_t86',
        extra: { trade_date: dateYmd },
      });
    } else {
      await health(deps, 'twse_t86', false, Date.now() - t0, 'FETCH_ERROR');
    }
    return null;
  }
}

/** L2：FinMind 全市場當日。失敗回 null（已記錄熔斷）。 */
export async function fetchFinmindDay(isoDate: string, deps: InstDayDeps = {}): Promise<InstDayRow[] | null> {
  const token = deps.finmindToken ?? (globalThis as any).Deno?.env?.get?.('FINMIND_TOKEN') ?? '';
  const p = new URLSearchParams({
    dataset: 'TaiwanStockInstitutionalInvestorsBuySell',
    start_date: isoDate,
    end_date: isoDate,
  });
  if (token) p.set('token', String(token));
  const t0 = Date.now();
  try {
    const res = await fetchWithRetry(`https://api.finmindtrade.com/api/v4/data?${p}`, {
      headers: { Accept: 'application/json' },
    }, {
      source: 'finmind_institutional',
      policy: { maxAttempts: 3, baseDelayMs: 1000, timeoutMs: 25_000 },
      fetchImpl: deps.fetchImpl,
      sleep: deps.sleep,
    });
    if (!res.ok) {
      await res.text().catch(() => '');
      await health(deps, 'finmind_institutional', false, Date.now() - t0, `http_${res.status}`);
      return null;
    }
    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    const out = aggregateFinmindMarketDay(rows, isoDate);
    await health(deps, 'finmind_institutional', out.length > 0, Date.now() - t0, out.length ? undefined : 'no_data');
    return out;
  } catch (e) {
    if (isRetryExhausted(e) && deps.supa) {
      await recordRetryFailure(deps.supa as any, e as any, {
        fn: 'institutionalDay',
        healthSource: 'finmind_institutional',
        extra: { trade_date: isoDate },
      });
    } else {
      await health(deps, 'finmind_institutional', false, Date.now() - t0, 'FETCH_ERROR');
    }
    return null;
  }
}

/**
 * 雙軌取單日全市場三大法人：TWSE T86 → FinMind。
 * 契約：不會 throw；`source === null` 代表兩軌都沒資料。
 * FinMind 層需帶 supa 或 finmindToken（避免繞過全域配額治理）。
 */
export async function fetchInstitutionalDay(dateYmd: string, deps: InstDayDeps = {}): Promise<InstDayResult> {
  const iso = toIsoDate(dateYmd);
  const attempts: InstDayResult['attempts'] = [];

  const raw = await fetchT86Raw(String(dateYmd).replace(/-/g, ''), deps);
  if (raw) {
    try {
      const rows = parseT86(raw, iso);
      attempts.push({
        source: 'twse_t86',
        ok: rows.length > 0,
        rows: rows.length,
        reason: rows.length ? undefined : (raw?.stat || 'no_data'),
      });
      if (rows.length > 0) return { rows, source: 'twse_t86', raw, fields: raw?.fields || [], attempts };
    } catch (e) {
      attempts.push({ source: 'twse_t86', ok: false, rows: 0, reason: (e as SchemaDriftError).code ?? 'parse_error' });
    }
  } else {
    attempts.push({ source: 'twse_t86', ok: false, rows: 0, reason: 'fetch_failed' });
  }

  if (!deps.supa && !deps.finmindToken) {
    return { rows: [], source: null, raw: null, fields: [], attempts };
  }

  const fm = await fetchFinmindDay(iso, deps);
  attempts.push({
    source: 'finmind_institutional',
    ok: !!fm?.length,
    rows: fm?.length ?? 0,
    reason: fm?.length ? undefined : 'no_data',
  });
  if (fm && fm.length > 0) return { rows: fm, source: 'finmind_institutional', raw: null, fields: [], attempts };

  return { rows: [], source: null, raw: null, fields: [], attempts };
}
