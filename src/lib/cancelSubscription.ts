import { calcRefund, RefundInput, RefundResult } from './refundCalc';

export interface CancelSubscriptionResult {
  error: string | null;
  refund: RefundResult;
}

/**
 * 取消訂閱：計算退款類型，更新 member_subscriptions。
 *   月繳：只設 auto_renew=false / canceled_at，不改 expires_at（讓週期自然結束）
 *   年繳：額外設 expires_at 為本月底（立即停止，退還剩餘月份）
 */
export async function cancelSubscriptionInDB(
  supabase: { from: (table: string) => any },
  sub: RefundInput & { id: string },
  userId: string,
  now: Date = new Date(),
): Promise<CancelSubscriptionResult> {
  const refund = calcRefund(sub, now);

  const updatePayload: Record<string, unknown> = {
    auto_renew: false,
    canceled_at: now.toISOString(),
  };

  if (refund.isYearly) {
    // 年繳：到期日設為本月底（台灣時間 23:59:59，使用 setUTC* 與執行環境時區無關）
    const nowTW = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const endOfMonthTW = new Date(nowTW);
    endOfMonthTW.setUTCMonth(endOfMonthTW.getUTCMonth() + 1, 0);
    endOfMonthTW.setUTCHours(23, 59, 59, 999);
    updatePayload.expires_at = new Date(endOfMonthTW.getTime() - 8 * 60 * 60 * 1000).toISOString();
  }

  const { error } = await supabase
    .from('member_subscriptions')
    .update(updatePayload)
    .eq('id', sub.id)
    .eq('user_id', userId);

  return { error: error?.message ?? null, refund };
}
