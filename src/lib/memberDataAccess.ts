/**
 * 會員資料存取邏輯
 *
 * 以下函數從 hooks/useSubscriptions.ts 及相關頁面提取，供 Vitest 測試。
 * DB 端 RLS 策略（user_id = auth.uid()）確保各會員僅能存取自身資料。
 *
 * 對應查詢來源：
 *   fetchMemberProfile       → profiles（user_id = auth.uid() 保護）
 *   fetchMemberSubscriptions → src/hooks/useSubscriptions.ts（useMySubscriptions）
 *   fetchMemberNotifications → notifications（user_id = auth.uid() 保護）
 */

// ── fetchMemberProfile ────────────────────────────────────────────────────────

export interface FetchMemberProfileResult {
  profile: any | null;
  error: string | null;
}

/**
 * 查詢指定 userId 的個人資料。
 * RLS 在 DB 端保證只有本人（auth.uid() = user_id）才能取得資料。
 */
export async function fetchMemberProfile(
  supabase: { from: (table: string) => any },
  userId: string,
): Promise<FetchMemberProfileResult> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  return { profile: data ?? null, error: error?.message ?? null };
}

// ── fetchMemberSubscriptions ──────────────────────────────────────────────────

export interface FetchMemberSubscriptionsResult {
  subscriptions: any[];
  error: string | null;
}

/**
 * 查詢指定 userId 的有效訂閱列表（status = 'active'）。
 * 對應 useMySubscriptions hook 的 DB 查詢部分。
 */
export async function fetchMemberSubscriptions(
  supabase: { from: (table: string) => any },
  userId: string,
): Promise<FetchMemberSubscriptionsResult> {
  const { data, error } = await supabase
    .from('member_subscriptions')
    .select('*, expert_plans(*, experts(*))')
    .eq('user_id', userId)
    .eq('status', 'active');

  return { subscriptions: data ?? [], error: error?.message ?? null };
}

// ── fetchMemberNotifications ──────────────────────────────────────────────────

export interface FetchMemberNotificationsResult {
  notifications: any[];
  error: string | null;
}

/**
 * 查詢指定 userId 的通知列表（最新優先）。
 * RLS 在 DB 端保證只有本人才能取得資料。
 */
export async function fetchMemberNotifications(
  supabase: { from: (table: string) => any },
  userId: string,
  maxItems?: number,
): Promise<FetchMemberNotificationsResult> {
  let query = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (maxItems !== undefined) {
    query = query.limit(maxItems);
  }

  const { data, error } = await query;
  return { notifications: data ?? [], error: error?.message ?? null };
}
