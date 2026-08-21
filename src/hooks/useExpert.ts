import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PersonWithPlans, PlanType, Plan } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveUserId } from '@/hooks/useEffectiveUserId';

/**
 * 重試策略：
 *  - 最多 2 次（共 3 次嘗試），指數退避 400ms / 1.2s
 *  - 對 4xx（含 RLS 401/403、NOT_FOUND 404）不重試 — 重試也只會多打一輪
 *    同樣失敗的請求，徒增載入時間
 *  - 對網路 / 5xx / timeout 才重試
 *
 * 這個策略與 queryClient.ts 的全域 `retry: 1` 互斥（這裡覆蓋），
 * 因為 experts 是公開頁面，使用者對閃爍與卡頓很敏感，需要更積極的重試。
 */
function isTransientError(err: unknown): boolean {
  const e = err as { status?: number; code?: string | number; message?: string } | null;
  if (!e) return true;
  if (typeof e.status === 'number' && e.status >= 400 && e.status < 500) return false;
  // PostgREST 錯誤碼：PGRST116 = 0 rows、42501 = RLS denied
  if (e.code === 'PGRST116' || e.code === '42501') return false;
  return true;
}

const expertRetry = (failureCount: number, error: unknown) =>
  isTransientError(error) && failureCount < 2;
const expertRetryDelay = (attemptIndex: number) => Math.min(400 * 3 ** attemptIndex, 4_000);


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
    // `get_public_experts_list` 不回傳 asset_class；`get_expert_detail_bundle`
    // 回傳整列 → 有值才帶，缺值時前台一律退回通用 cadence 句。
    assetClass: row.asset_class ?? null,
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

/**
 * staleTime convention — keep all expert queries aligned at 5 min.
 *
 * Experts change rarely (admin profile edits). 30s caused background
 * refetches on every tab-switch / route revisit even though the data
 * was effectively identical, defeating the cache seeding below.
 * 5 min matches the global default in `queryClient.ts` so list ⇄ detail
 * navigation stays a pure cache hit within a normal browsing session.
 */
const EXPERT_STALE_MS = 5 * 60 * 1000;

/**
 * Back-propagate a single expert into every cached `['experts', ...]` list,
 * so list revisit after a detail-page fetch shows the fresher row without
 * waiting for refetch. No-op when the slug isn't present in any list.
 */
export function mergeExpertIntoListCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  expert: PersonWithPlans,
) {
  const lists = queryClient.getQueriesData<PersonWithPlans[]>({ queryKey: ['experts'] });
  for (const [key, list] of lists) {
    if (!Array.isArray(list)) continue;
    const idx = list.findIndex((p) => p?.slug === expert.slug);
    if (idx === -1) continue;
    const prev = list[idx];
    // Skip if the cached row is byte-identical (cheap shallow JSON compare
    // — fine for these small objects, and avoids triggering re-renders
    // on every detail-page visit).
    if (JSON.stringify(prev) === JSON.stringify(expert)) continue;
    const next = list.slice();
    next[idx] = expert;
    queryClient.setQueryData(key, next);
  }
}

export function useExperts(opts?: { includeAllStatuses?: boolean }) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const visibilityMode = getVisibilityMode(user, opts);

  return useQuery({
    queryKey: ['experts', user?.id ?? 'guest', visibilityMode],
    queryFn: async () => {
      // 'default' 路徑（訪客 + 一般登入者）走 RPC bundle，省一次 RLS+巢狀 select。
      // tester / privileged 仍需 draft / suspended 列，走原 select * 路徑。
      if (visibilityMode === 'default') {
        const { data, error } = await supabase.rpc('get_public_experts_list');
        if (error) throw error;
        const rows = Array.isArray(data) ? data : [];
        return rows.map(mapToPersonWithPlans);
      }
      const { data, error } = await supabase
        .from('experts')
        .select('*, expert_plans(*)')
        .order('created_at');
      if (error) throw error;
      return filterExpertRows(data || [], visibilityMode).map(mapToPersonWithPlans);
    },
    // default 模式不需要等 auth：訪客與一般登入者拿到的清單一致。
    // tester / privileged 才需要 auth 解析後再發。
    enabled: visibilityMode === 'default' ? true : !isAuthLoading,
    staleTime: EXPERT_STALE_MS,
    retry: expertRetry,
    retryDelay: expertRetryDelay,
    // 失敗的 refetch 不該把畫面打回 loading：保留前一次成功的 list。
    placeholderData: keepPreviousData,
  });
}

