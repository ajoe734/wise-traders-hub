import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PersonWithPlans, PersonRole, PlanType, Plan } from '@/types';

function mapPlanType(dbType: string): PlanType {
  switch (dbType) {
    case 'analyst_signal_l1': return PlanType.ANALYST_SIGNAL_L1;
    case 'analyst_signal_diag_l2': return PlanType.ANALYST_SIGNAL_DIAG_L2;
    case 'mentor_weekly_journal': return PlanType.MENTOR_WEEKLY_JOURNAL;
    default: return PlanType.ANALYST_SIGNAL_L1;
  }
}

export function mapToPersonWithPlans(row: any): PersonWithPlans {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    role: row.role === 'advisor' ? PersonRole.ADVISOR : PersonRole.MENTOR,
    avatarUrl: row.avatar_url || undefined,
    bio: row.bio || '',
    description: row.description || '',
    styleTags: row.style_tags || [],
    markets: row.markets || [],
    plans: (row.expert_plans || [])
      .filter((p: any) => p.is_active && p.review_status === 'approved')
      .map((p: any): Plan => ({
        id: p.id,
        personId: row.id,
        planType: mapPlanType(p.plan_type),
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
        .order('name');
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
        .single();
      if (error || !data) return null;
      return mapToPersonWithPlans(data);
    },
    enabled: !!slug,
    staleTime: 30_000,
  });
}
