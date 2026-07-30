/**
 * 單檔即時報價 — 一律經過 price-authority seam（`fetchAuthoritativeQuote`），
 * 收盤後回傳當日 snapshot 收盤價，盤中才回 current_prices，避免與收盤價對不上。
 * Realtime 只作為「有新價寫入」的觸發器，實際數值仍重新走 seam 取得。
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAuthoritativeQuote } from '@/checkup/lib/authoritativeQuotes';

interface StockQuote {
  symbol: string;
  price: number;
  changePercent: number;
  change: number;
  volume: number | null;
  updatedAt: string | null;
}

export function useStockQuote(symbol: string = '2330', refreshInterval: number = 30000) {
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Extract full TW code including ETF letter suffix (e.g. "00631L 元大台灣50正2" → "00631L",
  // "2330.TW" → "2330"). 舊 `/^\d{4}/` 會把 00631L 截成 0063 造成報價查不到。
  const code = symbol.match(/^\d{4,6}[A-Z]?/)?.[0] || symbol;

  const fetchQuote = useCallback(async () => {
    if (!code) {
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const q = await fetchAuthoritativeQuote(code);
      if (!q) {
        setQuote(null);
        return;
      }
      setQuote({
        symbol: code,
        price: q.price,
        changePercent: q.changePct,
        change: Number(q.change.toFixed(2)),
        volume: null,
        updatedAt: q.updatedAt,
      });
    } catch (err) {
      console.error('Failed to fetch stock quote:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    fetchQuote();

    // Realtime：只當作 invalidation 訊號，價格權威順序仍由 seam 決定。
    const channel = supabase
      .channel(`current-price-${code}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'current_prices',
          filter: `symbol=eq.${code}`,
        },
        () => {
          fetchQuote();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [code, fetchQuote]);

  return { quote, loading, error, refetch: fetchQuote };
}