export function useExpert(slug: string | undefined, opts?: { includeAllStatuses?: boolean }) {
  const { user } = useAuth();
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

      const expert = mapToPersonWithPlans(visibleRows[0]);
      // Back-propagate to list caches so re-entering /experts or
      // /app/explore shows the latest row immediately.
      mergeExpertIntoListCaches(queryClient, expert);
      return expert;
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
    enabled: !!slug,
    staleTime: EXPERT_STALE_MS,
    retry: expertRetry,
    retryDelay: expertRetryDelay,
    placeholderData: keepPreviousData,
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
  const { user } = useAuth();
  const { userId: effectiveUserId, isViewAs } = useEffectiveUserId();
  const visibilityMode = getVisibilityMode(user);
  const queryClient = useQueryClient();

  return useQuery<ExpertDetailBundle>({
    queryKey: ['expert-bundle', slug, effectiveUserId ?? 'guest', isViewAs ? 'view-as' : 'self', visibilityMode],
    queryFn: async () => {
      if (!slug) return { expert: null, subscriberCount: 0, mySubscribedPlanIds: new Set() };
      const { data, error } = await supabase.rpc('get_expert_detail_bundle', { _slug: slug });
      if (error) throw error;
      if (!data) return { expert: null, subscriberCount: 0, mySubscribedPlanIds: new Set() };

      const bundle = data as any;
      const expertRow = bundle.expert ? { ...bundle.expert, expert_plans: bundle.plans || [] } : null;
      const expert = expertRow ? mapToPersonWithPlans(expertRow) : null;
      let mine = new Set<string>((bundle.my_subscribed_plan_ids || []) as string[]);
      const count = Number(bundle.subscriber_count || 0);

      // View-as override: RPC computes my_subscribed_plan_ids from auth.uid()
      // (the real admin). When acting as another user, ignore RPC's value and
      // query member_subscriptions for the effective user id instead.
      if (isViewAs && effectiveUserId && expert) {
        const planIds = expert.plans.map((p) => p.id);
        if (planIds.length > 0) {
          const nowIso = new Date().toISOString();
          const { data: rows } = await supabase
            .from('member_subscriptions')
            .select('plan_id')
            .eq('user_id', effectiveUserId)
            .eq('status', 'active')
            .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
            .in('plan_id', planIds);
          mine = new Set<string>((rows || []).map((r: any) => r.plan_id));
        } else {
          mine = new Set<string>();
        }
      }

      // Seed peer caches so useExpert / useExpertSubscriptionStats hit cache.
      if (expert) {
        queryClient.setQueryData(['expert', slug, user?.id ?? 'guest', visibilityMode], expert);
        const planKey = expert.plans.map((p) => p.id).sort().join(',');
        queryClient.setQueryData(
          ['expert-subscription-stats', expert.id, effectiveUserId ?? 'guest', isViewAs ? 'view-as' : 'self', planKey],
          { mySubscribedPlanIds: mine, subscriberCount: count },
        );
        // Back-propagate to list caches — keeps /experts and /app/explore
        // consistent when the user landed on a detail page first.
        mergeExpertIntoListCaches(queryClient, expert);
      }

      return { expert, subscriberCount: count, mySubscribedPlanIds: mine };
    },
    enabled: !!slug,
    staleTime: EXPERT_STALE_MS,
    retry: expertRetry,
    retryDelay: expertRetryDelay,
    placeholderData: keepPreviousData,
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
  // useAuth removed: this query is read-only and view-as aware via useEffectiveUserId.
  const { userId: effectiveUserId, isViewAs } = useEffectiveUserId();
  const planKey = (planIds || []).slice().sort().join(',');

  return useQuery<ExpertSubscriptionStats>({
    queryKey: ['expert-subscription-stats', expertId, effectiveUserId ?? 'guest', isViewAs ? 'view-as' : 'self', planKey],
    queryFn: async () => {
      const ids = planIds || [];
      if (ids.length === 0) {
        return { mySubscribedPlanIds: new Set<string>(), subscriberCount: 0 };
      }
      const nowIso = new Date().toISOString();

      const mineP = effectiveUserId
        ? supabase
            .from('member_subscriptions')
            .select('plan_id')
            .eq('user_id', effectiveUserId)
            .eq('status', 'active')
            .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
            .in('plan_id', ids)
        : Promise.resolve({ data: [] as { plan_id: string }[] });

      const countP = supabase
        .from('member_subscriptions')
        .select('id', { count: 'exact', head: true })
        .in('plan_id', ids)
        .eq('status', 'active')
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`);

      const [{ data: mine }, { count }] = await Promise.all([mineP, countP]);
      return {
        mySubscribedPlanIds: new Set((mine || []).map((r: any) => r.plan_id)),
        subscriberCount: count || 0,
      };
    },
    enabled: !!expertId,
    staleTime: 60_000,
  });
}

