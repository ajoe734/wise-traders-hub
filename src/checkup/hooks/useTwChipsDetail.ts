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

export interface TwChipsPayload {
  stock_id: string;
  as_of: string | null;
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

export function useTwChipsDetail(stockCode: string | undefined | null, enabled = true) {
  const [data, setData] = useState<TwChipsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!stockCode || !isTaiwanStockCode(stockCode)) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    // 讀快取
    const cached = CACHE.get(stockCode);
    if (cached && Date.now() - cached.ts < TTL_MS) {
      setData(cached.data);
      setError(null);
      setLoading(false);
      return;
    }

    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setLoading(true);
    setError(null);

    supabase.functions
      .invoke('tw-chips-detail', {
        body: null,
        method: 'GET' as any,
        // supabase-js 對 GET query 不直接支援，改直呼 URL
      })
      .then(() => {}) // 佔位；下面用手動 fetch
      .catch(() => {});

    // 手動 fetch 才能帶 query string
    (async () => {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        const url = `${(supabase as any).functionsUrl || (import.meta.env.VITE_SUPABASE_URL + '/functions/v1')}/tw-chips-detail?stock_id=${encodeURIComponent(stockCode)}`;
        const resp = await fetch(url, {
          signal: ctrl.signal,
          headers: {
            apikey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || '',
            Authorization: token ? `Bearer ${token}` : `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        });
        if (!resp.ok) {
          const t = await resp.text();
          throw new Error(`chips ${resp.status}: ${t.slice(0, 120)}`);
        }
        const json = (await resp.json()) as TwChipsPayload;
        CACHE.set(stockCode, { data: json, ts: Date.now() });
        setData(json);
        setError(null);
      } catch (err) {
        if ((err as any).name === 'AbortError') return;
        setError((err as Error).message);
        setData(null);
      } finally {
        if (inflight.current === ctrl) inflight.current = null;
        setLoading(false);
      }
    })();

    return () => {
      ctrl.abort();
    };
  }, [stockCode, enabled]);

  return { data, loading, error };
}
