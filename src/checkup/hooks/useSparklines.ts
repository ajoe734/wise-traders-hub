/**
 * useSparklines — 持倉 30D 走勢帶的唯一取數／快取入口（候選 B）。
 *
 * 為什麼存在：原本這段散在 FreeCheckup.jsx 的一個 useEffect + 兩個 useState，
 * 只活在元件生命週期裡：換頁、重整、關掉抽屜都會整批重抓，而失敗代號的記憶
 * 也隨元件卸載消失，於是同一批代號一天可以打好幾十次 edge function。
 *
 * 現在：
 *   - 命中／未命中由 `checkupCacheStore` 決定（記憶體 + localStorage，12 小時 TTL），
 *     跨頁面、跨重整都有效。
 *   - 失敗代號另存短 TTL（30 分鐘）負快取，避免壞代號無限重試造成 UI 抖動。
 *   - 對外握手走 Checkup Gateway seam（ADR-0004），元件層不直連 supabase。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCheckupGateway } from '@/checkup/lib/gateway';
import { createCacheNamespace } from '@/checkup/lib/checkupCacheStore';
import { sparklineCacheKey, sparklineCacheKeyForTradeDate } from '@/checkup/lib/marketDataStatus';
import { isTaiwanStockCode, normalizeStockCode } from '@/checkup/lib/chipsRepository';
import { runSparklineTask, type SparklineTaskEntry } from '@/checkup/lib/sparklineFetchTask';
import { useExpectedTradeDate } from '@/checkup/hooks/useExpectedTradeDate';

export interface SparklineEntry {
  ohlc?: Array<{
    date?: string; open?: number; high?: number; low?: number; close?: number;
    /** 成交量，單位「股」；上游缺量為 null */
    volume?: number | null;
  }>;
  closes?: number[];
  /** 上游來源（TWSE / TPEX / FINMIND） */
  source?: string | null;
  /** 這批日 K 的抓取時間（ISO） */
  fetchedAt?: string | null;
  /** 最後一根日 K 的交易日 */
  tradeDate?: string | null;
  /** 歷史是否完整（>= 20 根）。partial 只進短 TTL 快取。 */
  complete?: boolean;
  barCount?: number;
}

export type SparklineMap = Record<string, SparklineEntry>;

/** 走勢資料每天只變一次，12 小時 TTL 足夠，且跨重整保留。 */
export const SPARKLINE_TTL_MS = 12 * 60 * 60 * 1000;
/** 失敗代號的負快取（半小時後可再試一次）。 */
export const SPARKLINE_FAIL_TTL_MS = 30 * 60 * 1000;
/** partial（歷史不完整）結果的短 TTL，避免「兩根 K 棒」被當成一天的正解。 */
export const SPARKLINE_PARTIAL_TTL_MS = 30 * 60 * 1000;
/** 低於這個根數視為 partial（與 edge 的 MIN_COMPLETE_BARS 對齊）。 */
export const SPARKLINE_MIN_COMPLETE_BARS = 20;
/** 單次 edge 請求最多帶幾檔。 */
export const SPARKLINE_BATCH_SIZE = 30;
/** localStorage schema；同時是一次性 migration 與測試可觀察的版本。 */
export const SPARKLINE_CACHE_VERSION = 6;
export const SPARKLINE_CACHE_STORAGE_KEY = `lf.checkup.cache.sparkline.v${SPARKLINE_CACHE_VERSION}`;
export const SPARKLINE_PARTIAL_STORAGE_KEY = 'lf.checkup.cache.sparkline-partial.v2';
export const SPARKLINE_MIGRATION_KEY = `lf.checkup.sparkline-migrated.v${SPARKLINE_CACHE_VERSION}`;

/** 淘汰舊版長效／partial 日 K；React Query persisted 白名單不含 sparkline。 */
export function migrateSparklineCacheStorage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'length' | 'key'> | null =
  typeof localStorage !== 'undefined' ? localStorage : null): boolean {
  if (!storage || storage.getItem(SPARKLINE_MIGRATION_KEY) === '1') return false;
  const staleKeys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key) continue;
    if (/^lf\.checkup\.cache\.sparkline(?:-partial|-fail)?\.v\d+$/.test(key)
      && key !== SPARKLINE_CACHE_STORAGE_KEY
      && key !== SPARKLINE_PARTIAL_STORAGE_KEY) staleKeys.push(key);
  }
  staleKeys.forEach((key) => storage.removeItem(key));
  storage.setItem(SPARKLINE_MIGRATION_KEY, '1');
  return staleKeys.length > 0;
}

