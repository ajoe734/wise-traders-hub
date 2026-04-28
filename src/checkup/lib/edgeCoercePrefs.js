// 使用者對「持倉/股票去重」的偏好設定，存於 localStorage。
// 這些選項會傳給 coerceStocksString / coerceStocksArray / coerceHoldingsList。
//
// strategy:        'keepFirst' | 'keepLast'   — 重複時保留第一個或最後一個
// ignoreWhitespace: boolean                   — true 時用「去除所有空白後的字串」當作去重 key
// normalizeWidth:  boolean                    — true 時把全形英數/標點轉半形再比對與輸出
//
// 預設值刻意保守：跟舊行為相容（keepFirst、保留空白、不轉全半形）。

const KEY = 'edge.coerce.prefs.v1'

const DEFAULTS = Object.freeze({
  strategy: 'keepFirst',
  ignoreWhitespace: false,
  normalizeWidth: false,
})

let cache = null
const listeners = new Set()

function readFromStorage() {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return {
      strategy: parsed.strategy === 'keepLast' ? 'keepLast' : 'keepFirst',
      ignoreWhitespace: !!parsed.ignoreWhitespace,
      normalizeWidth: !!parsed.normalizeWidth,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function getCoercePrefs() {
  if (!cache) cache = readFromStorage()
  return { ...cache }
}

export function setCoercePrefs(patch) {
  const next = { ...getCoercePrefs(), ...patch }
  cache = next
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* noop */ }
  }
  for (const fn of listeners) {
    try { fn(next) } catch { /* noop */ }
  }
  return next
}

export function resetCoercePrefs() {
  return setCoercePrefs({ ...DEFAULTS })
}

export function subscribeCoercePrefs(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const COERCE_PREF_DEFAULTS = DEFAULTS
