// useTwChipsDetail — 抽屜私有查詢：台股籌碼面（三大法人 + BSR）
// 使用 supabase.functions.invoke('tw-chips-detail')；SWR 5 分鐘快取。
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface InstitutionalWindow {
  foreign_net: number;
  trust_net: number;
  dealer_net: number;
  total_net: number;
  days_covered: number;
}

export interface BsrBroker {
  broker_id: string;
  name: string;
  net: number;
}

export interface BsrWindow {
  top_buy: BsrBroker[];
  top_sell: BsrBroker[];
  concentration_ratio: number | null;
}

export interface InstitutionalDailyPoint {
  date: string;
  foreign_net: number;
  trust_net: number;
  dealer_net: number;
  total_net: number;
}

export interface BsrConcentrationPoint {
  date: string;
  concentration_ratio: number | null;
  top_net: number;
}

export interface TwChipsPayload {
  stock_id: string;
  as_of: string | null;
  as_of_lag_days?: number | null;

  institutional: {
    d1: InstitutionalWindow | null;
    d5: InstitutionalWindow | null;
    d20: InstitutionalWindow | null;
    d60: InstitutionalWindow | null;
  };
  bsr: {
    d5: BsrWindow | null;
    d20: BsrWindow | null;
    d60: BsrWindow | null;
  };
  bsr_as_of: string | null;
  bsr_as_of_lag_days?: number | null;
  bsr_last_failure?: {
    trade_date: string;
    error_code: string;
    attempts: number;
    next_retry_at?: string | null;
    backoff_seconds?: number | null;
    consecutive_failures?: number | null;
    last_successful_as_of?: string | null;
    lookback_from?: string | null;
    lookback_to?: string | null;
    lookback_days?: number | null;
  } | null;
  bsr_sync_status?: {
    eligible: boolean;
    ineligible_reason: 'invalid_stock_id' | 'missing_instrument' | 'unsupported_asset_type' | null;
    asset_class?: string | null;
    queued: boolean;
    status: 'pending' | 'running' | 'failed' | 'dead' | 'not_queued' | 'ineligible';
    next_run_at: string | null;
    attempts: number;
    max_attempts: number;
    error_code: string | null;
    retryable: boolean;
  };
  series?: {
    institutional_daily: InstitutionalDailyPoint[];
    bsr_concentration: BsrConcentrationPoint[];
  };
  source: string;
  fetched_at: string;
}

const CACHE = new Map<string, { data: TwChipsPayload; ts: number }>();
const TTL_MS = 5 * 60 * 1000;

// 台股代碼判定：4-6 位純數字（2330、00878、911616 等）
export function isTaiwanStockCode(code: string | undefined | null): boolean {
  if (!code) return false;
  return /^\d{4,6}[A-Z]?$/.test(String(code).trim());
}

/**
 * 分點（BSR）資料可用性判定。
 * FinMind 的 TaiwanStockTradingDailyReport 僅覆蓋一般個股，
 * ETF / 權證 / 受益憑證 / 可轉債 / DR 皆無分點資料 → 不入 sync 佇列、UI 直接顯示提示。
 * 規則：4 碼、首位為 1-9 之個股（如 1101、2330、6285、9958）才視為 chip-eligible。
 */
export function isTaiwanChipEligible(code: string | undefined | null): boolean {
  if (!code) return false;
  return /^[1-9]\d{3}$/.test(String(code).trim());
}

export type ChipsErrorKind =
  | 'network'
  | 'offline'
  | 'timeout'
  | 'auth'
  | 'server'
  | 'not_found'
  | 'unknown';

export interface ChipsError {
  kind: ChipsErrorKind;
  status?: number;
  message: string;
  reason: string; // 使用者可讀
}