migrateSparklineCacheStorage();

export const sparklineCache = createCacheNamespace<SparklineEntry>({
  name: 'sparkline',
  ttlMs: SPARKLINE_TTL_MS,
  // v6：一次性清除 v2–v5 與舊 partial，且完整回應會原子取代 partial。
  version: SPARKLINE_CACHE_VERSION,
  maxEntries: 300,
});

/** partial 結果的短 TTL 快取：仍可先畫出來，但 30 分鐘後會重新回補。 */
export const sparklinePartialCache = createCacheNamespace<SparklineEntry>({
  name: 'sparkline-partial',
  ttlMs: SPARKLINE_PARTIAL_TTL_MS,
  version: 2,
  maxEntries: 300,
});

/** 判定一批 bar 是否算完整歷史。 */
export function isCompleteSparkline(entry: SparklineEntry | null | undefined): boolean {
  if (!entry) return false;
  const n = entry.ohlc?.length ?? entry.closes?.length ?? 0;
  return entry.complete === true && n >= SPARKLINE_MIN_COMPLETE_BARS;
}

export function hasSparklineDrift(entry: SparklineEntry | null | undefined, price: unknown): boolean {
  const p = Number(price);
  const bars = entry?.ohlc;
  const last = Array.isArray(bars) && bars.length
    ? Number(bars[bars.length - 1]?.close)
    : Number(entry?.closes?.at(-1));
  return Number.isFinite(p) && p > 0 && Number.isFinite(last) && last > 0
    ? Math.abs(p - last) / last > 0.03
    : false;
}

export const sparklineFailCache = createCacheNamespace<true>({
  name: 'sparkline-fail',
  ttlMs: SPARKLINE_FAIL_TTL_MS,
  version: 1,
  maxEntries: 300,
});

