/**
 * stockMetaMulti — 統一多族群 metadata 取值層
 *
 * 合併優先順序（高 → 低）：
 *   1. `holding_meta_overrides` DB override（單值 industry；本輪尚未支援多族群）
 *   2. `stockIndustry.json` 覆蓋層（多族群 + revenueMix + themes 修正）
 *   3. `STOCK_META` (seedData) — 手 key 的單值 industry / strategy / themes
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

function normalizeMix(mix) {
  if (!Array.isArray(mix) || mix.length === 0) return null
  const cleaned = mix
    .filter((m) => m && m.industry && Number.isFinite(Number(m.pct)))
    .map((m) => ({ industry: String(m.industry), pct: Number(m.pct) }))
  if (cleaned.length === 0) return null
  const total = cleaned.reduce((s, m) => s + m.pct, 0)
  if (total <= 0) return null
  // 正規化到 100
  return cleaned.map((m) => ({ industry: m.industry, pct: (m.pct / total) * 100 }))
}

/**
 * @param {string|number} code
 * @param {Object} stockMeta   STOCK_META (seedData)
 * @param {Object} [override]  單筆 holding_meta_overrides row（可選）
 * @returns {{industries: string[], primaryIndustry: string, revenueMix: Array<{industry:string,pct:number}>|null, themes: string[], strategy: string|null}}
 */
export function getMultiMeta(code, stockMeta, override) {
  const key = String(code || '').trim()
  const base = (stockMeta && stockMeta[key]) || null
  const over = OVERLAY[key] || null

  // 1. industries[]：override > overlay > base.industry > 未分類
  let industries = null
  if (over?.industries?.length) industries = over.industries.slice()
  else if (base?.industries?.length) industries = base.industries.slice()
  else if (override?.industry) industries = [override.industry]
  else if (base?.industry) industries = [base.industry]
  else industries = [UNCLASSIFIED]

  // 2. revenueMix：overlay > base（沒有則 null，走平均拆）
  const revenueMix =
    normalizeMix(over?.revenueMix) ||
    normalizeMix(base?.revenueMix) ||
    null

  // 若有 revenueMix，industries 順序改由 mix 決定
  const finalIndustries = revenueMix
    ? revenueMix.map((m) => m.industry)
    : industries

  // 3. themes：合併 base + overlay，去重
  const themeSet = new Set()
  for (const t of base?.themes || []) if (t) themeSet.add(t)
  for (const t of over?.themes || []) if (t) themeSet.add(t)
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
