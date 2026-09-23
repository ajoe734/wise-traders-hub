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
import { buildValuationView, type ValuationView } from '@/checkup/lib/valuationRulers';

/** as-of 超過這麼多天視為 stale（台股連假最長約 5 個交易日）。 */
export const VALUATION_STALE_DAYS = 7;

export type ValuationStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseValuationSnapshotResult {
  status: ValuationStatus;
  view: ValuationView | null;
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
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const code = symbol ? String(symbol).trim() : '';
  const eligible = isTaiwanStock(code);

  useEffect(() => {
    if (!eligible) {
      setStatus('idle');
      setView(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setError(null);

    const gateway = opts.injectedGateway || getCheckupGateway();
    Promise.resolve(gateway.rpc('valuation_snapshot', { _symbol: code }))
      .then((raw: any) => {
        if (cancelled) return;
        const payload = Array.isArray(raw) ? raw[0] : raw;
        if (!payload) {
          setView(null);
          setStatus('ready');
          return;
        }
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
    error,
    stale: computeStale(view?.asOf ?? null, nowMs),
    refetch,
  };
}
