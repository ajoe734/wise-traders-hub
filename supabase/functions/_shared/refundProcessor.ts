/**
 * 退款處理：冪等性檢查 + payment_transactions(refunded) + audit_logs(yearly_refund)
 *
 * ⚠️ 此為單一來源（Single Source of Truth）。
 *    Edge Functions 從此處 import，Vitest 透過 src/lib/refundProcessor.ts re-export。
 *
 * 對應 Edge Functions：
 *   process-refund → processRefundInDB
 */

export interface ProcessRefundParams {
  subscriptionId: string;
  userId: string;
  refundAmount: number;
  remainingMonths?: number;
  originalAmount?: number;
  monthlyPrice?: number;
}

export interface ProcessRefundResult {
  success: boolean;
  alreadyRefunded: boolean;
  cappedRefundAmount: number;
  error: string | null;
}

/**
 * 年繳退款寫入 DB：
 *   1. 冪等性檢查：已有 refunded 紀錄 → 直接回傳成功
 *   2. 查詢原始 paid 交易以計算上限金額
 *   3. 插入 payment_transactions（status: "refunded"，amount 為負值）
 *   4. 插入 audit_logs（action: "yearly_refund"）
 */
export async function processRefundInDB(
  supabase: { from: (table: string) => any },
  params: ProcessRefundParams,
): Promise<ProcessRefundResult> {
  const { subscriptionId, userId, refundAmount, remainingMonths, originalAmount, monthlyPrice } = params;

  // 冪等性檢查
  const { data: existingRefund } = await supabase
    .from('payment_transactions')
    .select('id')
    .eq('subscription_id', subscriptionId)
    .eq('status', 'refunded')
    .limit(1);

  if (existingRefund && existingRefund.length > 0) {
    return { success: true, alreadyRefunded: true, cappedRefundAmount: refundAmount, error: null };
  }

  // 查詢原始付款以計算上限
  const { data: originalTx } = await supabase
    .from('payment_transactions')
    .select('id, provider_id, provider_tx_id, amount')
    .eq('subscription_id', subscriptionId)
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const cappedRefundAmount = originalTx?.amount
    ? Math.min(Math.abs(refundAmount), Math.abs(originalTx.amount))
    : Math.abs(refundAmount);

  // 插入退款紀錄
  const { error: txError } = await supabase
    .from('payment_transactions')
    .insert({
      subscription_id: subscriptionId,
      amount: -cappedRefundAmount,
      status: 'refunded',
      paid_at: new Date().toISOString(),
      provider_id: originalTx?.provider_id ?? null,
      provider_tx_id: originalTx?.provider_tx_id ? `REFUND-${originalTx.provider_tx_id}` : null,
    });

  if (txError) {
    return { success: false, alreadyRefunded: false, cappedRefundAmount, error: txError.message };
  }

  // 插入稽核紀錄（非關鍵）
  await supabase.from('audit_logs').insert({
    action: 'yearly_refund',
    actor_id: userId,
    target_id: subscriptionId,
    target_type: 'member_subscriptions',
    detail: {
      reason: '年繳中途取消，退還剩餘月份',
      remainingMonths,
      refundAmount,
      originalAmount,
      monthlyPrice,
    },
  });

  return { success: true, alreadyRefunded: false, cappedRefundAmount, error: null };
}
