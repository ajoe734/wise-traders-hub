/**
 * 付款→訂閱原子性處理工具
 *
 * ⚠️ 此為單一來源（Single Source of Truth）。
 *    Edge Functions 從此處 import，Vitest 透過 src/lib/paymentProcessor.ts re-export。
 *    禁止在各 Edge Function 中複製實作。
 *
 * 對應 Edge Functions：
 *   acpay-notify    → createSubscriptionAndTransaction
 *   ecpay-callback  → createSubscriptionAndTransaction
 *   confirm-linepay → createSubscriptionAndTransaction
 */

import { calcSplit, loadPaymentDefaults, type SplitInput } from './revenueSplit.ts';

export interface CreateSubAndTxParams {
  userId: string;
  planId: string;
  billingCycle: string;
  amount: number;
  currency: string;
  providerTxId: string;
  providerId: string | null;
  now?: Date;
  // Stage 3 additions (optional for backward compat)
  originalAmount?: number;
  discountAmount?: number;
  discountReason?: string | null;
  attribution?: SplitInput['attribution'] | null;
  productKind?: 'expert_plan' | 'checkup';
  expertId?: string | null;
}

export interface CreateSubAndTxResult {
  subscriptionId: string | null;
  transactionId: string | null;
  error: string | null;
}

export async function createSubscriptionAndTransaction(
  supabase: { from: (table: string) => any },
  params: CreateSubAndTxParams,
): Promise<CreateSubAndTxResult> {
  const now = params.now ?? new Date();
  const expiresAt = new Date(now);
  if (params.billingCycle === 'yearly') {
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  } else {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
  }

  const { data: sub, error: subError } = await supabase
    .from('member_subscriptions')
    .insert({
      user_id: params.userId,
      plan_id: params.planId,
      status: 'active',
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      provider_id: params.providerId,
    })
    .select('id')
    .single();

  if (subError) {
    return { subscriptionId: null, transactionId: null, error: subError.message };
  }

  const { data: tx, error: txError } = await supabase
    .from('payment_transactions')
    .insert({
      amount: params.amount,
      original_amount: params.originalAmount ?? params.amount,
      discount_amount: params.discountAmount ?? 0,
      discount_reason: params.discountReason ?? null,
      attribution: params.attribution ?? null,
      currency: params.currency,
      status: 'paid',
      paid_at: now.toISOString(),
      provider_id: params.providerId,
      provider_tx_id: params.providerTxId,
      subscription_id: sub.id,
    })
    .select('id')
    .single();

  if (txError) {
    return { subscriptionId: sub.id, transactionId: null, error: txError.message };
  }

  // Stage 3: revenue split (best-effort, never block)
  try {
    await writeRevenueSplit(supabase, {
      transactionId: tx.id,
      planId: params.planId,
      expertId: params.expertId ?? null,
      productKind: params.productKind ?? 'expert_plan',
      gross: params.originalAmount ?? params.amount,
      discount: params.discountAmount ?? 0,
      discountReason: params.discountReason ?? null,
      attribution: params.attribution ?? null,
    });
  } catch (e) {
    console.error('writeRevenueSplit failed:', e);
  }

  return { subscriptionId: sub.id, transactionId: tx.id, error: null };
}

export interface RecordExistingSubPaymentParams {
  subscriptionId: string;
  amount: number;
  currency: string;
  providerTxId: string;
  providerId: string | null;
  now?: Date;
  originalAmount?: number;
  discountAmount?: number;
  discountReason?: string | null;
  attribution?: SplitInput['attribution'] | null;
  productKind?: 'expert_plan' | 'checkup';
  planId?: string | null;
  expertId?: string | null;
}

export async function recordPaymentForExistingSubscription(
  supabase: { from: (table: string) => any },
  params: RecordExistingSubPaymentParams,
): Promise<{ error: string | null }> {
  const now = params.now ?? new Date();
  const { data: tx, error } = await supabase
    .from('payment_transactions')
    .insert({
      amount: params.amount,
      original_amount: params.originalAmount ?? params.amount,
      discount_amount: params.discountAmount ?? 0,
      discount_reason: params.discountReason ?? null,
      attribution: params.attribution ?? null,
      currency: params.currency,
      status: 'paid',
      paid_at: now.toISOString(),
      provider_id: params.providerId,
      provider_tx_id: params.providerTxId,
      subscription_id: params.subscriptionId,
    })
    .select('id')
    .single();

  if (!error && tx) {
    try {
      await writeRevenueSplit(supabase, {
        transactionId: tx.id,
        planId: params.planId ?? null,
        expertId: params.expertId ?? null,
        productKind: params.productKind ?? 'expert_plan',
        gross: params.originalAmount ?? params.amount,
        discount: params.discountAmount ?? 0,
        discountReason: params.discountReason ?? null,
        attribution: params.attribution ?? null,
      });
    } catch (e) {
      console.error('writeRevenueSplit failed:', e);
    }
  }

  return { error: error?.message ?? null };
}

export interface WriteSplitParams {
  transactionId: string;
  planId: string | null;
  expertId: string | null;
  productKind: 'expert_plan' | 'checkup';
  gross: number;
  discount: number;
  discountReason: string | null;
  attribution: SplitInput['attribution'] | null;
}

export async function writeRevenueSplit(supabase: any, p: WriteSplitParams) {
  const defaults = await loadPaymentDefaults(supabase);

  // 方案級覆寫：plan_split_overrides[plan_id]（is_active=true）
  let planOverride: { pct_platform: number; pct_expert: number } | null = null;
  if (p.planId && p.productKind === 'expert_plan') {
    const { data } = await supabase
      .from('plan_split_overrides')
      .select('pct_platform, pct_expert')
      .eq('plan_id', p.planId)
      .eq('is_active', true)
      .maybeSingle();
    if (data && data.pct_platform != null && data.pct_expert != null) {
      planOverride = { pct_platform: data.pct_platform, pct_expert: data.pct_expert };
    }
  }

  const split = calcSplit({
    productKind: p.productKind,
    gross: p.gross,
    discount: p.discount,
    discountSource: p.discountReason,
    attribution: p.attribution,
    planOverride,
    defaults,
  });

  await supabase.from('revenue_splits').insert({
    transaction_id: p.transactionId,
    plan_id: p.planId,
    expert_id: p.expertId,
    gross: p.gross,
    discount: p.discount,
    discount_source: p.discountReason,
    net: split.net,
    platform_amount: split.platform_amount,
    expert_amount: split.expert_amount,
    channel_reserve: split.channel_reserve,
    rule_source: split.rule_source,
    rule_snapshot: split.rule_snapshot,
    utm_snapshot: p.attribution || null,
  });
}

