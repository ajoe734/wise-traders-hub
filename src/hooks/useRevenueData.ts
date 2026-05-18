import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type RevenuePreset = 'this_month' | 'last_month' | 'last_3m' | 'ytd';

export const providerTypeLabels: Record<string, string> = {
  acpay: 'ACpay',
  ecpay: '綠界',
  newebpay: '藍新',
  line_pay: 'LINE Pay',
};

export function getRangePreset(preset: RevenuePreset): { from: Date; to: Date } {
  const now = new Date();
  if (preset === 'this_month') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  }
  if (preset === 'last_month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return { from, to };
  }
  if (preset === 'last_3m') {
    return { from: new Date(now.getFullYear(), now.getMonth() - 2, 1), to: now };
  }
  return { from: new Date(now.getFullYear(), 0, 1), to: now };
}

interface RevenueBundle {
  splits: any[];
  transactions: any[];
  remittance: any[];
  subscriptions: any[];
  checkupSubs: any[];
  experts: any[];
  plans: any[];
  checkupPlans: any[];
  profiles: any[];
  providers: any[];
  paidTxTotalCount: number;
  splitTotalCount: number;
}

const EMPTY: RevenueBundle = {
  splits: [], transactions: [], remittance: [], subscriptions: [], checkupSubs: [],
  experts: [], plans: [], checkupPlans: [], profiles: [], providers: [],
  paidTxTotalCount: 0, splitTotalCount: 0,
};

/**
 * 對帳中心資料層 hook：把 12 個並行 supabase 查詢、6 個 lookup map、
 * 8 個衍生聚合（overview / monthTrend / sourceBreakdown / txMerged /
 * expertPayouts / splitsByExpert / checkupOverview / checkupTrend）
 * 全部封裝在此，UI 端只負責呈現與本地篩選 state。
 *
 * Single snapshot keyed by `preset`。30s staleTime；
 * 退款等 mutation 後呼叫 `invalidate()` 重新拉取所有 preset。
 */
