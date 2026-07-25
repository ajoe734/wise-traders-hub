// PR-9: Kill-switch 檢查
// 每個關鍵 pipeline 進場前呼叫 checkKillSwitch(supa, key)；
// 回傳 false 代表 disabled，caller 必須 short-circuit 並在 log 標註 skipped_by_kill_switch。
//
// 讀取失敗一律 fail-open（回 true），避免 kill-switch 表本身變 SPOF。

export async function checkKillSwitch(supa: any, key: string): Promise<boolean> {
  try {
    const { data, error } = await supa.rpc('check_kill_switch', { _key: key });
    if (error) {
      console.warn(`[kill-switch] rpc error for ${key}, fail-open:`, error.message);
      return true;
    }
    return data === false ? false : true;
  } catch (e) {
    console.warn(`[kill-switch] exception for ${key}, fail-open:`, (e as Error).message);
    return true;
  }
}

/** 管理員 / guardian 專用：強制關閉某個 kill-switch。 */
export async function forceDisable(
  supa: any,
  key: string,
  reason: string,
  metric?: string,
): Promise<void> {
  try {
    await supa.from('system_kill_switches').upsert({
      key,
      enabled: false,
      disabled_reason: reason,
      auto_trigger_metric: metric ?? null,
      disabled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    console.log(`[kill-switch] auto-disabled ${key}: ${reason}`);
  } catch (e) {
    console.warn(`[kill-switch] force-disable failed for ${key}:`, (e as Error).message);
  }
}
