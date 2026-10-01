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
import { buildValuationScenario, type ScenarioRowInput, type ValuationScenario } from '@/checkup/lib/valuationScenario';

/** 唯讀財報情境 Edge Function；token 只在後端。 */
export const FUNDAMENTALS_FN = 'valuation-fundamentals';

const SKIP = Symbol('skip-fundamentals');

/** 本地檢查 JWT exp（含 30 秒緩衝）；解析失敗視為未過期，交由後端判定。 */
export function isJwtExpired(token: string, nowMs: number = Date.now()): boolean {
  try {
    const part = token.split('.')[1];
    if (!part) return false;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' && json.exp * 1000 <= nowMs + 30_000;
  } catch {
    return false;
  }
}

type FundamentalsPayload = { ok?: boolean; asOf?: string | null; rows?: ScenarioRowInput[]; reason?: string };

export function scenarioFromFundamentals(payload: FundamentalsPayload | null | undefined, fallbackAsOf: string | null, failure?: string): ValuationScenario {
  if (!payload || !Array.isArray(payload.rows) || payload.rows.length === 0) {
    const reason = failure || payload?.reason || '財報情境服務未回傳資料';
    return buildValuationScenario(payload?.asOf ?? fallbackAsOf, (['pe', 'pb', 'ps'] as const).map((key) => ({ key, notApplicable: reason })));
  }
  return buildValuationScenario(payload.asOf ?? fallbackAsOf, payload.rows.map((r) => ({ key: r.key, basis: r.basis ?? null, multiples: r.multiples ?? null, notApplicable: r.notApplicable ?? null })));
}

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
        // RPC 只有比率；PE/PB/PS 情境分母與倍數由唯讀財報服務提供（不以股價反推）。
        let scenario: ValuationScenario;
        try {
          // 財報服務只接受有效登入；沒有或已過期的憑證就不呼叫，避免 401 噴錯。
          const token = await gateway.auth?.getAccessToken?.().catch(() => null);
          if (!token || isJwtExpired(token)) {
            if (cancelled) return;
            scenario = scenarioFromFundamentals(null, payload.asOf ?? null, '登入狀態已失效，重新登入後可查看財報情境');
            throw SKIP;
          }
          const fund = await gateway.invoke<FundamentalsPayload>(FUNDAMENTALS_FN, { symbol: code });
          scenario = scenarioFromFundamentals(fund, payload.asOf ?? null);
        } catch (e: any) {
          if (e !== SKIP) scenario = scenarioFromFundamentals(null, payload.asOf ?? null, `財報情境服務暫時無法取得（${e?.message || '未知錯誤'}）`);
        }
        if (cancelled) return;
        setBand(scenario);
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
