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
    // Defer websocket setup to browser idle — `user_performances` only refreshes
    // on a 5-min cron, so opening the channel on the critical render path costs
    // ~200ms of script time for zero perceived benefit.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const start = () => {
      channel = supabase
        .channel(`expert-perf-${expertId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'user_performances' },
          () => {
            queryClient.invalidateQueries({ queryKey: ['expert-performance', expertId] });
          }
        )
        // 補：trade_records 事件 → 同步刷新 calculate_expert_performance + 期間圖表
        // user_performances 只在 5 分鐘 cron 才動，過去平倉/加碼會等到下一輪才反映在訂閱者頁面。
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'trade_records', filter: `expert_id=eq.${expertId}` },
          () => {
            queryClient.invalidateQueries({ queryKey: ['expert-performance', expertId] });
            queryClient.invalidateQueries({ queryKey: ['period-performance-v3', expertId] });
          }
        )
        .subscribe();
    };
    const handle: number = typeof w.requestIdleCallback === 'function'
      ? w.requestIdleCallback(start, { timeout: 3000 })
      : (setTimeout(start, 1500) as unknown as number);

    return () => {
      if (typeof w.cancelIdleCallback === 'function') {
        try { w.cancelIdleCallback(handle); } catch {}
      } else {
        clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
      }
      if (channel) supabase.removeChannel(channel);
    };
  }, [expertId, queryClient]);
}

