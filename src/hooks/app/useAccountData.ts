import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveUserId } from '@/hooks/useEffectiveUserId';
import { cancelSubscriptionInDB } from '@/lib/cancelSubscription';
import type { DbSubscription, ExpertLineRow } from '@/pages/_appAccount/types';

export function useAccountData() {
  const { user } = useAuth();
  const { userId: effectiveUserId, isViewAs } = useEffectiveUserId();
  const [subscriptions, setSubscriptions] = useState<DbSubscription[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [pendingRemitCount, setPendingRemitCount] = useState(0);
  const [subscribedExpertIds, setSubscribedExpertIds] = useState<Set<string>>(new Set());
  const [allAdvisors, setAllAdvisors] = useState<ExpertLineRow[]>([]);
  const [allMentors, setAllMentors] = useState<ExpertLineRow[]>([]);

  const fetchSubscriptions = useCallback(async () => {
    if (!effectiveUserId) return;
    setLoadingSubs(true);

    const { data: subs } = await supabase
      .from('member_subscriptions')
      .select('id, plan_id, status, auto_renew, billing_cycle, started_at, expires_at, canceled_at')
      .eq('user_id', effectiveUserId)
      .order('created_at', { ascending: false });

    if (!subs || subs.length === 0) {
      setSubscriptions([]);
      setSubscribedExpertIds(new Set());
      setLoadingSubs(false);
      return;
    }

    const planIds = [...new Set(subs.map(s => s.plan_id))];
    const { data: plans } = await supabase
      .from('expert_plans')
      .select('id, name, plan_type, price_monthly, price_yearly, expert_id')
      .in('id', planIds);

    if (!plans) { setLoadingSubs(false); return; }

    const expertIds = [...new Set(plans.map(p => p.expert_id))];
    const { data: experts } = await supabase
      .from('experts')
      .select('id, slug, name, role, avatar_url')
      .in('id', expertIds);

    const planMap = new Map(plans.map(p => [p.id, p]));
    const expertMap = new Map((experts || []).map(e => [e.id, e]));

    const enriched: DbSubscription[] = subs.map(sub => {
      const plan = planMap.get(sub.plan_id);
      const expert = plan ? expertMap.get(plan.expert_id) : null;
      return {
        ...sub,
        billing_cycle: (sub as any).billing_cycle === 'yearly' ? 'yearly' : 'monthly',
        plan: plan
          ? { id: plan.id, name: plan.name, plan_type: plan.plan_type, price_monthly: plan.price_monthly, price_yearly: plan.price_yearly }
          : { id: '', name: '未知方案', plan_type: '', price_monthly: 0, price_yearly: null },
        expert: expert
          ? { id: expert.id, slug: expert.slug, name: expert.name, role: expert.role, avatar_url: expert.avatar_url }
          : { id: '', slug: '', name: '未知', role: '', avatar_url: null },
      };
    }).filter(sub => {
      const expert = sub.expert;
      if (!expert.id) return true;
      const fullExpert = (experts || []).find(e => e.id === expert.id);
      return !!fullExpert;
    });

    setSubscriptions(enriched);
    // Manual-renewal-model constitution: a subscription is valid only when
    // status='active' AND expires_at > now. expire-subscriptions cron is best-effort;
    // never trust status alone — always cross-check expires_at.
    const nowMs = Date.now();
    setSubscribedExpertIds(new Set(
      enriched
        .filter(s => s.status === 'active' && s.expert.id && s.expires_at && new Date(s.expires_at).getTime() > nowMs)
        .map(s => s.expert.id)
    ));
    setLoadingSubs(false);
  }, [effectiveUserId]);

  const fetchExperts = useCallback(async () => {
    if (!user) return;
    const expectedStatus = (!isViewAs && user.isTester) ? 'draft' : 'active';
    const { data: experts } = await supabase
      .from('experts')
      .select('id, slug, name, role, avatar_url, status')
      .eq('status', expectedStatus);

    if (!experts) return;

    const expertIds = experts.map(e => e.id);
    const { data: channels } = await supabase
      .from('expert_line_channels_public')
      .select('expert_id, line_oa_id, qr_code_url, channel_name')
      .in('expert_id', expertIds);

    const channelMap = new Map((channels || []).map((c: any) =>
      [c.expert_id, { line_oa_id: c.line_oa_id, qr_code_url: c.qr_code_url, channel_name: c.channel_name }]));

    const enriched: ExpertLineRow[] = experts.map(e => ({
      ...e,
      line_oa_id: channelMap.get(e.id)?.line_oa_id || null,
      qr_code_url: channelMap.get(e.id)?.qr_code_url || null,
      channel_name: channelMap.get(e.id)?.channel_name || null,
    }));

    setAllAdvisors(enriched.filter(e => e.role === 'advisor'));
    setAllMentors(enriched.filter(e => e.role === 'mentor'));
  }, [user]);

  useEffect(() => {
    if (!effectiveUserId) return;
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from('remittance_orders')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', effectiveUserId)
        .eq('status', 'awaiting_info');
      if (!cancelled) setPendingRemitCount(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [effectiveUserId]);

  useEffect(() => {
    if (!effectiveUserId) return;
    fetchSubscriptions();
    fetchExperts();
  }, [effectiveUserId, fetchSubscriptions, fetchExperts]);

  const handleCancelSubscription = useCallback(async (subId: string) => {
    setCancelingId(subId);
    try {
      const sub = subscriptions.find(s => s.id === subId);
      if (!sub) return;

      const { error: cancelError, refund } = await cancelSubscriptionInDB(supabase, sub, user!.id);
      if (cancelError) throw new Error(cancelError);

      if (refund.refundAmount > 0) {
        try {
          await supabase.functions.invoke('process-refund', {
            body: {
              subscription_id: subId,
              refund_amount: refund.refundAmount,
              remaining_months: refund.remainingMonths,
              original_amount: refund.originalAmount,
              monthly_price: refund.monthlyPrice,
            },
          });
        } catch (refundErr) {
          console.error('Refund record failed (non-critical):', refundErr);
        }
      }

      await fetchSubscriptions();

      if (refund && refund.refundAmount > 0) {
        toast.success(`已取消訂閱，服務持續至本月底`, {
          description: `年繳退款 NT$ ${refund.refundAmount.toLocaleString()}（${refund.remainingMonths} 個月）`,
        });
      } else {
        toast.success('已取消訂閱，服務持續至本月底', {
          description: '月繳無退款，本月服務不受影響',
        });
      }
    } catch (err: any) {
      console.error('Cancel subscription error:', err);
      toast.error('取消訂閱失敗，請稍後再試');
    } finally {
      setCancelingId(null);
    }
  }, [subscriptions, user, fetchSubscriptions]);

  return {
    subscriptions, loadingSubs, cancelingId,
    pendingRemitCount, subscribedExpertIds,
    allAdvisors, allMentors,
    handleCancelSubscription,
  };
}
