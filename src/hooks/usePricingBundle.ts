import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveUserId } from '@/hooks/useEffectiveUserId';
import type { CheckupPlan } from './useCheckupPlans';

export interface CheckupQuota {
  tier: 'free' | 'basic' | 'pro';
  period: 'week' | 'month';
  limit: number;
  used: number;
  remaining: number;
  resets_at: string;
}

export interface PricingBundle {
  minAdvisorPrice: number | null;
  minMentorPrice: number | null;
  checkupPlans: CheckupPlan[];
  checkupQuota: CheckupQuota | null;
}

/**
 * 一次撈完 /pricing 所需資料：
 *  - 最低跟單派／修煉派月費
 *  - AI 健檢方案
 *  - 當前用戶健檢額度（若有登入）
 *
 * 取代原本三~四個獨立 round-trip（expert_plans 整表抓 + checkup_plans
 * + auth.getSession + check_checkup_quota）。
 */
export function usePricingBundle() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const userId = user?.id ?? null;

  return useQuery<PricingBundle>({
    queryKey: ['pricing-bundle', userId ?? 'guest'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_pricing_bundle', {
        _user_id: userId,
      });
      if (error) throw error;
      const b = (data ?? {}) as any;
      return {
        minAdvisorPrice: b.min_advisor_price ?? null,
        minMentorPrice: b.min_mentor_price ?? null,
        checkupPlans: (b.checkup_plans ?? []).map((p: any) => ({
          ...p,
          features: Array.isArray(p.features) ? p.features : [],
        })),
        checkupQuota: b.checkup_quota ?? null,
      };
    },
    // 不等 auth：訪客也能立刻取得 plans / 最低價，登入者後續會自動 re-fetch。
    enabled: !isAuthLoading || userId === null,
    staleTime: 60_000,
  });
}