function normalizeCodes(codes: unknown): string[] {
  if (!Array.isArray(codes)) return [];
  const out: string[] = [];
  for (const c of codes) {
    const code = String(c ?? '').trim();
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/**
 * 決定「這批代號還缺哪些」：快取有效的不抓，最近失敗過的也不抓。
 * 純函式，可單獨測試。
 */
export function planSparklineFetch(codes: string[], pricesByCode: Record<string, unknown> = {}): string[] {
  const wanted = normalizeCodes(codes);
  return wanted
    .filter((c) => {
      const key = sparklineCacheKey(c);
      const cached = sparklineCache.get(key);
      const invalid = !isCompleteSparkline(cached) || hasSparklineDrift(cached, pricesByCode[c]);
      if (invalid && cached) sparklineCache.delete(key);
      // partial 僅供失敗 fallback，不得阻擋每個 mount 的第一輪回補。
      return invalid;
    })
    .slice(0, SPARKLINE_BATCH_SIZE);
}

/** 走勢回應寫入快取（good / partial / fail）。module-owned，與 React 生命週期無關。 */
export function commitSparklineResult(
  entries: SparklineTaskEntry[],
  data: { result?: SparklineMap } | null,
): void {
  const result = data?.result;
  if (!result) {
    // 整批失敗 → 全數進負快取，避免下次立刻又重試
    sparklineFailCache.setMany(
      Object.fromEntries(entries.map((e) => [e.key, true as const])),
    );
    return;
  }
  const good: SparklineMap = {};
  const partial: SparklineMap = {};
  const bad: Record<string, true> = {};
  for (const { code, key } of entries) {
    const entry = result[code];
    if (!entry) { bad[key] = true; continue; }
    if (isCompleteSparkline(entry)) good[key] = entry;
    else partial[key] = entry;
  }
  if (Object.keys(good).length) {
    sparklineCache.setMany(good);
    Object.keys(good).forEach((key) => {
      sparklinePartialCache.delete(key);
      sparklineFailCache.delete(key);
    });
  }
  if (Object.keys(partial).length) {
    Object.entries(partial).forEach(([key, entry]) => {
      if (!sparklineCache.get(key)) sparklinePartialCache.set(key, entry);
    });
  }
  if (Object.keys(bad).length) sparklineFailCache.setMany(bad);
}

function invokeSparkline(codes: string[]) {
  return getCheckupGateway()
    .invoke<{ result?: SparklineMap }>('checkup-sparkline', { codes })
    .catch(() => null);
}

const sparklineTaskDeps = { invoke: invokeSparkline, commit: commitSparklineResult };

/** TW subset（明確台股代號）；US / unknown 一律不進 TW boundary 路徑。 */
export function twSubsetOf(codes: string[]): string[] {
  const out: string[] = [];
  for (const c of codes) {
    const norm = normalizeStockCode(c);
    if (norm && isTaiwanStockCode(norm) && !out.includes(norm)) out.push(norm);
  }
  return out.sort();
}

export function useSparklines(codes: string[] | null | undefined, opts?: {
  enabled?: boolean;
  pricesByCode?: Record<string, unknown>;
}) {
  const enabled = opts?.enabled !== false;
  const [version, setVersion] = useState(0);
  const attemptedRef = useRef(new Set<string>());
  const codesKey = normalizeCodes(codes).sort().join(',');
  const pricesByCode = opts?.pricesByCode ?? {};
  const pricesKey = normalizeCodes(codes).sort().map((c) => `${c}:${Number(pricesByCode[c]) || ''}`).join(',');
  const pricesRef = useRef(pricesByCode);
  pricesRef.current = pricesByCode;

  const expected = useExpectedTradeDate();
  const twCodesKey = twSubsetOf(normalizeCodes(codes)).join(',');

  const bumpVersion = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const unsubA = sparklineCache.subscribe(bumpVersion);
    const unsubB = sparklineFailCache.subscribe(bumpVersion);
    const unsubC = sparklinePartialCache.subscribe(bumpVersion);
    return () => {
      unsubA();
      unsubB();
      unsubC();
    };
  }, [bumpVersion]);

  // ── legacy effect：維持既有 deps / candidate / attempt key / 單一 mixed body ──
  useEffect(() => {
    if (!enabled) return;
    const wanted = codesKey ? codesKey.split(',') : [];
    if (!wanted.length) return;
    const missing = planSparklineFetch(wanted, pricesRef.current)
      .filter((code) => !attemptedRef.current.has(`${code}:${sparklineCacheKey(code)}`));
    if (!missing.length) return;
    const entries = missing.map((code) => ({ code, key: sparklineCacheKey(code) }));
    entries.forEach((e) => attemptedRef.current.add(`${e.code}:${e.key}`));
    void runSparklineTask(entries, sparklineTaskDeps);
  }, [codesKey, enabled, pricesKey]);

  // ── TW boundary effect：只在 expected trade date（或 TW code set）改變時重開 attempt ──
  useEffect(() => {
    if (!enabled) return;
    if (!expected.calendarReady || !expected.expectedTradeDate) return; // fail-closed
    const wanted = twCodesKey ? twCodesKey.split(',') : [];
    if (!wanted.length) return;
    const entries: SparklineTaskEntry[] = [];
    for (const code of wanted) {
      const key = sparklineCacheKeyForTradeDate(code, expected.expectedTradeDate);
      if (attemptedRef.current.has(`${code}:${key}`)) continue;
      const cached = sparklineCache.get(key);
      if (isCompleteSparkline(cached) && !hasSparklineDrift(cached, pricesRef.current[code])) continue;
      if (sparklineFailCache.get(key)) continue;
      entries.push({ code, key });
      if (entries.length >= SPARKLINE_BATCH_SIZE) break;
    }
    if (!entries.length) return;
    entries.forEach((e) => attemptedRef.current.add(`${e.code}:${e.key}`));
    void runSparklineTask(entries, sparklineTaskDeps);
    // 只依賴 expected 與 TW code set：qty / current price 變動不得重打
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, expected.calendarReady, expected.expectedTradeDate, twCodesKey]);

  const wanted = codesKey ? codesKey.split(',') : [];
  const sparklines: SparklineMap = {};
  const sparklineErrors: Record<string, boolean> = {};
  for (const code of wanted) {
    const key = sparklineCacheKey(code);
    const entry = sparklineCache.getEntry(key) ?? sparklinePartialCache.getEntry(key);
    if (entry) sparklines[code] = entry.value;
    if (sparklineFailCache.get(key)) sparklineErrors[code] = true;
  }
  // version 只用來在快取變動時觸發重繪
  void version;

  return { sparklines, sparklineErrors };
}

/** 候選 D/F：hover 時預載單股 30D 走勢。已存在或快取中則不發請求。 */
export async function prefetchSparkline(code: string): Promise<void> {
  if (!code || !/^\d{4,6}[A-Z]?$/i.test(code)) return;
  const key = sparklineCacheKey(code);
  if (sparklineCache.get(key) || sparklinePartialCache.get(key) || sparklineFailCache.get(key)) return;
  // 與 batch 共用同一組 reservation：命中即 await 同一顆 task，不會有第二次 invoke
  await runSparklineTask([{ code, key }], sparklineTaskDeps);
}

export default useSparklines;

