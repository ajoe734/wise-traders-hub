import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ExpertPerformance {
  total_trades: number;
  win_rate: number;
  max_drawdown: number;
  profit_factor: number;
  avg_hold_days: number;
  avg_pnl_pct: number;
  avg_pnl_amount: number;
  return_1y: number;
  current_asset: number;
  starting_capital?: number;
  realized_pnl_amount?: number;
  unrealized_pnl_amount?: number;
  total_return_pct: number;
}

/**
 * Read expert performance via RPC. No realtime subscription here — the backend
 * cron updates `user_performances` every 5 min, and react-query's `staleTime`
 * + `refetchOnWindowFocus` is enough for list contexts (home, explore).
 *
 * For pages that need live updates (expert detail), use
 * `useExpertPerformanceRealtime(expertId)` to opt in to a single channel
 * scoped to that page.
 */
export function useExpertPerformance(expertId: string | undefined) {
  return useQuery({
    queryKey: ['expert-performance', expertId],
    queryFn: async () => {
      if (!expertId) return null;
      const { data, error } = await supabase.rpc('calculate_expert_performance', {
        _expert_id: expertId,
      });
      if (error) throw error;
      return data as unknown as ExpertPerformance;
    },
    enabled: !!expertId,
    staleTime: 60_000,
  });
}

/**
 * Opt-in realtime subscription for pages that genuinely need live perf updates.
 * Use sparingly — each call opens a websocket channel.
 */
export function useExpertPerformanceRealtime(expertId: string | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!expertId) return;
    const channel = supabase
      .channel(`expert-perf-${expertId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_performances' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['expert-performance', expertId] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [expertId, queryClient]);
}
