import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CheckupPlan {
  id: string;
  tier: 'basic' | 'pro';
  name: string;
  description: string | null;
  price_monthly: number;
  price_yearly: number;
  monthly_quota: number;
  features: string[];
  sort_order: number;
}

export function useCheckupPlans() {
  return useQuery({
    queryKey: ['checkup-plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checkup_plans')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((p: any) => ({
        ...p,
        features: Array.isArray(p.features) ? p.features : [],
      })) as CheckupPlan[];
    },
    staleTime: 60_000,
  });
}

export function useCheckupPlan(planId: string | undefined) {
  return useQuery({
    queryKey: ['checkup-plan', planId],
    queryFn: async () => {
      if (!planId) return null;
      const { data, error } = await supabase
        .from('checkup_plans')
        .select('*')
        .eq('id', planId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        ...data,
        features: Array.isArray(data.features) ? data.features : [],
      } as CheckupPlan;
    },
    enabled: !!planId,
    staleTime: 60_000,
  });
}
