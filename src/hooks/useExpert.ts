import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PersonWithPlans, PlanType, Plan } from '@/types';
import { useAuth } from '@/contexts/AuthContext';

type ExpertVisibilityMode = 'default' | 'tester' | 'privileged';

/**
 * 公開瀏覽用的能見度判斷。
 *
 * 注意：即使 user 是 company_admin / analyst，公開頁面（/experts、/app/explore、
 * /expert/:slug）也**不會**回傳 'privileged'。原因是 admin 在公開頁瀏覽時，
 * 看到的清單必須與一般訪客一致；否則會出現「admin 看得到 suspended 專家、
 * 訪客看不到」的不對稱（曾因此把已停用的專家誤露在公開頁上）。
 *
 * 'privileged' 僅保留給後台管理頁透過 `includeAllStatuses: true` 主動要求。
 */
export function getVisibilityMode(
  user: { isTester: boolean; roles: Array<'company_admin' | 'analyst'> } | null,
  opts?: { includeAllStatuses?: boolean },
): ExpertVisibilityMode {
  if (opts?.includeAllStatuses) {
    return 'privileged';
  }

  if (user?.isTester) {
    return 'tester';
  }

  return 'default';
}

export function filterExpertRows(rows: any[], visibilityMode: ExpertVisibilityMode) {
  if (visibilityMode === 'privileged') {
    return rows;
  }

  if (visibilityMode === 'tester') {
    // tester 預覽 draft（既有語意），suspended 永遠排除
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
    startingCapital: row.starting_capital ?? null,
    plans: (row.expert_plans || [])
      .filter((p: any) => p.is_active)
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