function classifyError(err: unknown, status?: number): ChipsError {
  const msg = (err as Error)?.message || String(err);
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { kind: 'offline', message: msg, reason: '目前離線，恢復連線後可自動重試' };
  }
  if (msg.includes('AbortError') || msg.includes('timeout')) {
    return { kind: 'timeout', status, message: msg, reason: '請求逾時，請稍後重試' };
  }
  if (status === 401 || status === 403) {
    return { kind: 'auth', status, message: msg, reason: '登入或權限失效，請重新登入' };
  }
  if (status === 404) {
    return { kind: 'not_found', status, message: msg, reason: '此代號無籌碼資料' };
  }
  if (status && status >= 500) {
    return { kind: 'server', status, message: msg, reason: '伺服器暫時無法回應（TWSE 可能異常）' };
  }
  if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('networkerror')) {
    return { kind: 'network', message: msg, reason: '網路連線失敗，請重試' };
  }
  return { kind: 'unknown', status, message: msg, reason: msg.slice(0, 80) || '未知錯誤' };
}

export function useTwChipsDetail(stockCode: string | undefined | null, enabled = true) {
  const [data, setData] = useState<TwChipsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ChipsError | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const inflight = useRef<AbortController | null>(null);
  const [manualBump, setManualBump] = useState(0);

  // 離線 / 上線監聽（上線時自動重試）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const on = () => {
      setOnline(true);
      setManualBump((n) => n + 1); // 觸發重取
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (!stockCode || !isTaiwanStockCode(stockCode)) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    // 離線時：若有 cache 就顯示 cache + offline error；否則 offline error
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const cached = CACHE.get(stockCode);
      if (cached) {
        setData(cached.data);
        setFetchedAt(cached.ts);
      }
      setError({ kind: 'offline', message: 'offline', reason: '目前離線，恢復連線後將自動重試' });
      setLoading(false);
      return;
    }

    // 讀快取
    const cached = CACHE.get(stockCode);
    if (cached && Date.now() - cached.ts < TTL_MS && manualBump === 0) {
      setData(cached.data);
      setFetchedAt(cached.ts);
      setError(null);
      setLoading(false);
      return;
    }

    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setLoading(true);
    setError(null);

    const timeoutId = window.setTimeout(() => ctrl.abort(), 15000);

    (async () => {
      let status: number | undefined;
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        const url = `${(supabase as any).functionsUrl || (import.meta.env.VITE_SUPABASE_URL + '/functions/v1')}/tw-chips-detail?stock_id=${encodeURIComponent(stockCode)}`;
        const resp = await fetch(url, {
          signal: ctrl.signal,
          headers: {
            apikey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || '',
            Authorization: token
              ? `Bearer ${token}`
              : `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        });
        status = resp.status;
        if (!resp.ok) {
          const t = await resp.text();
          throw new Error(`chips ${resp.status}: ${t.slice(0, 120)}`);
        }
        const json = (await resp.json()) as TwChipsPayload;
        const now = Date.now();
        CACHE.set(stockCode, { data: json, ts: now });
        setData(json);
        setFetchedAt(now);
        setError(null);
        setAttempt(0);
      } catch (err) {
        if ((err as any).name === 'AbortError' && !ctrl.signal.aborted) return;
        // 保留舊 cache 資料當降級顯示
        const cached2 = CACHE.get(stockCode);
        if (cached2) {
          setData(cached2.data);
          setFetchedAt(cached2.ts);
        }
        setError(classifyError(err, status));
      } finally {
        window.clearTimeout(timeoutId);
        if (inflight.current === ctrl) inflight.current = null;
        setLoading(false);
      }
    })();

    return () => {
      window.clearTimeout(timeoutId);
      ctrl.abort();
    };
  }, [stockCode, enabled, manualBump, attempt]);

  const refetch = () => {
    if (stockCode) CACHE.delete(stockCode);
    setAttempt((n) => n + 1);
  };

  const stale = !!(data && fetchedAt && Date.now() - fetchedAt > TTL_MS);

  return { data, loading, error, fetchedAt, online, stale, refetch };
}

