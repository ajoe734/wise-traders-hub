import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PlanExpertStatus {
  expert_id: string;
  expert_name: string;
  expert_slug: string;
  expert_status: string;
}

/**
 * Fetches the underlying expert's status for a plan via SECURITY DEFINER RPC.
 * Used by checkout pages to distinguish "suspended" experts from truly missing plans.
 * The RPC bypasses experts-table RLS (which hides suspended rows from regular users).
 */
export function usePlanExpertStatus(planId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['plan-expert-status', planId],
    enabled: !!planId && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<PlanExpertStatus | null> => {
      if (!planId) return null;
      const { data, error } = await supabase.rpc('get_plan_expert_status', { p_plan_id: planId });
      if (error) return null;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as PlanExpertStatus) ?? null;
    },
  });
}
