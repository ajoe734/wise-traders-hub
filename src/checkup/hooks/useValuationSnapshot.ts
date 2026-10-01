/**
 * useValuationSnapshot —— 估值三把尺的 production seam。
 *
 * 契約：
 *   - 對外握手一律走 `getCheckupGateway()`（不得直接 import supabase client / fetch）。
 *   - 只讀（rpc valuation_snapshot 為 STABLE），**不做任何寫入**。
 *   - 分位 / 中位數 / 溢折價全部交給純函式 `valuationRulers.ts`，此 hook 不算數字。
 *   - harness 以 `injectedGateway` 換成 fake，達成零網路。
 */
import { useCallback, useEffect, useState } from 'react';
import { getCheckupGateway, type CheckupGateway } from '@/checkup/lib/gateway';
import {
  buildValuationPriceBand,
  buildValuationView,
  type ValuationPriceBand,
  type ValuationView,
} from '@/checkup/lib/valuationRulers';

/** as-of 超過這麼多天視為 stale（台股連假最長約 5 個交易日）。 */
export const VALUATION_STALE_DAYS = 7;

export type ValuationStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseValuationSnapshotResult {
  status: ValuationStatus;
  view: ValuationView | null;
  /** 三尺換算的歷史估值參考區間（以估值同日收盤價反推）。 */
  band: ValuationPriceBand | null;
  error: string | null;
  stale: boolean;
  refetch: () => void;
}

function isTaiwanStock(code?: string | null): boolean {
  return !!code && /^\d{4,6}$/.test(String(code).trim());
}

export function computeStale(asOf: string | null, nowMs: number): boolean {
  if (!asOf) return false;
  const t = Date.parse(`${asOf}T00:00:00+08:00`);
  if (!Number.isFinite(t)) return false;
  return nowMs - t > VALUATION_STALE_DAYS * 86400000;
}

export function useValuationSnapshot(
  symbol?: string | null,
  opts: { injectedGateway?: CheckupGateway; now?: () => number } = {},
): UseValuationSnapshotResult {
  const [status, setStatus] = useState<ValuationStatus>('idle');
  const [view, setView] = useState<ValuationView | null>(null);
  const [band, setBand] = useState<ValuationPriceBand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const code = symbol ? String(symbol).trim() : '';
  const eligible = isTaiwanStock(code);

  useEffect(() => {
    if (!eligible) {
      setStatus('idle');
      setView(null);
      setBand(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setError(null);

    const gateway = opts.injectedGateway || getCheckupGateway();
    Promise.resolve(gateway.rpc('valuation_snapshot', { _symbol: code }))
      .then(async (raw: any) => {
        if (cancelled) return;
        const payload = Array.isArray(raw) ? raw[0] : raw;
        if (!payload) {
          setView(null);
          setBand(null);
          setStatus('ready');
          return;
        }
        // 估值同日收盤價：只取 asOf 當天，不回退其他日期（避免今日價配舊比率）。
        let closeAtAsOf: number | null = null;
        if (payload.asOf) {
          try {
            const { data } = await gateway.db
              .from('daily_price_snapshots')
              .select('close_price')
              .eq('symbol', code)
              .eq('trade_date', payload.asOf)
              .limit(1);
            const c = Number(Array.isArray(data) ? data[0]?.close_price : (data as any)?.close_price);
            closeAtAsOf = Number.isFinite(c) && c > 0 ? c : null;
          } catch {
            closeAtAsOf = null;
          }
        }
        if (cancelled) return;
        setBand(
          buildValuationPriceBand({
            asOf: payload.asOf ?? null,
            closeAtAsOf,
            pe: payload.pe ?? null,
            pb: payload.pb ?? null,
            dividendYield: payload.dividendYield ?? null,
            history: {
              pe: payload?.history?.pe || [],
              pb: payload?.history?.pb || [],
              dividendYield: payload?.history?.dividendYield || [],
            },
          }),
        );
        setView(
          buildValuationView({
            symbol: payload.symbol || code,
            asOf: payload.asOf ?? null,
            source: payload.source ?? null,
            pe: payload.pe ?? null,
            pb: payload.pb ?? null,
            dividendYield: payload.dividendYield ?? null,
            industry: payload.industry ?? null,
            history: {
              pe: payload?.history?.pe || [],
              pb: payload?.history?.pb || [],
              dividendYield: payload?.history?.dividendYield || [],
            },
            peerScope: payload.peerScope ?? null,
            peerIndustry: payload.peerIndustry ?? null,
            peers: payload.peers || [],
            trend: Array.isArray(payload?.trend) ? payload.trend : [],
          }),
        );
        setStatus('ready');
      })
      .catch((e: any) => {
        if (cancelled) return;
        setView(null);
        setBand(null);
        setError(e?.message || '估值資料暫時取不到');
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [code, eligible, tick, opts.injectedGateway]);

  const refetch = useCallback(() => setTick((n) => n + 1), []);
  const nowMs = (opts.now || Date.now)();

  return {
    status,
    view,
    band,
    error,
    stale: computeStale(view?.asOf ?? null, nowMs),
    refetch,
  };
}
