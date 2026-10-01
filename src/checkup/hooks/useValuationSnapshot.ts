/**
 * useValuationSnapshot —— 歷史比率與三尺財報情境的唯讀接縫。
 *
 * 契約：
 *   - 對外握手一律走 `getCheckupGateway()`（不得直接 import supabase client / fetch）。
 *   - 只讀（rpc valuation_snapshot 為 STABLE），**不做任何寫入**。
 *   - 比率的分位／同業交給 `valuationRulers.ts`；無獨立財報時 `valuationScenario.ts` 不產生價格。
 *   - harness 以 `injectedGateway` 換成 fake，達成零網路。
 */
import { useCallback, useEffect, useState } from 'react';
import { getCheckupGateway, type CheckupGateway } from '@/checkup/lib/gateway';
import {
  buildValuationView,
  type ValuationView,
} from '@/checkup/lib/valuationRulers';
import { buildValuationScenario, type ValuationScenario } from '@/checkup/lib/valuationScenario';

/** as-of 超過這麼多天視為 stale（台股連假最長約 5 個交易日）。 */
export const VALUATION_STALE_DAYS = 7;

export type ValuationStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseValuationSnapshotResult {
  status: ValuationStatus;
  view: ValuationView | null;
  /** 公開財報分母與可比倍數均核實後，才會產生三尺情境區間。 */
  band: ValuationScenario | null;
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
  const [band, setBand] = useState<ValuationScenario | null>(null);
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
    setBand(null);
    setView(null);
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
        if (cancelled) return;
        // RPC 只有比率，沒有已公告的獨立 EPS/BVPS/每股營收、公告日與可比倍數理由。
        // 不以收盤價除比率循環產出情境價，也不把產業大類當可比同業。
        setBand(buildValuationScenario(payload.asOf ?? null, []));
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
