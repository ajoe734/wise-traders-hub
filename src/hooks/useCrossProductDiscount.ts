import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { calcCrossDiscount } from '@/lib/revenueSplit';

const DEFAULT_RULES = {
  has_checkup_basic_discount_on_expert: 100,
  has_checkup_pro_discount_on_expert: 200,
  has_expert_discount_on_checkup_basic: 100,
  has_expert_discount_on_checkup_pro: 200,
};

export interface CrossDiscountResult {
  amount: number;
  reason: string | null;
  loading: boolean;
}

/**
 * Calculate cross-product discount based on user's existing active subscriptions.
 */
export function useCrossProductDiscount(args: {
  productKind: 'expert_plan' | 'checkup';
  checkupTier?: 'basic' | 'pro' | null;
}): CrossDiscountResult {
  const { user } = useAuth();
  const [state, setState] = useState<CrossDiscountResult>({ amount: 0, reason: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) {
        setState({ amount: 0, reason: null, loading: false });
        return;
      }
      const [{ data: settings }, { data: expertSubs }, { data: ckSubs }] = await Promise.all([
        (supabase.from as any)('payment_settings_safe').select('value').eq('key', 'cross_discounts').maybeSingle(),
        supabase.from('member_subscriptions').select('id').eq('user_id', user.id).eq('status', 'active'),
        supabase
          .from('checkup_subscriptions')
          .select('id, plan_id, checkup_plans(tier)')
          .eq('user_id', user.id)
          .eq('status', 'active'),
      ]);

      const rules = (settings?.value as any) || DEFAULT_RULES;
      const hasActiveExpert = (expertSubs?.length || 0) > 0;
      let activeCheckupTier: 'basic' | 'pro' | null = null;
      if (ckSubs && ckSubs.length > 0) {
        const tiers = ckSubs.map((r: any) => r.checkup_plans?.tier).filter(Boolean);
        if (tiers.includes('pro')) activeCheckupTier = 'pro';
        else if (tiers.includes('basic')) activeCheckupTier = 'basic';
      }

      const result = calcCrossDiscount({
        productKind: args.productKind,
        checkupTier: args.checkupTier ?? null,
        hasActiveExpert,
        activeCheckupTier,
        rules,
      });
      if (!cancelled) setState({ ...result, loading: false });
    })();
    return () => { cancelled = true; };
  }, [user?.id, args.productKind, args.checkupTier]);

  return state;
}
