import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ExpertPerformance {
  total_trades: number;
  win_rate: number;
  cumulative_return: number;
  max_drawdown: number;
  profit_factor: number;
  avg_hold_days: number;
  total_pnl: number;
}

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
