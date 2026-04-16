/**
 * 個人資料欄位更新邏輯
 *
 * 封裝 profiles 資料表的 UPDATE 操作。
 * DB 端 protect_profile_fields() trigger（migration 20260412101307）
 * 會阻擋非 company_admin 對 is_tester / expert_slug 欄位的修改，
 * 並以 RAISE EXCEPTION 回傳錯誤。
 *
 * 對應測試路徑：
 *   3.3-1：UPDATE profiles.is_tester → 被阻擋
 *   3.3-2：UPDATE profiles.expert_slug → 被阻擋
 *   3.3-5：UPDATE profiles.display_name → 成功（非敏感欄位）
 */

export interface UpdateProfileResult {
  error: string | null;
}

/**
 * 更新 profiles 資料表中的欄位。
 * 敏感欄位（is_tester / expert_slug）的修改會被 DB 端 trigger 阻擋。
 */
export async function updateProfileFields(
  supabase: { from: (table: string) => any },
  userId: string,
  fields: Record<string, unknown>,
): Promise<UpdateProfileResult> {
  const { error } = await supabase
    .from('profiles')
    .update(fields)
    .eq('user_id', userId);

  return { error: error?.message ?? null };
}
