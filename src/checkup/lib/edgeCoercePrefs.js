// 使用者對「持倉/股票去重」的偏好設定，存於 localStorage。
// 這些選項會傳給 coerceStocksString / coerceStocksArray / coerceHoldingsList。
//
// strategy:        'keepFirst' | 'keepLast'   — 重複時保留第一個或最後一個
// ignoreWhitespace: boolean                   — true 時用「去除所有空白後的字串」當作去重 key
// normalizeWidth:  boolean                    — true 時把全形英數/標點轉半形再比對與輸出
//
// 預設值刻意保守：跟舊行為相容（keepFirst、保留空白、不轉全半形）。
// 儲存與版本控制一律走 prefsStore（C5 單一抽象）。

import { createPrefsStore } from './prefsStore'

const DEFAULTS = Object.freeze({
  strategy: 'keepFirst',
  ignoreWhitespace: false,
  normalizeWidth: false,
})

const store = createPrefsStore({
  key: 'edge.coerce.prefs.v1',
  defaults: { ...DEFAULTS },
  sanitize: (v) => ({
    strategy: v.strategy === 'keepLast' ? 'keepLast' : 'keepFirst',
    ignoreWhitespace: !!v.ignoreWhitespace,
    normalizeWidth: !!v.normalizeWidth,
  }),
})

export function getCoercePrefs() {
  return store.load()
}

export function setCoercePrefs(patch) {
  return store.update(patch)
}

export function resetCoercePrefs() {
  return store.reset()
}

export function subscribeCoercePrefs(fn) {
  return store.subscribe(fn)
}

export const COERCE_PREF_DEFAULTS = DEFAULTS
