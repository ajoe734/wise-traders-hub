/**
 * usePortfolioValuation —— 持倉看板「投組加權估值指數」的 production seam。
 *
 * 契約（比照 useValuationSnapshot）：
 *   - 對外握手一律走 `getCheckupGateway()`，rpc `valuation_peer_medians`（STABLE，唯讀）。
 *   - 一次批量帶入全部台股代碼（上限 50，DB 端去重）。
 *   - 加權 / winsorize / 溢折價全部由純函式 `valuationRulers.ts` 計算，此 hook 不算數字。
 *   - harness 以 `injectedGateway` 換成 fake，達成零網路。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCheckupGateway, type CheckupGateway } from '@/checkup/lib/gateway';
import {
  buildBucketValuations,
  computePortfolioValuation,
  type BucketAssignment,
  type BucketValuation,
  type PeerRow,
  type PortfolioValuationResult,
  type PortfolioValuationInput,
} from '@/checkup/lib/valuationRulers';
import { computeStale, type ValuationStatus } from '@/checkup/hooks/useValuationSnapshot';

export interface PortfolioHoldingLike {
  code?: string | number | null;
  symbol?: string | number | null;
  /** 已正規化的市值（normalizeHoldingMetrics 的 value）。 */
  value?: number | null;
}

export interface UsePortfolioValuationResult {
  status: ValuationStatus;
  result: PortfolioValuationResult | null;
  /** 依產業／市場族群分桶的加權指數（需傳入 opts.bucketsOf，否則為空陣列）。 */
  buckets: BucketValuation[];
  /** 全部快照中最舊的 as-of（保守揭露）。 */
  asOf: string | null;
  stale: boolean;
  error: string | null;
  /** 最近一次成功取得資料的時間（毫秒）。 */
  lastFetchedAt: number | null;
  /** 手動重新抓取（自動排程之外的逃生門）。 */
  refetch: () => void;
}

/**
 * 自動更新排程（PORTFOLIO_VALUATION_AUTOREFRESH_V1）：
 *   - 後端估值同步是每交易日 16:30（台北）落地，前台不需要高頻輪詢。
 *   - 固定間隔 30 分鐘背景重抓一次；分頁隱藏時不打 RPC（省流量、避免背景累積）。
 *   - 分頁重新可見且距上次成功超過 5 分鐘時補抓一次，確保「早上打開昨天的分頁」立刻換新。
 *   - 重抓失敗不清空既有數字（保留舊值，只在 meta 顯示 as-of），避免畫面閃成錯誤態。
 */
export const PORTFOLIO_VALUATION_REFRESH_MS = 30 * 60 * 1000;
export const PORTFOLIO_VALUATION_VISIBLE_STALE_MS = 5 * 60 * 1000;

function taiwanCode(h: PortfolioHoldingLike): string {
  const raw = h?.code ?? h?.symbol ?? '';
  const code = String(raw).trim();
  return /^\d{4,6}$/.test(code) ? code : '';
}

export function usePortfolioValuation(
  holdings: PortfolioHoldingLike[] | null | undefined,
  opts: {
    injectedGateway?: CheckupGateway;
    now?: () => number;
    refreshMs?: number;
    /** 個股 → 產業／族群桶（由呼叫端以 getMultiMeta 提供，與索引區同口徑）。 */
    bucketsOf?: (symbol: string) => BucketAssignment[];
  } = {},
): UsePortfolioValuationResult {
  const [status, setStatus] = useState<ValuationStatus>('idle');
  const [rows, setRows] = useState<PortfolioValuationInput[] | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const lastFetchedRef = useRef<number | null>(null);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  const candidates = useMemo(() => {
    const list = Array.isArray(holdings) ? holdings : [];
    return list
      .map((h) => ({ code: taiwanCode(h), weight: Number(h?.value) || 0 }))
      .filter((c) => c.code && c.weight > 0);
  }, [holdings]);

  const key = useMemo(
    () => candidates.map((c) => `${c.code}:${Math.round(c.weight)}`).join(','),
    [candidates],
  );

  useEffect(() => {
    if (candidates.length === 0) {
      setStatus('idle');
      setRows(null);
      setAsOf(null);
      setError(null);
      lastFetchedRef.current = null;
      setLastFetchedAt(null);
      return;
    }
    let cancelled = false;
    // 背景重抓（已有資料）時不要把畫面打回 loading，避免數字閃爍。
    const isRefresh = lastFetchedRef.current != null;
    if (!isRefresh) setStatus('loading');
    setError(null);

    const gateway = opts.injectedGateway || getCheckupGateway();
    const symbols = [...new Set(candidates.map((c) => c.code))];
    Promise.resolve(gateway.rpc('valuation_peer_medians', { _symbols: symbols }))
      .then((raw: any) => {
        if (cancelled) return;
        const arr: any[] = Array.isArray(raw) ? raw : [];
        const bySymbol = new Map<string, any>();
        let oldest: string | null = null;
        for (const item of arr) {
          if (!item?.symbol) continue;
          bySymbol.set(String(item.symbol), item);
          const a = item.asOf || null;
          if (a && (!oldest || a < oldest)) oldest = a;
        }
        const merged: PortfolioValuationInput[] = candidates.map((c) => {
          const snap = bySymbol.get(c.code);
          return {
            symbol: c.code,
            weight: c.weight,
            pe: snap?.pe ?? null,
            pb: snap?.pb ?? null,
            dividendYield: snap?.dividendYield ?? null,
            peers: (Array.isArray(snap?.peers) ? snap.peers : []) as PeerRow[],
          };
        });
        setRows(merged);
        setAsOf(oldest);
        setStatus('ready');
        const ts = (opts.now || Date.now)();
        lastFetchedRef.current = ts;
        setLastFetchedAt(ts);
      })
      .catch((e: any) => {
        if (cancelled) return;
        if (isRefresh) {
          // 背景重抓失敗：保留舊數字，不把畫面打成錯誤態。
          setError(e?.message || '估值資料暫時取不到');
          return;
        }
        setRows(null);
        setAsOf(null);
        setError(e?.message || '估值資料暫時取不到');
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, opts.injectedGateway, tick]);

  // 自動更新排程：固定間隔 + 分頁重新可見時補抓（隱藏時不打 RPC）。
  useEffect(() => {
    if (candidates.length === 0) return;
    if (typeof window === 'undefined') return;
    const intervalMs = opts.refreshMs ?? PORTFOLIO_VALUATION_REFRESH_MS;
    if (!(intervalMs > 0)) return;

    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      refetch();
    }, intervalMs);

    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const last = lastFetchedRef.current;
      const now = (opts.now || Date.now)();
      if (last == null || now - last >= PORTFOLIO_VALUATION_VISIBLE_STALE_MS) refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, opts.refreshMs, refetch]);

  const result = useMemo(
    () => (rows ? computePortfolioValuation(rows) : null),
    [rows],
  );

  const bucketsOf = opts.bucketsOf;
  const buckets = useMemo(
    () => (rows && bucketsOf ? buildBucketValuations(rows, bucketsOf) : []),
    [rows, bucketsOf],
  );

  const nowMs = (opts.now || Date.now)();

  return {
    status,
    result,
    buckets,
    asOf,
    stale: computeStale(asOf, nowMs),
    error,
    lastFetchedAt,
    refetch,
  };
}
