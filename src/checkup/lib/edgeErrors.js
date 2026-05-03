/**
 * Centralized edge function error code → friendly Chinese message.
 *
 * 用法：
 *   import { describeEdgeError } from '@/checkup/lib/edgeErrors'
 *   const msg = describeEdgeError(error, '預設錯誤訊息')
 *
 * `error` 可以是：
 *   - Error 物件（含 body / message）
 *   - { error, message } 形狀的 plain object
 *   - 字串
 */

export const EDGE_ERROR_DICT = {
  AUTH_REQUIRED: '請先登入再使用 AI 功能',
  AUTH_INVALID: '登入狀態已失效，請重新登入',
  QUOTA_EXCEEDED: '本期 AI 解析額度已用完，請升級方案後再試',
  QUOTA_CHECK_FAILED: '配額檢查發生錯誤，請稍後再試',
  RATE_LIMITED: '操作太頻繁，請稍後再試',
  PAYMENT_REQUIRED: '此功能需付費方案，升級後即可使用',
  NETWORK_ERROR: '網路連線異常，請檢查網路後重試',
  AI_PARSE_FAILED: 'AI 回傳格式無法解析，請重新嘗試或更清晰的截圖',
  OCR_LOW_CONFIDENCE: 'OCR 結果信心不足，請改用更清晰的截圖',
  STOCK_NOT_FOUND: '查無此股票代碼，請確認後重試',
  PRICE_UNAVAILABLE: '暫時拿不到報價，已記錄等價同步',
  TIMEOUT: '伺服器處理超時，請稍後重試',
  INTERNAL_ERROR: '系統暫時忙碌，請稍後再試',
}

function pickErrorCode(input) {
  if (!input) return ''
  if (typeof input === 'string') return input
  // Error / object 都可能帶 body 或直接 error 欄位
  const body = input.body || input
  if (body?.error && typeof body.error === 'string') return body.error
  if (input.code && typeof input.code === 'string') return input.code
  return ''
}

function pickFallback(input) {
  if (!input) return ''
  if (typeof input === 'string') return input
  return (
    input?.body?.message ||
    input?.message ||
    ''
  )
}

/**
 * 將 edge function 錯誤轉為使用者看得懂的中文。
 */
export function describeEdgeError(input, fallback = '操作失敗，請稍後重試') {
  const code = pickErrorCode(input)
  if (code && EDGE_ERROR_DICT[code]) return EDGE_ERROR_DICT[code]
  const msg = pickFallback(input)
  if (msg) return msg
  return fallback
}

/** 判斷錯誤是否為配額問題（前端可據此引導升級）。 */
export function isQuotaError(input) {
  return pickErrorCode(input) === 'QUOTA_EXCEEDED'
}
