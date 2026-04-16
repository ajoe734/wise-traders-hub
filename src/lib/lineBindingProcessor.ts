/**
 * LINE 綁定碼業務邏輯
 *
 * 從 supabase/functions/line-webhook/index.ts 提取可測試的綁定碼處理邏輯：
 *   1. 查詢綁定碼是否屬於正確的 expert（ISSUE-009：跨 OA 檢查）
 *   2. 查詢綁定碼是否有效（正確 expert、未使用、未過期）
 *   3. 建立或更新 member_line_bindings 記錄
 *   4. 標記綁定碼為已使用
 *
 * 對應測試路徑：
 *   3.5-1：正確綁定碼 + 正確 OA → 綁定成功
 *   3.5-2：正確綁定碼但錯誤 OA → 拒絕（跨 OA 錯誤）
 *   3.5-3：已過期綁定碼 → 拒絕
 *   3.5-4：不存在的綁定碼 → 拒絕
 *   3.5-5：已使用綁定碼（used=true）→ 拒絕
 */

export type BindingCodeStatus =
  | 'success'
  | 'wrong_oa'
  | 'invalid_or_expired'
  | 'db_error'
  | 'mark_used_failed';

export interface ProcessBindingCodeResult {
  status: BindingCodeStatus;
  error: string | null;
}

interface SupabaseClient {
  from: (table: string) => any;
}

/**
 * 處理 LINE 綁定碼：驗證碼有效性 → 建立/更新 member_line_bindings → 標記 used=true。
 *
 * @param supabase    - Supabase client
 * @param code        - 六碼英數綁定碼（已轉大寫）
 * @param expertId    - 請求進入的 LINE OA 對應的 expert_id
 * @param lineUserId  - LINE 平台回傳的 userId
 * @param displayName - LINE 平台回傳的 displayName（可 null）
 * @param now         - 當前時間（可注入，供測試用）
 */
export async function processLineBindingCode(
  supabase: SupabaseClient,
  code: string,
  expertId: string,
  lineUserId: string,
  displayName: string | null,
  now: Date = new Date(),
): Promise<ProcessBindingCodeResult> {
  // Step 1：先查詢此碼是否存在於任何 expert（ISSUE-009：跨 OA 偵測）
  const { data: anyCode } = await supabase
    .from('line_binding_codes')
    .select('expert_id')
    .eq('code', code)
    .eq('used', false)
    .gt('expires_at', now.toISOString())
    .maybeSingle();

  if (anyCode && anyCode.expert_id !== expertId) {
    return { status: 'wrong_oa', error: '此驗證碼不屬於本頻道' };
  }

  // Step 2：查詢此 expert 下的有效綁定碼
  const { data: bindingCode } = await supabase
    .from('line_binding_codes')
    .select('*')
    .eq('code', code)
    .eq('expert_id', expertId)
    .eq('used', false)
    .gt('expires_at', now.toISOString())
    .single();

  if (!bindingCode) {
    return { status: 'invalid_or_expired', error: '驗證碼無效或已過期' };
  }

  // Step 3：建立或更新 member_line_bindings
  const { data: existingBinding } = await supabase
    .from('member_line_bindings')
    .select('id')
    .eq('user_id', bindingCode.user_id)
    .eq('expert_id', expertId)
    .single();

  if (existingBinding) {
    const { error: updateError } = await supabase
      .from('member_line_bindings')
      .update({
        line_user_id: lineUserId,
        display_name: displayName,
        is_active: true,
        bound_at: now.toISOString(),
      })
      .eq('id', existingBinding.id);
    if (updateError) return { status: 'db_error', error: updateError.message };
  } else {
    const { error: insertError } = await supabase
      .from('member_line_bindings')
      .insert({
        user_id: bindingCode.user_id,
        expert_id: expertId,
        line_user_id: lineUserId,
        display_name: displayName,
        is_active: true,
      });
    if (insertError) return { status: 'db_error', error: insertError.message };
  }

  // Step 4：標記綁定碼為已使用（失敗表示綁定完成但碼仍可被重用，需獨立回報）
  const { error: markError } = await supabase
    .from('line_binding_codes')
    .update({ used: true })
    .eq('id', bindingCode.id);

  if (markError) return { status: 'mark_used_failed', error: markError.message };

  return { status: 'success', error: null };
}
