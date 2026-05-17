import { useQuery, useQueryClient } from '@tanstack/react-query';
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
    riskPreference: row.risk_preference ?? null,
    operationCycle: row.operation_cycle ?? null,
    strategyName: row.strategy_name ?? null,
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

export function useExperts(opts?: { includeAllStatuses?: boolean }) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const visibilityMode = getVisibilityMode(user, opts);

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

export function useExpert(slug: string | undefined, opts?: { includeAllStatuses?: boolean }) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const visibilityMode = getVisibilityMode(user, opts);
  const queryClient = useQueryClient();

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
    // Seed from the experts-list cache when available (e.g. navigating
    // from /app/explore or /experts). Renders the detail page instantly
    // and turns the network call into a silent background refresh.
    initialData: () => {
      if (!slug) return undefined;
      const lists = queryClient.getQueriesData<PersonWithPlans[]>({ queryKey: ['experts'] });
      for (const [, list] of lists) {
        const hit = Array.isArray(list) ? list.find((p) => p?.slug === slug) : undefined;
        if (hit) return hit;
      }
      return undefined;
    },
    initialDataUpdatedAt: () => {
      const states = queryClient.getQueriesData<PersonWithPlans[]>({ queryKey: ['experts'] });
      let newest = 0;
      for (const [key] of states) {
        const state = queryClient.getQueryState(key);
        if (state?.dataUpdatedAt && state.dataUpdatedAt > newest) newest = state.dataUpdatedAt;
      }
      return newest || undefined;
    },
    enabled: !!slug && !isAuthLoading,
    staleTime: 30_000,
  });
}

/**
 * Single-RPC bundle for /expert/:slug — expert + active+approved plans +
 * subscriber count + my subscribed plan ids in one round trip. Seeds the
 * legacy `['expert', ...]` and `['expert-subscription-stats', ...]` caches
 * so downstream hooks become pure cache hits.
 */
export interface ExpertDetailBundle {
  expert: PersonWithPlans | null;
  subscriberCount: number;
  mySubscribedPlanIds: Set<string>;
}

export function useExpertDetailBundle(slug: string | undefined) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const visibilityMode = getVisibilityMode(user);
  const queryClient = useQueryClient();

  return useQuery<ExpertDetailBundle>({
    queryKey: ['expert-bundle', slug, user?.id ?? 'guest', visibilityMode],
    queryFn: async () => {
      if (!slug) return { expert: null, subscriberCount: 0, mySubscribedPlanIds: new Set() };
      const { data, error } = await supabase.rpc('get_expert_detail_bundle', { _slug: slug });
      if (error) throw error;
      if (!data) return { expert: null, subscriberCount: 0, mySubscribedPlanIds: new Set() };

      const bundle = data as any;
      const expertRow = bundle.expert ? { ...bundle.expert, expert_plans: bundle.plans || [] } : null;
      const expert = expertRow ? mapToPersonWithPlans(expertRow) : null;
      const mine = new Set<string>((bundle.my_subscribed_plan_ids || []) as string[]);
      const count = Number(bundle.subscriber_count || 0);

      // Seed peer caches so useExpert / useExpertSubscriptionStats hit cache.
      if (expert) {
        queryClient.setQueryData(['expert', slug, user?.id ?? 'guest', visibilityMode], expert);
        const planKey = expert.plans.map((p) => p.id).sort().join(',');
        queryClient.setQueryData(
          ['expert-subscription-stats', expert.id, user?.id ?? 'guest', planKey],
          { mySubscribedPlanIds: mine, subscriberCount: count },
        );
      }

      return { expert, subscriberCount: count, mySubscribedPlanIds: mine };
    },
    enabled: !!slug && !isAuthLoading,
    staleTime: 30_000,
  });
}

/**
 * Combined query for /expert/:slug — "my active subscription plan IDs for
 * this expert" + "total active subscriber count". One round trip, shared
 * staleTime, single invalidation key.
 */
export interface ExpertSubscriptionStats {
  mySubscribedPlanIds: Set<string>;
  subscriberCount: number;
}

export function useExpertSubscriptionStats(
  expertId: string | undefined,
  planIds: string[] | undefined,
) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const planKey = (planIds || []).slice().sort().join(',');

  return useQuery<ExpertSubscriptionStats>({
    queryKey: ['expert-subscription-stats', expertId, user?.id ?? 'guest', planKey],
    queryFn: async () => {
      const ids = planIds || [];
      if (ids.length === 0) {
        return { mySubscribedPlanIds: new Set<string>(), subscriberCount: 0 };
      }

      const mineP = user
        ? supabase
            .from('member_subscriptions')
            .select('plan_id')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .in('plan_id', ids)
        : Promise.resolve({ data: [] as { plan_id: string }[] });

      const countP = supabase
        .from('member_subscriptions')
        .select('id', { count: 'exact', head: true })
        .in('plan_id', ids)
        .eq('status', 'active');

      const [{ data: mine }, { count }] = await Promise.all([mineP, countP]);
      return {
        mySubscribedPlanIds: new Set((mine || []).map((r: any) => r.plan_id)),
        subscriberCount: count || 0,
      };
    },
    enabled: !!expertId && !isAuthLoading,
    staleTime: 60_000,
  });
}