export function useRevenueData(preset: RevenuePreset) {
  const queryClient = useQueryClient();
  const range = useMemo(() => getRangePreset(preset), [preset]);

  const { data } = useQuery<RevenueBundle>({
    queryKey: ['company', 'revenue', preset],
    staleTime: 30_000,
    queryFn: async () => {
      const fromIso = range.from.toISOString();
      const toIso = range.to.toISOString();

      const [
        sp, tx, rm, sub, csub, exp, pl, cpl, prof, prov, txCount, spCount,
      ] = await Promise.all([
        supabase.from('revenue_splits').select('*')
          .gte('created_at', fromIso).lte('created_at', toIso)
          .order('created_at', { ascending: false }),
        supabase.from('payment_transactions').select('*')
          .gte('created_at', fromIso).lte('created_at', toIso)
          .order('created_at', { ascending: false }),
        supabase.from('remittance_orders').select('*')
          .gte('created_at', fromIso).lte('created_at', toIso)
          .order('created_at', { ascending: false }),
        supabase.from('member_subscriptions').select('*').order('started_at', { ascending: false }),
        supabase.from('checkup_subscriptions').select('*').order('started_at', { ascending: false }),
        supabase.from('experts').select('id, name, role, slug'),
        supabase.from('expert_plans').select('id, name, expert_id, plan_type, price_monthly, price_yearly'),
        supabase.from('checkup_plans').select('id, name, tier, price_monthly, price_yearly'),
        supabase.from('profiles').select('user_id, display_name'),
        supabase.from('payment_providers').select('id, display_name, provider_type'),
        supabase.from('payment_transactions').select('*', { count: 'exact', head: true }).eq('status', 'paid'),
        supabase.from('revenue_splits').select('*', { count: 'exact', head: true }),
      ]);

      return {
        splits: sp.data || [],
        transactions: tx.data || [],
        remittance: rm.data || [],
        subscriptions: sub.data || [],
        checkupSubs: csub.data || [],
        experts: exp.data || [],
        plans: pl.data || [],
        checkupPlans: cpl.data || [],
        profiles: prof.data || [],
        providers: prov.data || [],
        paidTxTotalCount: txCount.count || 0,
        splitTotalCount: spCount.count || 0,
      };
    },
  });

  const bundle = data ?? EMPTY;
  const {
    splits, transactions, remittance, subscriptions, checkupSubs,
    experts, plans, checkupPlans, profiles, providers,
    paidTxTotalCount, splitTotalCount,
  } = bundle;

  // Lookup maps
  const expertMap = useMemo<Record<string, any>>(() => Object.fromEntries(experts.map((e: any) => [e.id, e])), [experts]);
  const planMap = useMemo<Record<string, any>>(() => Object.fromEntries(plans.map((p: any) => [p.id, p])), [plans]);
  const checkupPlanMap = useMemo<Record<string, any>>(() => Object.fromEntries(checkupPlans.map((p: any) => [p.id, p])), [checkupPlans]);
  const profileMap = useMemo<Record<string, any>>(() => Object.fromEntries(profiles.map((p: any) => [p.user_id, p])), [profiles]);
  const providerMap = useMemo<Record<string, any>>(() => Object.fromEntries(providers.map((p: any) => [p.id, p])), [providers]);
  const subMap = useMemo<Record<string, any>>(() => Object.fromEntries(subscriptions.map((s: any) => [s.id, s])), [subscriptions]);

  // 總覽聚合
  const overview = useMemo(() => {
    const sum = (arr: any[], key: string) => arr.reduce((a, b) => a + (b[key] || 0), 0);
    const expertSplits = splits.filter((s: any) => s.expert_id);
    const checkupSplits = splits.filter((s: any) => !s.expert_id && !s.plan_id);
    const refundedTx = transactions.filter((t: any) => t.status === 'refunded');
    return {
      gross: sum(splits, 'gross'),
      discount: sum(splits, 'discount'),
      net: sum(splits, 'net'),
      platformAmount: sum(splits, 'platform_amount'),
      expertAmount: sum(splits, 'expert_amount'),
      subscriptionGross: sum(expertSplits, 'gross'),
      checkupGross: sum(checkupSplits, 'gross'),
      refundAmount: refundedTx.reduce((a: number, b: any) => a + Math.abs(b.amount || 0), 0),
      refundCount: refundedTx.length,
      splitsCount: splits.length,
    };
  }, [splits, transactions]);

  const monthTrend = useMemo(() => {
    const map: Record<string, { gross: number; platform: number; expert: number }> = {};
    splits.forEach((s: any) => {
      const d = new Date(s.created_at);
      const k = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!map[k]) map[k] = { gross: 0, platform: 0, expert: 0 };
      map[k].gross += s.gross || 0;
      map[k].platform += s.platform_amount || 0;
      map[k].expert += s.expert_amount || 0;
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v }));
  }, [splits]);

  const sourceBreakdown = useMemo(() => {
    const buckets: Record<string, number> = {};
    transactions.filter((t: any) => t.status === 'paid').forEach((t: any) => {
      const p = providerMap[t.provider_id];
      const label = p ? (providerTypeLabels[p.provider_type] || p.display_name) : '其他';
      buckets[label] = (buckets[label] || 0) + (t.amount || 0);
    });
    remittance.filter((r: any) => r.status === 'confirmed').forEach((r: any) => {
      buckets['匯款'] = (buckets['匯款'] || 0) + (r.amount || 0);
    });
    return Object.entries(buckets).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [transactions, remittance, providerMap]);

  const txMerged = useMemo(() => {
    const list: any[] = [];
    transactions.forEach((t: any) => {
      const sub = t.subscription_id ? subMap[t.subscription_id] : null;
      const plan = sub ? planMap[sub.plan_id] : null;
      const exp = plan ? expertMap[plan.expert_id] : null;
      const buyer = sub ? profileMap[sub.user_id] : null;
      const prov = providerMap[t.provider_id];
      list.push({
        kind: 'card',
        id: t.id,
        created_at: t.created_at,
        paid_at: t.paid_at,
        amount: t.amount,
        original_amount: t.original_amount,
        discount: t.discount_amount,
        discount_reason: t.discount_reason,
        status: t.status,
        provider_label: prov ? (providerTypeLabels[prov.provider_type] || prov.display_name) : '健檢/未知',
        product: plan ? `${plan.name}（訂閱）` : '健檢/未綁訂',
        buyer_name: buyer?.display_name || '-',
        expert_name: exp?.name || (plan ? '-' : '健檢'),
        provider_tx_id: t.provider_tx_id,
        raw: t,
      });
    });
    remittance.forEach((r: any) => {
      const buyer = profileMap[r.user_id];
      const plan = r.plan_id ? planMap[r.plan_id] : null;
      const cplan = r.checkup_plan_id ? checkupPlanMap[r.checkup_plan_id] : null;
      const exp = plan ? expertMap[plan.expert_id] : null;
      list.push({
        kind: 'remit',
        id: r.id,
        created_at: r.created_at,
        paid_at: r.confirmed_at,
        amount: r.amount,
        original_amount: r.original_amount,
        discount: r.discount_amount,
        discount_reason: r.discount_reason,
        status: r.status === 'confirmed' ? 'paid' : r.status,
        provider_label: '匯款',
        product: plan ? `${plan.name}（訂閱）` : (cplan ? `${cplan.name}（健檢）` : '匯款'),
        buyer_name: buyer?.display_name || r.payer_name || '-',
        expert_name: exp?.name || (cplan ? '健檢' : '-'),
        provider_tx_id: `匯款末五碼 ${r.last5}`,
        raw: r,
      });
    });
    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [transactions, remittance, subMap, planMap, expertMap, profileMap, providerMap, checkupPlanMap]);

  const expertPayouts = useMemo(() => {
    const map: Record<string, { count: number; gross: number; discount: number; net: number; platform: number; expert_amount: number }> = {};
    splits.filter((s: any) => s.expert_id).forEach((s: any) => {
      if (!map[s.expert_id]) map[s.expert_id] = { count: 0, gross: 0, discount: 0, net: 0, platform: 0, expert_amount: 0 };
      const m = map[s.expert_id];
      m.count += 1;
      m.gross += s.gross || 0;
      m.discount += s.discount || 0;
      m.net += s.net || 0;
      m.platform += s.platform_amount || 0;
      m.expert_amount += s.expert_amount || 0;
    });
    return Object.entries(map).map(([eid, v]) => ({
      expert_id: eid,
      expertInfo: expertMap[eid] as any,
      ...v,
    })).sort((a, b) => b.expert_amount - a.expert_amount);
  }, [splits, expertMap]);

  const splitsByExpert = useMemo(() => {
    const map: Record<string, any[]> = {};
    splits.filter((s: any) => s.expert_id).forEach((s: any) => {
      if (!map[s.expert_id]) map[s.expert_id] = [];
      map[s.expert_id].push(s);
    });
    return map;
  }, [splits]);

  const checkupOverview = useMemo(() => {
    const cs = splits.filter((s: any) => !s.expert_id && !s.plan_id);
    return {
      gross: cs.reduce((a: number, b: any) => a + (b.gross || 0), 0),
      discount: cs.reduce((a: number, b: any) => a + (b.discount || 0), 0),
      net: cs.reduce((a: number, b: any) => a + (b.net || 0), 0),
      count: cs.length,
    };
  }, [splits]);

  const checkupTrend = useMemo(() => {
    const map: Record<string, number> = {};
    splits.filter((s: any) => !s.expert_id && !s.plan_id).forEach((s: any) => {
      const d = new Date(s.created_at);
      const k = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      map[k] = (map[k] || 0) + (s.gross || 0);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([month, gross]) => ({ month, gross }));
  }, [splits]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['company', 'revenue'] });

  return {
    // raw
    splits, transactions, remittance, subscriptions, checkupSubs,
    experts, plans, checkupPlans, profiles, providers,
    paidTxTotalCount, splitTotalCount,
    // maps
    expertMap, planMap, checkupPlanMap, profileMap, providerMap, subMap,
    // aggregates
    overview, monthTrend, sourceBreakdown, txMerged,
    expertPayouts, splitsByExpert, checkupOverview, checkupTrend,
    // helpers
    range, invalidate,
  };
}
