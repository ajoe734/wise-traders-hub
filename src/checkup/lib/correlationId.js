/**
 * Correlation ID helper
 * --------------------------------------------------------------------------
 * 用途：在「同一次使用者觸發」橫跨「前端 fetch → Edge Function → AI provider」
 *      的所有日誌中，加上一個共同的 `cid`，方便事後在 Network/Console/
 *      Edge Function logs 三邊互相對位，特別是 rate-limit / quota 失敗時。
 *
 * 設計原則：
 *  - 純函式、零依賴，可在前端與 Deno edge runtime 同源使用
 *  - ID 短而可讀（<= 24 字），人眼好辨識
 *  - 不參與任何鑑權；純為觀測用，外洩無風險
 */

const HEADER_NAME = 'x-correlation-id'

function shortRand() {
  // 6 hex chars from crypto if available, else Math.random
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const buf = new Uint8Array(3)
      crypto.getRandomValues(buf)
      return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    /* ignore */
  }
  return Math.random().toString(16).slice(2, 8).padStart(6, '0')
}

/** 產生一個新 correlation id，例如 `cid_lq3p1xt9_a9f2c4` */
export function newCorrelationId(prefix = 'cid') {
  const ts = Date.now().toString(36)
  return `${prefix}_${ts}_${shortRand()}`
}

/**
 * 把 cid 寫入 fetch 用 headers（不破壞原有 headers）。
 * 如果未傳入 cid 會自動產生一個並回傳。
 */
export function withCorrelation(headers, cid) {
  const id = cid || newCorrelationId()
  return { headers: { ...(headers || {}), [HEADER_NAME]: id }, cid: id }
}

/** 標頭名稱常數，前後端共用，避免拼錯 */
export const CORRELATION_HEADER = HEADER_NAME
