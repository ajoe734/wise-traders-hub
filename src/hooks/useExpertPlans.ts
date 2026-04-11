import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useExpertPlans(expertId: string | undefined) {
  return useQuery({
    queryKey: ['expert-plans', expertId],
    queryFn: async () => {
      if (!expertId) return [];
      const { data, error } = await supabase
        .from('expert_plans')
        .select('*')
        .eq('expert_id', expertId)
        .eq('is_active', true)
        .order('price_monthly');
      if (error) throw error;
      return data || [];
    },
    enabled: !!expertId,
    staleTime: 30_000,
  });
}

export function usePlan(planId: string | undefined) {
  return useQuery({
    queryKey: ['plan', planId],
    queryFn: async () => {
      if (!planId) return null;
      const { data, error } = await supabase
        .from('expert_plans')
        .select('*, experts(*)')
        .eq('id', planId)
        .single();
      if (error) return null;
      return data;
    },
    enabled: !!planId,
    staleTime: 30_000,
  });
}
