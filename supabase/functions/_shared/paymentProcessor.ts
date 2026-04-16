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

export interface CreateSubAndTxParams {
  userId: string;
  planId: string;
  billingCycle: string;
  amount: number;
  currency: string;
  providerTxId: string;
  providerId: string | null;
  now?: Date;
}

export interface CreateSubAndTxResult {
  subscriptionId: string | null;
  transactionId: string | null;
  error: string | null;
}

/**
 * 順序建立 member_subscriptions → payment_transactions
 *
 * ⚠️ 一方向性保證（非 DB transaction）：
 *   ✓ 若 member_subscriptions INSERT 失敗 → payment_transactions 不建立（防孤立交易紀錄）
 *   ✗ 若 payment_transactions INSERT 失敗 → member_subscriptions 已寫入、不自動回滾
 *     （Supabase Edge Functions 無內建 transaction；需外層重試或人工補單）
 */
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

  // Step 1: 建立訂閱
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
    // 訂閱建立失敗 → 不建立 payment_transactions，維持資料一致性
    return { subscriptionId: null, transactionId: null, error: subError.message };
  }

  // Step 2: 建立交易紀錄（只在訂閱成功後執行）
  const { data: tx, error: txError } = await supabase
    .from('payment_transactions')
    .insert({
      amount: params.amount,
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

  return { subscriptionId: sub.id, transactionId: tx.id, error: null };
}

export interface RecordExistingSubPaymentParams {
  subscriptionId: string;
  amount: number;
  currency: string;
  providerTxId: string;
  providerId: string | null;
  now?: Date;
}

/**
 * 為「已有有效訂閱」的付款建立 payment_transactions 紀錄
 * 訂閱已存在，不再建立 member_subscriptions
 */
export async function recordPaymentForExistingSubscription(
  supabase: { from: (table: string) => any },
  params: RecordExistingSubPaymentParams,
): Promise<{ error: string | null }> {
  const now = params.now ?? new Date();
  const { error } = await supabase
    .from('payment_transactions')
    .insert({
      amount: params.amount,
      currency: params.currency,
      status: 'paid',
      paid_at: now.toISOString(),
      provider_id: params.providerId,
      provider_tx_id: params.providerTxId,
      subscription_id: params.subscriptionId,
    })
    .select('id')
    .single();

  return { error: error?.message ?? null };
}
