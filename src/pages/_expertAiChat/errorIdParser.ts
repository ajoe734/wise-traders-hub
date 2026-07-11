// 從錯誤訊息中解析後端注入的 errorId。
// 與 `supabase/functions/_shared/stream-error.ts` 的 formatStreamErrorMessage 相對應：
// 只要後端 onError 走該格式，這裡就能撈到 errorId 顯示在錯誤卡片與 toast。
export const ERROR_ID_PATTERN = /errorId[:：]\s*(err_[a-z0-9_]+)/i;

export function extractErrorIdFromMessage(msg?: string | null): string | null {
  if (!msg) return null;
  const m = msg.match(ERROR_ID_PATTERN);
  return m ? m[1] : null;
}
