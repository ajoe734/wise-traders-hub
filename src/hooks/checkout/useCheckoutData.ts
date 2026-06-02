import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { calcUpgradeProration } from '@/lib/revenueSplit';

export interface DbPlan {
  id: string;
  name: string;
  plan_type: string;
  price_monthly: number;
  price_yearly: number | null;
  description: string | null;
  features: any;
  expert_id: string;
}

export interface DbExpert {
  id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
  role: string;
}

export interface PaymentProvider {
  id: string;
  display_name: string;
  provider_type: string;
  is_active: boolean;
  is_default: boolean;
  env?: string | null;
}

/**
 * Loads checkout context: plan, expert, payment providers, already-subscribed
 * status, and (yearly cycle only) upgrade proration credit when an active
 * monthly sub exists for the same plan.
 *
 * Returns stable shape so the consumer keeps using local setState for billing
 * cycle, selected provider, etc.
 */
export function useCheckoutData(params: {
  planId: string | undefined;
  slug: string | undefined;
  userId: string | undefined;
  billingCycle: 'monthly' | 'yearly';
}) {
  const { planId, slug, userId, billingCycle } = params;

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<DbPlan | null>(null);
  const [expert, setExpert] = useState<DbExpert | null>(null);
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState<string | null>(null);
  const [alreadySubscribed, setAlreadySubscribed] = useState(false);

  const [upgradeCredit, setUpgradeCredit] = useState(0);
  const [upgradeFromSubId, setUpgradeFromSubId] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!planId || !slug) return;
      const [planRes, providerRes, subsRes] = await Promise.all([
        supabase
          .from('expert_plans')
          .select('id, name, plan_type, price_monthly, price_yearly, description, features, expert_id')
          .eq('id', planId)
          .single(),
        supabase
          .from('payment_providers_safe')
          .select('id, display_name, provider_type, is_active, is_default, env')
          .eq('is_active', true)
          .order('is_default', { ascending: false }),
        userId
          ? supabase
              .from('member_subscriptions')
              .select('id')
              .eq('user_id', userId)
              .eq('plan_id', planId)
              .eq('status', 'active')
          : Promise.resolve({ data: null as { id: string }[] | null }),
      ]);

      const planData = planRes.data;
      if (!planData) {
        setLoading(false);
        return;
      }
      setPlan(planData);

      const { data: expertData } = await supabase
        .from('experts')
        .select('id, name, slug, avatar_url, role')
        .eq('id', planData.expert_id)
        .single();
      setExpert(expertData);

      if (providerRes.data && providerRes.data.length > 0) {
        setProviders(providerRes.data);
        setDefaultProviderId(providerRes.data[0].id);
      }

      if (subsRes.data && subsRes.data.length > 0) {
        setAlreadySubscribed(true);
      }

      setLoading(false);
    };

    fetchData();
  }, [planId, slug, userId]);

  useEffect(() => {
    (async () => {
      if (!userId || billingCycle !== 'yearly' || !plan?.price_yearly) {
        setUpgradeCredit(0); setUpgradeFromSubId(null); return;
      }
      const { data: existing } = await supabase
        .from('member_subscriptions')
        .select('id, started_at, expires_at')
        .eq('user_id', userId)
        .eq('plan_id', plan.id)
        .eq('status', 'active')
        .maybeSingle();
      if (!existing) { setUpgradeCredit(0); setUpgradeFromSubId(null); return; }
      const startedAt = new Date(existing.started_at);
      const expiresAt = new Date(existing.expires_at);
      const spanDays = (expiresAt.getTime() - startedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (spanDays > 35) { setUpgradeCredit(0); setUpgradeFromSubId(null); return; }
      const { creditAmount } = calcUpgradeProration({
        monthlyPrice: plan.price_monthly,
        yearlyPrice: plan.price_yearly,
        startedAt, expiresAt,
      });
      setUpgradeCredit(creditAmount);
      setUpgradeFromSubId(existing.id);
    })();
  }, [userId, billingCycle, plan?.id, plan?.price_monthly, plan?.price_yearly]);

  return {
    loading,
    plan,
    expert,
    providers,
    defaultProviderId,
    alreadySubscribed,
    upgradeCredit,
    upgradeFromSubId,
  };
}
