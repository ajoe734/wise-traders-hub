/**
 * 定期扣款成功後延長訂閱、付款失敗記錄、逾期失敗訂閱自動取消
 *
 * ⚠️ 此為單一來源（Single Source of Truth）。
 *    Edge Functions 從此處 import，Vitest 透過 src/lib/subscriptionRenewal.ts re-export。
 *    禁止在各 Edge Function 中複製實作。
 *
 * 對應 Edge Functions：
 *   acpay-recurring-notify       → extendSubscriptionExpiry
 *   notify-payment-failure       → recordPaymentFailureInDB
 *   auto-cancel-failed-renewals  → processRenewalCancellations
 */

// ── extendSubscriptionExpiry ──────────────────────────────────────────────────

export interface ExtendSubscriptionExpiryParams {
  userId: string;
  planId: string;
  billingCycle: string; // "monthly" | "yearly"
  now?: Date;
}

export interface ExtendSubscriptionExpiryResult {
  subscriptionId: string | null;
  newExpiresAt: string | null;
  error: string | null;
}

/**
 * 定期扣款成功後延長訂閱到期日：
 *   月繳 → expires_at +1 month
 *   年繳 → expires_at +1 year
 */
export async function extendSubscriptionExpiry(
  supabase: { from: (table: string) => any },
  params: ExtendSubscriptionExpiryParams,
): Promise<ExtendSubscriptionExpiryResult> {
  const now = params.now ?? new Date();
  const { userId, planId, billingCycle } = params;

  const { data: activeSub, error: findErr } = await supabase
    .from('member_subscriptions')
    .select('id, expires_at')
    .eq('user_id', userId)
    .eq('plan_id', planId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (findErr || !activeSub) {
    return { subscriptionId: null, newExpiresAt: null, error: findErr?.message ?? 'No active subscription found' };
  }

  const currentExpiry = new Date(activeSub.expires_at ?? now);
  const newExpiry = new Date(currentExpiry);
  if (billingCycle === 'yearly') {
    newExpiry.setFullYear(newExpiry.getFullYear() + 1);
  } else {
    newExpiry.setMonth(newExpiry.getMonth() + 1);
  }

  const { error: updateErr } = await supabase
    .from('member_subscriptions')
    .update({ expires_at: newExpiry.toISOString() })
    .eq('id', activeSub.id);

  if (updateErr) {
    return { subscriptionId: activeSub.id, newExpiresAt: null, error: updateErr.message };
  }

  return { subscriptionId: activeSub.id, newExpiresAt: newExpiry.toISOString(), error: null };
}

// ── recordPaymentFailureInDB ──────────────────────────────────────────────────

export interface RecordPaymentFailureParams {
  userId: string;
  planId: string;
  amount: number;
  currency?: string;
  provider: string;
  providerId: string | null;
  isRenewal: boolean;
  lineSent: boolean;
  emailSent: boolean;
  errorDetail?: string | null;
}

/**
 * 付款失敗後寫入 DB：
 *   1. payment_transactions（status: "failed"）
 *   2. audit_logs（action: "payment_failure_notification"）
 */
export async function recordPaymentFailureInDB(
  supabase: { from: (table: string) => any },
  params: RecordPaymentFailureParams,
): Promise<{ error: string | null }> {
  const {
    userId, planId, amount, currency = 'TWD', provider, providerId,
    isRenewal, lineSent, emailSent, errorDetail,
  } = params;

  const { error: txError } = await supabase
    .from('payment_transactions')
    .insert({
      amount,
      currency,
      status: 'failed',
      provider_id: providerId,
      provider_tx_id: `FAILED-${Date.now()}`,
    })
    .select('id')
    .single();

  const { error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      action: 'payment_failure_notification',
      actor_id: userId,
      target_id: planId,
      target_type: 'plan',
      detail: { provider, amount, isRenewal, lineSent, emailSent, errorDetail: errorDetail ?? null },
    })
    .select('id')
    .single();

  return { error: txError?.message ?? auditError?.message ?? null };
}

// ── calcAutoCancelDeadlineUTC ─────────────────────────────────────────────────

