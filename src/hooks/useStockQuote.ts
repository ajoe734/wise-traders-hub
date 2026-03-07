import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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

  // Extract 4-digit code from symbol (e.g. "2330.TW" → "2330", "2330 台積電" → "2330")
  const code = symbol.match(/^\d{4}/)?.[0] || symbol;

  const fetchQuote = useCallback(async () => {
    if (!code) {
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const { data, error: dbError } = await supabase
        .from('current_prices')
        .select('*')
        .eq('symbol', code)
        .maybeSingle();

      if (dbError) throw new Error(dbError.message);
      if (!data) {
        setQuote(null);
        return;
      }

      const price = Number(data.price);
      const changePercent = Number(data.change_percent || 0);
      const change = changePercent !== 0 ? price * changePercent / (100 + changePercent) : 0;

      setQuote({
        symbol: data.symbol,
        price,
        changePercent,
        change: Number(change.toFixed(2)),
        volume: data.volume ? Number(data.volume) : null,
        updatedAt: data.updated_at,
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

    // Subscribe to Realtime updates for this symbol
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
        (payload) => {
          const row = payload.new as any;
          const price = Number(row.price);
          const changePercent = Number(row.change_percent || 0);
          const change = changePercent !== 0 ? price * changePercent / (100 + changePercent) : 0;
          setQuote({
            symbol: row.symbol,
            price,
            changePercent,
            change: Number(change.toFixed(2)),
            volume: row.volume ? Number(row.volume) : null,
            updatedAt: row.updated_at,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [code, fetchQuote]);

  return { quote, loading, error, refetch: fetchQuote };
}
