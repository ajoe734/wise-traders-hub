import { useState, useEffect, useCallback } from 'react';

interface StockQuote {
  symbol: string;
  shortName: string;
  currency: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  marketTime: number;
}

export function useStockQuote(symbol: string = '2330.TW', refreshInterval: number = 30000) {
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQuote = useCallback(async () => {
    try {
      setError(null);
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/stock-quote?symbol=${encodeURIComponent(symbol)}`,
        {
          headers: {
            'apikey': anonKey,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const quoteData: StockQuote = await res.json();
      setQuote(quoteData);
    } catch (err) {
      console.error('Failed to fetch stock quote:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchQuote();
    const interval = setInterval(fetchQuote, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchQuote, refreshInterval]);

  return { quote, loading, error, refetch: fetchQuote };
}
