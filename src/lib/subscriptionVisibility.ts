import { resolveProjectionStatus, type ProjectionStatus } from '@/contracts/publicProjection';
import { gateSignalEconomics } from '@/contracts/publicEconomicContract';
/**
 * 訂閱內容可見性邏輯
 *
 * isVisibleAfterSubscription 對應 has_active_subscription_after SQL 函數中的日期條件：
 *   mentor 專家：published_at + 7 days >= started_at
 *     → 訂閱者可回看訂閱日前 7 天內的內容（T+7 寬限期）
 *   其他角色（analyst 等）：published_at >= started_at
 *     → 嚴格從訂閱日起算，無回看寬限
 *
 * fetchSubscriberSignals 對應 src/pages/app/Signals.tsx 的 fetchSignalsData：
 *   1. 查詢 member_subscriptions 取得有效訂閱的 expert_ids
 *   2. 過濾為 advisor 身份的專家
 *   3. 查詢 expert_signals（DB 端 RLS 由 has_active_subscription_after 過濾）
 */

// ── isVisibleAfterSubscription ────────────────────────────────────────────────

/**
 * 判斷訂閱者是否可看到指定內容。
 * 對應 has_active_subscription_after 中的 CASE 條件（migration 20260412111243）。
 */
export function isVisibleAfterSubscription(
  expertRole: string,
  publishedAt: Date,
  startedAt: Date,
): boolean {
  if (expertRole === 'mentor') {
    // T+7: (_published_at + INTERVAL '7 days') >= ms.started_at
    return publishedAt.getTime() + 7 * 24 * 60 * 60 * 1000 >= startedAt.getTime();
  }
  // analyst / other: _published_at >= ms.started_at（嚴格，無寬限期）
  return publishedAt.getTime() >= startedAt.getTime();
}

// ── fetchSubscriberSignals ────────────────────────────────────────────────────

export interface FetchSubscriberSignalsResult {
  signals: any[];
  hasSubscription: boolean;
}

/**
 * 依訂閱狀態查詢 expert_signals。
 * supabase 需以可注入方式傳入（方便 Vitest mock）。
 */
export async function fetchSubscriberSignals(
  supabase: { from: (table: string) => any },
  userId: string | undefined,
  isTester = false,
  previewExpertId: string | null = null,
  projection: ProjectionStatus = resolveProjectionStatus({ absent: true }),
): Promise<FetchSubscriberSignalsResult> {
  if (!userId) return { signals: [], hasSubscription: false };
  const nowIso = new Date().toISOString();

  const { data: activeSubs, error: subsError } = await supabase
    .from('member_subscriptions')
    .select('plan_id, expert_plans(expert_id)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);

  if (subsError) return { signals: [], hasSubscription: false };

  const expertIds = (activeSubs || [])
    .map((s: any) => s.expert_plans?.expert_id)
    .filter(Boolean);

  // 預覽模式：把預覽的 expert 也加入查詢清單
  if (previewExpertId && !expertIds.includes(previewExpertId)) {
    expertIds.push(previewExpertId);
  }

  if (expertIds.length === 0) return { signals: [], hasSubscription: false };

  const expectedStatus = isTester ? 'draft' : 'active';
  const { data: advisorExperts, error: advisorError } = await supabase
    .from('experts')
    .select('id')
    .in('id', expertIds)
    .eq('role', 'advisor')
    .eq('status', expectedStatus);

  if (advisorError) return { signals: [], hasSubscription: false };

  const advisorExpertIds = (advisorExperts || []).map((e: any) => e.id);
  if (advisorExpertIds.length === 0) return { signals: [], hasSubscription: false };

  const { data, error } = await supabase
    .from('expert_signals')
    .select('id, instrument, action, price_hint, reason_summary, risk_notes, published_at, status, expert_id, plan_id, experts(name, slug, role, avatar_url, asset_class, currency)')
    .eq('status', 'published')
    .in('expert_id', advisorExpertIds)
    .order('published_at', { ascending: false })
    .limit(50);

  // R1-P typed public contract: price hints / quantities are suppressed while
  // the projection scope is not ready.
  return {
    signals: gateSignalEconomics(!error && data ? (data as Record<string, unknown>[]) : [], projection),
    hasSubscription: true,
  };
}
