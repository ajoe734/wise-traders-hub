import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ExpertPerformance {
  total_trades: number;
  win_rate: number;
  cumulative_return: number;
  max_drawdown: number;
  profit_factor: number;
  avg_hold_days: number;
  total_pnl: number;
  return_1y: number;
  current_asset: number;
  starting_capital?: number;
  realized_pnl_amount?: number;
  unrealized_pnl_amount?: number;
  total_return_pct?: number;
}

export function useExpertPerformance(expertId: string | undefined) {
  const queryClient = useQueryClient();

  // ── Realtime：訂閱 user_performances 變化（後端 stock-price-sync 寫入時觸發 invalidate）──
  // 注意：user_performances 的 user_id 是分析師本人 user_id，不是訂閱者；
  // 這裡用 expertId 作 channel key 即可，invalidation 會讓任何看這位分析師的人都重抓最新數字
  useEffect(() => {
    if (!expertId) return;
    const channel = supabase
      .channel(`expert-perf-${expertId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_performances',
        },
        () => {
          // 任何 user_performances 更新就 invalidate；後端 5 分鐘 cron 會批次寫入
          queryClient.invalidateQueries({ queryKey: ['expert-performance', expertId] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [expertId, queryClient]);

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
