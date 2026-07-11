// 共用：串流過程中拋錯時，寫入 UIMessageStream 的錯誤訊息格式。
// 這是「後端 onError → 前端 error.message → errorId 解析」的合約來源，
// 前端 `src/pages/_expertAiChat/errorIdParser.ts` 的 regex 必須能解析本函式輸出。
export function formatStreamErrorMessage(errorId: string, message: string): string {
  return `AI 對話串流失敗（errorId: ${errorId}）：${message}`;
}

// 前後端共用的 errorId 解析 regex 字面（測試用）
export const ERROR_ID_PATTERN = /errorId[:：]\s*(err_[a-z0-9_]+)/i;
