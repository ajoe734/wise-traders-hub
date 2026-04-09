import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PersonWithPlans, PlanType, Plan } from '@/types';
import { useAuth } from '@/contexts/AuthContext';

type ExpertVisibilityMode = 'default' | 'tester' | 'privileged';

function getVisibilityMode(user: { isTester: boolean; roles: Array<'company_admin' | 'analyst'> } | null): ExpertVisibilityMode {
  if (user?.roles.includes('company_admin') || user?.roles.includes('analyst')) {
    return 'privileged';
  }

  if (user?.isTester) {
    return 'tester';
  }

  return 'default';
}

function filterExpertRows(rows: any[], visibilityMode: ExpertVisibilityMode) {
  if (visibilityMode === 'privileged') {
    return rows;
  }

  if (visibilityMode === 'tester') {
    return rows.filter((row) => row.status === 'draft');
  }

  return rows.filter((row) => row.status === 'active');
}

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
  const { user, isLoading: isAuthLoading } = useAuth();
  const visibilityMode = getVisibilityMode(user);

  return useQuery({
    queryKey: ['experts', user?.id ?? 'guest', visibilityMode],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('experts')
        .select('*, expert_plans(*)')
        .order('created_at');
      if (error) throw error;
      return filterExpertRows(data || [], visibilityMode).map(mapToPersonWithPlans);
    },
    enabled: !isAuthLoading,
    staleTime: 30_000,
  });
}

export function useExpert(slug: string | undefined) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const visibilityMode = getVisibilityMode(user);

  return useQuery({
    queryKey: ['expert', slug, user?.id ?? 'guest', visibilityMode],
    queryFn: async () => {
      if (!slug) return null;
      const { data, error } = await supabase
        .from('experts')
        .select('*, expert_plans(*)')
        .eq('slug', slug);
      if (error || !data || data.length === 0) return null;

      const visibleRows = filterExpertRows(data, visibilityMode);
      if (visibleRows.length === 0) return null;

      return mapToPersonWithPlans(visibleRows[0]);
    },
    enabled: !!slug && !isAuthLoading,
    staleTime: 30_000,
  });
}
