import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PersonWithPlans, PlanType, Plan } from '@/types';

export function mapToPersonWithPlans(row: any): PersonWithPlans {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    role: row.role as 'advisor' | 'mentor',
    avatarUrl: row.avatar_url || undefined,
    bio: row.bio || '',
    description: row.description || '',
    styleTags: row.style_tags || [],
    markets: row.markets || [],
    strategySummary: row.strategy_summary || '',
    backtestReturn1y: row.backtest_1y_return ?? null,
    backtestMaxDrawdown: row.backtest_max_drawdown ?? null,
    backtestAnnualReturn: row.backtest_annual_return ?? null,
    plans: (row.expert_plans || [])
      .filter((p: any) => p.is_active && p.review_status === 'approved')
      .map((p: any): Plan => ({
        id: p.id,
        personId: row.id,
        planType: p.plan_type as PlanType,
        name: p.name,
        description: p.description || '',
        priceMonthly: p.price_monthly,
        priceYearly: p.price_yearly || 0,
        features: Array.isArray(p.features) ? p.features : [],
        isActive: p.is_active,
      })),
    tradingSystems: [],
  };
}

export function useExperts() {
  return useQuery({
    queryKey: ['experts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('experts')
        .select('*, expert_plans(*)')
        .eq('status', 'active')
        .order('created_at');
      if (error) throw error;
      return (data || []).map(mapToPersonWithPlans);
    },
    staleTime: 30_000,
  });
}

export function useExpert(slug: string | undefined) {
  return useQuery({
    queryKey: ['expert', slug],
    queryFn: async () => {
      if (!slug) return null;
      const { data, error } = await supabase
        .from('experts')
        .select('*, expert_plans(*)')
        .eq('slug', slug)
        .eq('status', 'active');
      if (error || !data || data.length === 0) return null;
      return mapToPersonWithPlans(data[0]);
    },
    enabled: !!slug,
    staleTime: 30_000,
  });
}
