// 前端 + Edge Function 共用的「輸入自動轉型」邏輯（純函式）
// 為避免前後端規格漂移，這份檔案會被同步複製到 supabase/functions/_shared/inputCoerce.ts
// 之後若要新增 coercer，請同時更新兩處。

import { getCoercePrefs } from './edgeCoercePrefs.js'

// ── 共用工具 ────────────────────────────────────────────────

const SEP_RE = /[、,;\n\r|]+/

// 全形 → 半形：英數、空白、常用標點
function toHalfWidth(s) {
  if (typeof s !== 'string') return s
  return s
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .replace(/[，、]/g, ',')
}

function normalizeItem(raw, opts) {
  if (raw == null) return ''
  let s = String(raw)
  if (opts.normalizeWidth) s = toHalfWidth(s)
  s = s.trim().replace(/\s+/g, ' ')
  return s
}

function dedupKey(s, opts) {
  if (opts.ignoreWhitespace) return s.replace(/\s+/g, '').toLowerCase()
  return opts.normalizeWidth ? s.toLowerCase() : s
}

// 把任意輸入拆成「字串陣列」
function toRawArray(value) {
  if (value == null) return null
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return value.split(SEP_RE)
  return null
}

/**
 * 核心去重：keepFirst / keepLast 兩種策略
 * 回傳：{ items, removedDuplicates, duplicates: [{ item, count }] }
 *   - items 為去重後、依策略保留的「正規化字串陣列」
 *   - duplicates 列出每個重複 key 的「實際出現次數」（含被保留那筆）
 */
function dedupeItems(rawArr, opts) {
  const normalized = []
  for (const raw of rawArr) {
    const s = normalizeItem(raw, opts)
    if (!s) continue
    normalized.push(s)
  }

  const counts = new Map() // key -> count
  const firstIdx = new Map() // key -> index in normalized
  const lastIdx = new Map() // key -> index in normalized
  for (let i = 0; i < normalized.length; i += 1) {
    const k = dedupKey(normalized[i], opts)
    counts.set(k, (counts.get(k) || 0) + 1)
    if (!firstIdx.has(k)) firstIdx.set(k, i)
    lastIdx.set(k, i)
  }

  const keepIdx = opts.strategy === 'keepLast' ? lastIdx : firstIdx
  const seen = new Set()
  const items = []
  // 為了讓「keepLast 時順序仍接近原始最後一次出現的順序」，我們以 normalized 順序掃，
  // 只在 i === keepIdx[k] 時收下。
  for (let i = 0; i < normalized.length; i += 1) {
    const k = dedupKey(normalized[i], opts)
    if (seen.has(k)) continue
    if (keepIdx.get(k) === i) {
      items.push(normalized[i])
      seen.add(k)
    }
  }

  const duplicates = []
  for (const [k, count] of counts.entries()) {
    if (count > 1) {
      // 用「被保留的那一筆」當顯示文字
      const idx = keepIdx.get(k)
      duplicates.push({ item: normalized[idx], count })
    }
  }

  const removedDuplicates = normalized.length - items.length
  return { items, removedDuplicates, duplicates }
}

// ── 對外 coercer ───────────────────────────────────────────

/**
 * 把 stocks / codes / symbols 等「可能是字串也可能是陣列」的輸入
 * 標準化成「使用者習慣的頓號分隔字串」。
 */
export function coerceStocksString(value, prefs) {
  const arr = toRawArray(value)
  if (arr == null) return { value, changed: false, removedDuplicates: 0, duplicates: [] }
  const opts = { ...getCoercePrefs(), ...(prefs || {}) }
  const { items, removedDuplicates, duplicates } = dedupeItems(arr, opts)
  const next = items.join('、')
  return { value: next, changed: next !== value, removedDuplicates, duplicates }
}

/**
 * 把 stocks / codes / symbols 標準化成「字串陣列」。
 */
export function coerceStocksArray(value, prefs) {
  const arr = toRawArray(value)
  if (arr == null) return { value, changed: false, removedDuplicates: 0, duplicates: [] }
  const opts = { ...getCoercePrefs(), ...(prefs || {}) }
  const { items, removedDuplicates, duplicates } = dedupeItems(arr, opts)
  const sameLen = Array.isArray(value) && value.length === items.length
  const sameAll = sameLen && items.every((v, i) => v === value[i])
  return { value: items, changed: !sameAll, removedDuplicates, duplicates }
}

/**
 * holdingsList：典型輸入是「使用者貼上的多行持倉文字或陣列」
 * 例如：
 *   "2330 台積電 100 股 600\n2317 鴻海 200 股 100\n2330 台積電 100 股 600"
 *   ↓
 *   "2330 台積電 100 股 600、2317 鴻海 200 股 100"
 *
 * 與 coerceStocksString 共用相同 dedup 引擎；單獨命名是為了讓 schema 與 toast 標籤更具語意。
 */
export function coerceHoldingsList(value, prefs) {
  return coerceStocksString(value, prefs)
}

export const COERCERS = {
  stocksString: coerceStocksString,
  stocksArray: coerceStocksArray,
  holdingsList: coerceHoldingsList,
}

/**
 * 對 source 物件的欄位套用 coerce，回傳：
 *   { source: 已修改的新物件, fixes: [{ key, label, before, after, summary, removedDuplicates, duplicates }] }
 * 不會改動原物件。
 */
export function applyCoercion(fields, source, prefs) {
  if (!source || typeof source !== 'object') return { source, fixes: [] }
  let next = source
  const fixes = []
  for (const [key, spec] of Object.entries(fields || {})) {
    if (!spec?.coerce) continue
    const fn = COERCERS[spec.coerce]
    if (!fn) continue
    const original = source[key]
    if (original === undefined || original === null || original === '') continue
    const result = fn(original, prefs)
    const { value: coerced, changed, removedDuplicates = 0, duplicates = [] } = result
    if (changed) {
      if (next === source) next = { ...source }
      next[key] = coerced
      fixes.push({
        key,
        label: spec.label || key,
        before: original,
        after: coerced,
        removedDuplicates,
        duplicates,
        summary: summarizeFix(original, coerced, removedDuplicates, duplicates),
      })
    } else if (Array.isArray(coerced) || typeof coerced === 'string') {
      if (typeof original !== typeof coerced || (Array.isArray(original) !== Array.isArray(coerced))) {
        if (next === source) next = { ...source }
        next[key] = coerced
      }
    }
  }
  return { source: next, fixes }
}

export function summarizeFix(before, after, removedDuplicates = 0, duplicates = []) {
  const beforeLen = Array.isArray(before)
    ? before.length
    : (typeof before === 'string' ? before.split(SEP_RE).filter((s) => s.trim()).length : 0)
  const afterLen = Array.isArray(after)
    ? after.length
    : (typeof after === 'string' ? after.split(SEP_RE).filter((s) => s.trim()).length : 0)
  const parts = []
  if (removedDuplicates > 0) {
    const sample = duplicates.slice(0, 3).map((d) => d.count > 1 ? `${d.item}×${d.count}` : d.item).join('、')
    const more = duplicates.length > 3 ? ` 等 ${duplicates.length} 項` : ''
    parts.push(`已去除 ${removedDuplicates} 個重複項（${sample}${more}）`)
  }
  if (beforeLen !== afterLen) {
    parts.push(`筆數：${beforeLen} → ${afterLen}`)
  } else if (parts.length === 0) {
    parts.push(`已標準化（${afterLen} 筆）`)
  } else {
    parts.push(`保留 ${afterLen} 筆`)
  }
  return parts.join('；')
}
