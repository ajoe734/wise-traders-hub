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
import { sparklineCacheKey } from '@/checkup/lib/marketDataStatus';

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

export const sparklineCache = createCacheNamespace<SparklineEntry>({
  name: 'sparkline',
  ttlMs: SPARKLINE_TTL_MS,
  // v5：只存 complete 結果；partial 改走 sparklinePartialCache（短 TTL）。
  // 升版同時讓舊的「2 根 K 棒」長效快取整批失效。
  version: 5,
  maxEntries: 300,
});

/** partial 結果的短 TTL 快取：仍可先畫出來，但 30 分鐘後會重新回補。 */
export const sparklinePartialCache = createCacheNamespace<SparklineEntry>({
  name: 'sparkline-partial',
  ttlMs: SPARKLINE_PARTIAL_TTL_MS,
  version: 1,
  maxEntries: 300,
});

/** 判定一批 bar 是否算完整歷史。 */
export function isCompleteSparkline(entry: SparklineEntry | null | undefined): boolean {
  if (!entry) return false;
  if (typeof entry.complete === 'boolean') return entry.complete;
  const n = entry.ohlc?.length ?? entry.closes?.length ?? 0;
  return n >= SPARKLINE_MIN_COMPLETE_BARS;
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
export function planSparklineFetch(codes: string[]): string[] {
  const wanted = normalizeCodes(codes);
  const missingKeys = new Set(sparklineCache.missing(wanted.map((c) => sparklineCacheKey(c))));
  return wanted
    // partial 在短 TTL 內先不重打；TTL 過期後 partialCache 失效 → 自動重新回補
    .filter((c) => missingKeys.has(sparklineCacheKey(c)) && !sparklinePartialCache.get(sparklineCacheKey(c)))
    .filter((c) => !sparklineFailCache.get(sparklineCacheKey(c)))
    .slice(0, SPARKLINE_BATCH_SIZE);
}

export function useSparklines(codes: string[] | null | undefined, opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled !== false;
  const [version, setVersion] = useState(0);
  const inFlightRef = useRef(false);
  const codesKey = normalizeCodes(codes).sort().join(',');

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

  useEffect(() => {
    if (!enabled) return;
    const wanted = codesKey ? codesKey.split(',') : [];
    if (!wanted.length) return;
    const missing = planSparklineFetch(wanted);
    if (!missing.length || inFlightRef.current) return;

    let cancelled = false;
    inFlightRef.current = true;
    (async () => {
      try {
        const data = await getCheckupGateway()
          .invoke<{ result?: SparklineMap }>('checkup-sparkline', { codes: missing })
          .catch(() => null);
        if (cancelled) return;
        const result = data?.result;
        if (!result) {
          // 整批失敗 → 全數進負快取，避免下次立刻又重試
          sparklineFailCache.setMany(
            Object.fromEntries(missing.map((c) => [sparklineCacheKey(c), true as const])),
          );
          return;
        }
        const good: SparklineMap = {};
        const partial: SparklineMap = {};
        const bad: Record<string, true> = {};
        for (const code of missing) {
          const entry = result[code];
          if (!entry) { bad[sparklineCacheKey(code)] = true; continue; }
          if (isCompleteSparkline(entry)) good[sparklineCacheKey(code)] = entry;
          else partial[sparklineCacheKey(code)] = entry;
        }
        if (Object.keys(good).length) sparklineCache.setMany(good);
        if (Object.keys(partial).length) sparklinePartialCache.setMany(partial);
        if (Object.keys(bad).length) sparklineFailCache.setMany(bad);
      } catch {
        /* silent — sparkline 為非關鍵裝飾 */
      } finally {
        inFlightRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [codesKey, enabled]);

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

const sparklineInFlight = new Set<string>();

/** 候選 D/F：hover 時預載單股 30D 走勢。已存在或快取中則不發請求。 */
export async function prefetchSparkline(code: string): Promise<void> {
  if (!code || !/^\d{4,6}[A-Z]?$/i.test(code)) return;
  const key = sparklineCacheKey(code);
  if (sparklineCache.get(key) || sparklinePartialCache.get(key) || sparklineFailCache.get(key) || sparklineInFlight.has(code)) return;
  sparklineInFlight.add(code);
  try {
    const data = await getCheckupGateway()
      .invoke<{ result?: SparklineMap }>('checkup-sparkline', { codes: [code] })
      .catch(() => null);
    const result = data?.result;
    const entry = result?.[code];
    if (entry) {
      if (isCompleteSparkline(entry)) sparklineCache.set(key, entry);
      else sparklinePartialCache.set(key, entry);
    } else if (result) sparklineFailCache.set(key, true);
  } catch {
    /* silent */
  } finally {
    sparklineInFlight.delete(code);
  }
}

export default useSparklines;

