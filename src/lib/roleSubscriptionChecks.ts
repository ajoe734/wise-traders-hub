/**
 * 角色與訂閱狀態 DB 函數呼叫邏輯
 *
 * 封裝三個 SECURITY DEFINER RPC 函數：
 *   has_role                → 判斷使用者是否持有指定角色
 *   is_subscribed_to_plan   → 判斷使用者是否有效訂閱指定方案
 *   has_active_subscription → 回傳使用者所有有效訂閱（plan_id + expert_id）
 *
 * 對應測試路徑：
 *   3.1-1 ~ 3.1-4：has_role
 *   3.2-1 ~ 3.2-5：is_subscribed_to_plan / has_active_subscription
 */

type SupabaseRpc = {
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

// ── checkUserRole ──────────────────────────────────────────────────────────────

export interface CheckRoleResult {
  hasRole: boolean;
  error: string | null;
}

/**
 * 呼叫 has_role RPC，判斷使用者是否持有指定角色。
 * Role 枚舉：'company_admin' | 'analyst'
 */
export async function checkUserRole(
  supabase: SupabaseRpc,
  userId: string,
  role: 'company_admin' | 'analyst',
): Promise<CheckRoleResult> {
  const { data, error } = await supabase.rpc('has_role', { _user_id: userId, _role: role });
  return {
    hasRole: error ? false : Boolean(data),
    error: error?.message ?? null,
  };
}

// ── checkIsSubscribedToPlan ────────────────────────────────────────────────────

export interface CheckSubscriptionResult {
  isSubscribed: boolean;
  error: string | null;
}

/**
 * 呼叫 is_subscribed_to_plan RPC，判斷使用者是否有效訂閱指定方案。
 * 有效條件：status='active' AND (expires_at IS NULL OR expires_at > now())
 */
export async function checkIsSubscribedToPlan(
  supabase: SupabaseRpc,
  userId: string,
  planId: string,
): Promise<CheckSubscriptionResult> {
  const { data, error } = await supabase.rpc('is_subscribed_to_plan', {
    _user_id: userId,
    _plan_id: planId,
  });
  return {
    isSubscribed: error ? false : Boolean(data),
    error: error?.message ?? null,
  };
}

// ── fetchActiveSubscriptions ───────────────────────────────────────────────────

export interface ActiveSubscriptionRow {
  plan_id: string;
  expert_id: string;
}

export interface FetchActiveSubscriptionsResult {
  subscriptions: ActiveSubscriptionRow[];
  error: string | null;
}

/**
 * 呼叫 has_active_subscription RPC，回傳使用者所有有效訂閱的 plan_id 與 expert_id。
 */
export async function fetchActiveSubscriptions(
  supabase: SupabaseRpc,
  userId: string,
): Promise<FetchActiveSubscriptionsResult> {
  const { data, error } = await supabase.rpc('has_active_subscription', { _user_id: userId });
  return {
    subscriptions: error ? [] : ((data as ActiveSubscriptionRow[]) ?? []),
    error: error?.message ?? null,
  };
}
