// 前端 + Edge Function 共用的「輸入自動轉型」邏輯（純函式）
// 為避免前後端規格漂移，這份檔案會被同步複製到 supabase/functions/_shared/inputCoerce.ts
// 之後若要新增 coercer，請同時更新兩處。

/**
 * 把 stocks / codes / symbols 等「可能是字串也可能是陣列」的輸入
 * 標準化成「使用者習慣的頓號分隔字串」。
 *
 *   "00637L 滬深300正2、2330 台積電,2330 台積電"
 *   ↓
 *   "00637L 滬深300正2、2330 台積電"
 *
 *   ["00637L 滬深300正2", "2330 台積電", " 2330 台積電 "]
 *   ↓
 *   "00637L 滬深300正2、2330 台積電"
 */
export function coerceStocksString(value) {
  if (value == null) return { value, changed: false, removedDuplicates: 0, duplicates: [] }
  let arr
  if (Array.isArray(value)) {
    arr = value
  } else if (typeof value === 'string') {
    arr = value.split(/[、,;\n\r]+/)
  } else {
    return { value, changed: false, removedDuplicates: 0, duplicates: [] }
  }
  const seen = new Set()
  const out = []
  const dupCounts = new Map()
  let nonEmptyCount = 0
  for (const raw of arr) {
    if (raw == null) continue
    const s = String(raw).trim().replace(/\s+/g, ' ')
    if (!s) continue
    nonEmptyCount += 1
    if (seen.has(s)) {
      dupCounts.set(s, (dupCounts.get(s) || 1) + 1)
      continue
    }
    seen.add(s)
    out.push(s)
  }
  const next = out.join('、')
  const removedDuplicates = nonEmptyCount - out.length
  const duplicates = Array.from(dupCounts.entries()).map(([item, count]) => ({ item, count }))
  return { value: next, changed: next !== value, removedDuplicates, duplicates }
}

/**
 * 把 stocks / codes / symbols 標準化成「字串陣列」。
 * 接受 string、array、或夾雜空白與重複項。
 */
export function coerceStocksArray(value) {
  if (value == null) return { value, changed: false, removedDuplicates: 0, duplicates: [] }
  let arr
  if (Array.isArray(value)) {
    arr = value
  } else if (typeof value === 'string') {
    arr = value.split(/[、,;\n\r]+/)
  } else {
    return { value, changed: false, removedDuplicates: 0, duplicates: [] }
  }
  const seen = new Set()
  const out = []
  const dupCounts = new Map()
  let nonEmptyCount = 0
  for (const raw of arr) {
    if (raw == null) continue
    const s = String(raw).trim().replace(/\s+/g, ' ')
    if (!s) continue
    nonEmptyCount += 1
    if (seen.has(s)) {
      dupCounts.set(s, (dupCounts.get(s) || 1) + 1)
      continue
    }
    seen.add(s)
    out.push(s)
  }
  const sameLen = Array.isArray(value) && value.length === out.length
  const sameAll = sameLen && out.every((v, i) => v === value[i])
  const removedDuplicates = nonEmptyCount - out.length
  const duplicates = Array.from(dupCounts.entries()).map(([item, count]) => ({ item, count }))
  return { value: out, changed: !sameAll, removedDuplicates, duplicates }
}

export const COERCERS = {
  stocksString: coerceStocksString,
  stocksArray: coerceStocksArray,
}

/**
 * 對 source 物件的欄位套用 coerce，回傳：
 *   { source: 已修改的新物件, fixes: [{ key, label, before, after, summary }] }
 * 不會改動原物件。
 */
export function applyCoercion(fields, source) {
  if (!source || typeof source !== 'object') return { source, fixes: [] }
  let next = source
  const fixes = []
  for (const [key, spec] of Object.entries(fields || {})) {
    if (!spec?.coerce) continue
    const fn = COERCERS[spec.coerce]
    if (!fn) continue
    const original = source[key]
    if (original === undefined || original === null || original === '') continue
    const result = fn(original)
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
      // 即使沒變動，仍寫回標準化值（例如後端規格要 string 但 caller 給陣列）
      if (typeof original !== typeof coerced || (Array.isArray(original) !== Array.isArray(coerced))) {
        if (next === source) next = { ...source }
        next[key] = coerced
      }
    }
  }
  return { source: next, fixes }
}

function summarizeFix(before, after, removedDuplicates = 0, duplicates = []) {
  const beforeLen = Array.isArray(before) ? before.length : (typeof before === 'string' ? before.split(/[、,;\n\r]+/).filter(Boolean).length : 0)
  const afterLen = Array.isArray(after) ? after.length : (typeof after === 'string' ? after.split(/[、,;\n\r]+/).filter(Boolean).length : 0)
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
