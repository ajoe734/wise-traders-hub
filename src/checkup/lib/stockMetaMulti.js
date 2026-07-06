/**
 * stockMetaMulti — 統一多族群 metadata 取值層
 *
 * 合併優先順序（高 → 低）：
 *   1. `holding_meta_overrides` DB override（支援 industries[] / themes[] / revenue_mix / 舊 industry 單值）
 *   2. `stockIndustry.json` 人工校訂覆蓋層（多族群 + revenueMix + themes）
 *   3. `STOCK_META` (seedData) — 手 key 的單值 industry / strategy / themes
 *   4. `twsePrimaryIndustry.json` — TWSE / TPEx ISIN 官方主產業（單值兜底）
 *
 * 呼叫端拿到的規範化物件：
 *   {
 *     industries:      string[]    // 依營收比重降冪，長度 >= 1
 *     primaryIndustry: string      // industries[0]
 *     revenueMix:      Array<{industry,pct}> | null
 *     themes:          string[]    // 題材（可 0-N 個）
 *     strategy:        string | null
 *   }
 *
 * 「未分類」放到 industries[0] 表示完全沒有 metadata。
 */

import overlayJson from '@/checkup/data/stockIndustry.json'
import twseCompact from '@/checkup/data/twsePrimaryIndustry.json'
import finmindCompact from '@/checkup/data/twseSecondaryIndustry.json'

export const UNCLASSIFIED = '未分類'

// 去掉 _meta 說明區塊
const OVERLAY = (() => {
  const out = {}
  for (const [k, v] of Object.entries(overlayJson || {})) {
    if (k.startsWith('_')) continue
    out[k] = v
  }
  return out
})()

// TWSE 主產業 map（compact），拿掉 _meta
const TWSE = (() => {
  const out = {}
  for (const [k, v] of Object.entries(twseCompact || {})) {
    if (k.startsWith('_')) continue
    if (typeof v === 'string') out[k] = v
  }
  return out
})()

// FinMind 次產業 map（compact），拿掉 _meta
const FINMIND = (() => {
  const out = {}
  for (const [k, v] of Object.entries(finmindCompact || {})) {
    if (k.startsWith('_')) continue
    if (typeof v === 'string' && v) out[k] = v
  }
  return out
})()

function normalizeMix(mix) {
  if (!Array.isArray(mix) || mix.length === 0) return null
  const cleaned = mix
    .filter((m) => m && m.industry && Number.isFinite(Number(m.pct)))
    .map((m) => ({ industry: String(m.industry), pct: Number(m.pct) }))
  if (cleaned.length === 0) return null
  const total = cleaned.reduce((s, m) => s + m.pct, 0)
  if (total <= 0) return null
  return cleaned.map((m) => ({ industry: m.industry, pct: (m.pct / total) * 100 }))
}

/**
 * @param {string|number} code
 * @param {Object} stockMeta   STOCK_META (seedData)
 * @param {Object} [override]  單筆 holding_meta_overrides row（可選）
 */
export function getMultiMeta(code, stockMeta, override) {
  const key = String(code || '').trim()
  const base = (stockMeta && stockMeta[key]) || null
  const over = OVERLAY[key] || null
  const twseInd = TWSE[key] || null
  const finmindInd = FINMIND[key] || null

  // 1. industries[]：DB override > overlay > base.industries > DB.industry > base.industry > TWSE > FinMind > 未分類
  let industries = null
  if (Array.isArray(override?.industries) && override.industries.length) {
    industries = override.industries.slice()
  } else if (over?.industries?.length) {
    industries = over.industries.slice()
  } else if (base?.industries?.length) {
    industries = base.industries.slice()
  } else if (override?.industry) {
    industries = [override.industry]
  } else if (base?.industry) {
    industries = [base.industry]
  } else if (twseInd) {
    industries = [twseInd]
  } else if (finmindInd) {
    industries = [finmindInd]
  } else {
    industries = [UNCLASSIFIED]
  }

  // 2. revenueMix：DB override > overlay > base
  const revenueMix =
    normalizeMix(override?.revenue_mix) ||
    normalizeMix(over?.revenueMix) ||
    normalizeMix(base?.revenueMix) ||
    null

  // 若有 revenueMix，industries 順序改由 mix 決定
  const finalIndustries = revenueMix
    ? revenueMix.map((m) => m.industry)
    : industries

  // 3. themes：合併 DB override + overlay + base，去重
  const themeSet = new Set()
  for (const t of base?.themes || []) if (t) themeSet.add(t)
  for (const t of over?.themes || []) if (t) themeSet.add(t)
  for (const t of override?.themes || []) if (t) themeSet.add(t)
  const themes = Array.from(themeSet)

  // 4. strategy：override > overlay > base
  const strategy = override?.strategy || over?.strategy || base?.strategy || null

  return {
    industries: finalIndustries,
    primaryIndustry: finalIndustries[0],
    revenueMix,
    themes,
    strategy,
  }
}

