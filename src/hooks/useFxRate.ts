import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface FxRate {
  pair: string;
  rate: number;
  source: string;
  fetchedAt: string; // ISO
}

/**
 * 讀取 fx_rates 表快取的最新匯率（預設 USDTWD）。
 * 由 `fx-rate-sync` edge function 定時更新，前端每 5 分鐘 stale。
 */
export function useFxRate(pair: string = 'USDTWD') {
  return useQuery<FxRate | null>({
    queryKey: ['fx-rate', pair],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fx_rates' as any)
        .select('currency_pair, rate, source, fetched_at')
        .eq('currency_pair', pair)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as any;
      return {
        pair: row.currency_pair,
        rate: Number(row.rate),
        source: row.source,
        fetchedAt: row.fetched_at,
      };
    },
  });
}
