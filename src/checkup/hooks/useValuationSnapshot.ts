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

type FundamentalsPayload = {
  ok?: boolean;
  asOf?: string | null;
  rows?: ScenarioRowInput[];
  reason?: string;
  official?: { source?: 'TWSE' | 'TPEx' | 'FinMind-TWSE'; preferredUnknown?: boolean } | null;
};

export function scenarioFromFundamentals(payload: FundamentalsPayload | null | undefined, fallbackAsOf: string | null, failure?: string): ValuationScenario {
  if (!payload || !Array.isArray(payload.rows) || payload.rows.length === 0) {
    const reason = failure || payload?.reason || '財報情境服務未回傳資料';
    return buildValuationScenario(payload?.asOf ?? fallbackAsOf, (['pe', 'pb', 'ps'] as const).map((key) => ({ key, notApplicable: reason })));
  }
  const scenario = buildValuationScenario(payload.asOf ?? fallbackAsOf, payload.rows.map((r) => ({ key: r.key, basis: r.basis ?? null, multiples: r.multiples ?? null, notApplicable: r.notApplicable ?? null, basisIssue: (r as any).basisIssue ?? null, multipleIssue: (r as any).multipleIssue ?? null, samples: Array.isArray(r.samples) ? r.samples : undefined, reference: (r as any).reference ?? null })));
  const source = payload.official?.source;
  scenario.shareVerification = {
    source: source === 'TWSE' || source === 'TPEx' ? 'official' : source === 'FinMind-TWSE' ? 'fallback' : 'unknown',
    preferredUnknown: payload.official?.preferredUnknown === true,
  };
  return scenario;
}

/** 財報情境前端快取：同一代碼 6 小時內共用一次結果；同時開啟的兩個元件共用同一個請求。 */
export const FUNDAMENTALS_CLIENT_TTL_MS = 6 * 3600 * 1000;
export const FUNDAMENTALS_TIMEOUT_MS = 25_000;
const fundCache = new Map<string, { at: number; value: FundamentalsPayload }>();
const fundInflight = new Map<string, Promise<FundamentalsPayload>>();
export function __resetFundamentalsCache() { fundCache.clear(); fundInflight.clear(); }

/** peers=false：只算目標公司（快，先畫三尺）；peers=true：含同業（慢，背景補上）。 */
export function loadFundamentals(gateway: CheckupGateway, code: string, force = false, peers = true): Promise<FundamentalsPayload> {
  const key = peers ? code : `${code}:target`;
  if (!peers) { const full = fundCache.get(code); if (!force && full && Date.now() - full.at < FUNDAMENTALS_CLIENT_TTL_MS) return Promise.resolve(full.value); }
  const hit = fundCache.get(key);
  if (!force && hit && Date.now() - hit.at < FUNDAMENTALS_CLIENT_TTL_MS) return Promise.resolve(hit.value);
  const running = fundInflight.get(key);
  if (running) return running;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const p = Promise.race([
    gateway.invoke<FundamentalsPayload>(FUNDAMENTALS_FN, peers ? { symbol: code } : { symbol: code, peers: false }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('逾時')), FUNDAMENTALS_TIMEOUT_MS); }),
  ]).then((v) => { fundCache.set(key, { at: Date.now(), value: v }); return v; })
    .finally(() => { clearTimeout(timer); fundInflight.delete(key); });
  fundInflight.set(key, p);
  return p;
}

/** as-of 超過這麼多天視為 stale（台股連假最長約 5 個交易日）。 */
export const VALUATION_STALE_DAYS = 7;

export type ValuationStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseValuationSnapshotResult {
  status: ValuationStatus;
  view: ValuationView | null;
  /** 公開財報分母與可比倍數均核實後，才會產生三尺情境區間。 */
  band: ValuationScenario | null;
  /** 財報情境載入狀態（與比率 status 獨立）。 */
  bandStatus: ValuationStatus;
  /** 目標三尺已畫、同業比較仍在背景載入。 */
  peersPending: boolean;
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
  const [bandStatus, setBandStatus] = useState<ValuationStatus>('idle');
  const [peersPending, setPeersPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const code = symbol ? String(symbol).trim() : '';
  const eligible = isTaiwanStock(code);

  useEffect(() => {
    if (!eligible) {
      setStatus('idle');
      setView(null);
      setBand(null);
      setBandStatus('idle');
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setBand(null);
    setBandStatus('loading');
    setPeersPending(false);
    setView(null);
    setError(null);
    const gateway = opts.injectedGateway || getCheckupGateway();
    const force = tick > 0;

    // 比率（快）與財報情境（慢）各自獨立：比率先畫，財報到了再補，不互相阻塞。
    Promise.resolve(gateway.rpc('valuation_snapshot', { _symbol: code }))
      .then((raw: any) => {
        if (cancelled) return;
        const payload = Array.isArray(raw) ? raw[0] : raw;
        if (payload) {
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
        }
        setStatus('ready');
      })
      .catch((e: any) => {
        if (cancelled) return;
        setView(null);
        setError(e?.message || '估值資料暫時取不到');
        setStatus('error');
      });

    (async () => {
      let scenario: ValuationScenario;
      try {
        // 財報服務只接受有效登入；沒有或已過期的憑證就不呼叫，避免 401。
        const token = await gateway.auth?.getAccessToken?.().catch(() => null);
        if (!token || isJwtExpired(token)) {
          scenario = scenarioFromFundamentals(null, null, '登入狀態已失效，重新登入後可查看財報情境');
        } else {
          // 先只算目標公司（不等同業），畫出三尺後再背景補同業；同業失敗保留目標結果。
          const first = await loadFundamentals(gateway, code, force, false);
          scenario = scenarioFromFundamentals(first, null);
          if (!cancelled && (first as any)?.peersIncluded === false && Array.isArray(first?.rows) && first.rows.length) {
            setPeersPending(true);
            loadFundamentals(gateway, code, force, true)
              .then((full) => { if (!cancelled && Array.isArray(full?.rows) && full.rows.length) setBand(scenarioFromFundamentals(full, null)); })
              .catch(() => { /* 同業失敗：保留目標公司三尺 */ })
              .finally(() => { if (!cancelled) setPeersPending(false); });
          }
        }
      } catch (e: any) {
        scenario = scenarioFromFundamentals(null, null, `財報情境服務暫時無法取得（${e?.message || '未知錯誤'}）`);
      }
      if (cancelled) return;
      setBand(scenario);
      setBandStatus('ready');
    })();

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
    bandStatus,
    peersPending,
    error,
    stale: computeStale(view?.asOf ?? null, nowMs),
    refetch,
  };
}
