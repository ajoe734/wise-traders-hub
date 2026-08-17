import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useExpertHoldingsBundle } from '@/hooks/useExpertHoldingsBundle';
import { useProjectionStatus } from '@/hooks/useProjectionStatus';
import { gatePerformance } from '@/contracts/publicEconomicContract';

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
 * Read expert performance via RPC. The realtime invalidation is handled by
 * `useExpertHoldingsBundle` — any consumer that wants live updates should call
 * `useExpertPerformanceRealtime(expertId)` (which mounts the bundle's channel).
 */
export function useExpertPerformance(expertId: string | undefined) {
  // R1-P: this is a public surface. Numbers only leave the hook when the
  // public projection says the scope is ready.
  const projection = useProjectionStatus(expertId);
  const query = useQuery({
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

  return {
    ...query,
    projection,
    data: query.data
      ? (gatePerformance(query.data as unknown as Record<string, unknown>, projection) as unknown as ExpertPerformance | null)
      : query.data,
  };
}

/**
 * Opt-in realtime for expert performance / period chart. Internally mounts the
 * single-source holdings bundle, whose channel invalidates
 * `expert-performance` + `period-performance-v3` on trade_records /
 * user_performances changes.
 */
export function useExpertPerformanceRealtime(expertId: string | undefined) {
  useExpertHoldingsBundle(expertId);
}
