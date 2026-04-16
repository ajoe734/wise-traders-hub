/**
 * 安全視圖存取邏輯
 *
 * 四個安全視圖透過明確的 SELECT 欄位清單，在 DB 層排除敏感欄位：
 *   expert_line_channels_public  → 排除 channel_access_token
 *   experts_public               → 排除 user_id / created_by / starting_capital
 *   payment_providers_safe       → 排除 config
 *   member_line_bindings_analyst → 排除 line_user_id
 *
 * 所有視圖均以 security_invoker = true 建立，RLS 仍由底層資料表的 policy 執行。
 *
 * 對應測試路徑：
 *   2.5-1 ~ 2.5-4
 */

// ── fetchExpertLineChannelsPublic ─────────────────────────────────────────────

export interface FetchExpertLineChannelsPublicResult {
  channels: any[];
  error: string | null;
}

/**
 * 查詢 expert_line_channels_public 安全視圖（不含 channel_access_token）。
 */
export async function fetchExpertLineChannelsPublic(
  supabase: { from: (table: string) => any },
): Promise<FetchExpertLineChannelsPublicResult> {
  const { data, error } = await supabase
    .from('expert_line_channels_public')
    .select('*');

  return { channels: data ?? [], error: error?.message ?? null };
}

// ── fetchExpertsPublic ────────────────────────────────────────────────────────

export interface FetchExpertsPublicResult {
  experts: any[];
  error: string | null;
}

/**
 * 查詢 experts_public 安全視圖（不含 user_id / created_by / starting_capital）。
 */
export async function fetchExpertsPublic(
  supabase: { from: (table: string) => any },
): Promise<FetchExpertsPublicResult> {
  const { data, error } = await supabase
    .from('experts_public')
    .select('*');

  return { experts: data ?? [], error: error?.message ?? null };
}

// ── fetchPaymentProvidersSafe ─────────────────────────────────────────────────

export interface FetchPaymentProvidersSafeResult {
  providers: any[];
  error: string | null;
}

/**
 * 查詢 payment_providers_safe 安全視圖（不含 config）。
 */
export async function fetchPaymentProvidersSafe(
  supabase: { from: (table: string) => any },
): Promise<FetchPaymentProvidersSafeResult> {
  const { data, error } = await supabase
    .from('payment_providers_safe')
    .select('*');

  return { providers: data ?? [], error: error?.message ?? null };
}

// ── fetchMemberLineBindingsAnalyst ────────────────────────────────────────────

export interface FetchMemberLineBindingsAnalystResult {
  bindings: any[];
  error: string | null;
}

/**
 * 查詢 member_line_bindings_analyst 安全視圖（不含 line_user_id）。
 * 底層 RLS policy 確保分析師只能看到自己 expert_id 下的綁定記錄。
 */
export async function fetchMemberLineBindingsAnalyst(
  supabase: { from: (table: string) => any },
): Promise<FetchMemberLineBindingsAnalystResult> {
  const { data, error } = await supabase
    .from('member_line_bindings_analyst')
    .select('*');

  return { bindings: data ?? [], error: error?.message ?? null };
}