/**
 * 計算自動取消截止時間（UTC）：
 *   若當前台灣時間 >= 15:30 → 截止為今日 15:30 TWD（UTC 07:30）
 *   若當前台灣時間 <  15:30 → 截止為昨日 15:30 TWD（UTC 07:30）
 *
 * 使用 setUTC* 方法，與執行環境時區無關。
 */
export function calcAutoCancelDeadlineUTC(now: Date): Date {
  const nowTW = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const deadlineTW = new Date(nowTW);
  deadlineTW.setUTCHours(15, 30, 0, 0);
  if (nowTW < deadlineTW) {
    deadlineTW.setUTCDate(deadlineTW.getUTCDate() - 1);
  }
  return new Date(deadlineTW.getTime() - 8 * 60 * 60 * 1000);
}

// ── filterRenewalFailures ─────────────────────────────────────────────────────

/**
 * 從 audit_logs 查詢結果中篩選 detail.isRenewal === true 的記錄
 */
export function filterRenewalFailures(logs: any[]): any[] {
  return logs.filter((log: any) => log.detail?.isRenewal === true);
}

// ── processRenewalCancellations ───────────────────────────────────────────────

export interface RenewalFailureLog {
  actor_id: string;
  target_id: string;
  created_at: string;
  detail: { isRenewal?: boolean; [key: string]: any };
}

export interface ProcessRenewalCancellationsResult {
  checked: number;
  canceled: number;
}

/**
 * 針對已篩選的逾期續扣失敗記錄，逐一執行：
 *   1. 確認訂閱仍為 active 且未手動取消
 *   2. 確認失敗後無成功恢復付款
 *   3. 兩條件成立 → 自動取消訂閱並建立 audit_log
 */
export async function processRenewalCancellations(
  supabase: { from: (table: string) => any },
  renewalFailures: RenewalFailureLog[],
  now: Date,
): Promise<ProcessRenewalCancellationsResult> {
  if (renewalFailures.length === 0) {
    return { checked: 0, canceled: 0 };
  }

  // 計算本月底（台灣時間，UTC+8）；使用 setUTC* 與時區無關
  const nowTW = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const endOfMonthTW = new Date(nowTW);
  endOfMonthTW.setUTCMonth(endOfMonthTW.getUTCMonth() + 1, 0);
  endOfMonthTW.setUTCHours(23, 59, 59, 999);
  const endOfMonthUTC = new Date(endOfMonthTW.getTime() - 8 * 60 * 60 * 1000);

  let canceledCount = 0;

  for (const log of renewalFailures) {
    const userId = log.actor_id;
    const planId = log.target_id;
    if (!userId || !planId) continue;

    // 確認訂閱仍為 active（未手動取消）
    const { data: activeSub } = await supabase
      .from('member_subscriptions')
      .select('id, plan_id, canceled_at')
      .eq('user_id', userId)
      .eq('plan_id', planId)
      .eq('status', 'active')
      .is('canceled_at', null)
      .maybeSingle();

    if (!activeSub) continue;

    // 確認失敗後是否有成功恢復付款
    const { data: successPayments } = await supabase
      .from('payment_transactions')
      .select('id')
      .eq('subscription_id', activeSub.id)
      .eq('status', 'paid')
      .gte('created_at', log.created_at)
      .limit(1);

    if (successPayments && successPayments.length > 0) continue;

    // 自動取消訂閱
    const { error: updateErr } = await supabase
      .from('member_subscriptions')
      .update({
        auto_renew: false,
        canceled_at: now.toISOString(),
        expires_at: endOfMonthUTC.toISOString(),
      })
      .eq('id', activeSub.id);

    if (updateErr) continue;

    // 建立稽核紀錄
    await supabase.from('audit_logs').insert({
      action: 'auto_cancel_failed_renewal',
      actor_id: userId,
      target_id: activeSub.id,
      target_type: 'subscription',
      detail: {
        planId,
        reason: 'Payment failed and not resolved by deadline',
        failedAt: log.created_at,
      },
    });

    canceledCount++;
  }

  return { checked: renewalFailures.length, canceled: canceledCount };
}
