import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type PlanType = 'analyst_signal_l1' | 'analyst_signal_diag_l2' | 'mentor_weekly_journal';
export type ReviewStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export interface AdminPlan {
  id: string;
  expert_id: string;
  name: string;
  description: string | null;
  plan_type: PlanType;
  price_monthly: number;
  price_yearly: number | null;
  features: any;
  is_active: boolean;
  review_status: ReviewStatus;
  review_note: string | null;
}

interface Bundle {
  expert: { id: string; role: 'advisor' | 'mentor' } | null;
  plans: AdminPlan[];
  counts: Record<string, number>;
}

const EMPTY: Bundle = { expert: null, plans: [], counts: {} };

/**
 * admin/Plans 的單一資料來源。原本頁面內串行 3 個 supabase 查詢
 *（experts → expert_plans → member_subscriptions），抽出成 React Query 後
 * staleTime=30s，且 invalidate 可同時打到 ['expert','plans',slug] 讓前台同步。
 */
export function useAdminPlansData(expertSlug: string | undefined) {
  const qc = useQueryClient();
  const queryKey = ['admin', 'plans', expertSlug ?? null] as const;

  const query = useQuery<Bundle>({
    queryKey,
    enabled: !!expertSlug,
    staleTime: 30_000,
    queryFn: async () => {
      const { data: e } = await supabase
        .from('experts')
        .select('id, role')
        .eq('slug', expertSlug!)
        .single();
      if (!e) return EMPTY;
      const expert = { id: e.id, role: e.role as 'advisor' | 'mentor' };
      const { data: ps } = await supabase
        .from('expert_plans')
        .select('*')
        .eq('expert_id', e.id)
        .order('price_monthly');
      const list = (ps || []) as AdminPlan[];
      const counts: Record<string, number> = {};
      if (list.length > 0) {
        const ids = list.map((p) => p.id);
        const { data: subs } = await supabase
          .from('member_subscriptions')
          .select('plan_id')
          .in('plan_id', ids)
          .eq('status', 'active');
        ids.forEach((id) => (counts[id] = 0));
        (subs || []).forEach((s) => {
          counts[s.plan_id] = (counts[s.plan_id] || 0) + 1;
        });
      }
      return { expert, plans: list, counts };
    },
  });

  const bundle = query.data ?? EMPTY;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ['expert', 'plans', expertSlug] });
  };

  return {
    expert: bundle.expert,
    plans: bundle.plans,
    counts: bundle.counts,
    loading: query.isLoading,
    invalidate,
  };
}
