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
 * 全市場細分產業分類表（public.stock_industry_map）執行期注入層。
 * 由 useStockIndustryMap 載入後呼叫一次；未注入時整層視為不存在。
 * @type {Record<string, {industries?: string[], revenueMix?: Array<{industry:string,pct:number}>|null, themes?: string[]}>}
 */
let AUTO_MAP = {}
/** 每次注入／清空遞增，供 UI 破除 memo 快取 */
let AUTO_MAP_VERSION = 0

/** 注入全市場分類表（key = 個股代號） */
export function setAutoIndustryMap(map) {
  AUTO_MAP = map && typeof map === 'object' ? map : {}
  AUTO_MAP_VERSION += 1
}

/** 測試／重置用 */
export function clearAutoIndustryMap() {
  AUTO_MAP = {}
  AUTO_MAP_VERSION += 1
}

export function getAutoIndustryMap() {
  return AUTO_MAP
}

export function getAutoIndustryMapVersion() {
  return AUTO_MAP_VERSION
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
  const auto = AUTO_MAP[key] || null
  const twseInd = TWSE[key] || null
  const finmindInd = FINMIND[key] || null

  // 1. industries[]：DB override（人工修正）> 全市場細分分類表 > overlay JSON
  //    > seed base > TWSE 官方大類 > FinMind > 未分類。
  //    分類表擺在 overlay/base 之前，是因為舊的手工 overlay 只有大類（例：3443 IC設計），
  //    而分類表是細分產業（3443 ASIC設計服務），本輪需求就是要細分取代大類。
  let industries = null
  let usedAuto = false
  if (Array.isArray(override?.industries) && override.industries.length) {
    industries = override.industries.slice()
  } else if (override?.industry) {
    industries = [override.industry]
  } else if (auto?.industries?.length) {
    industries = auto.industries.slice()
    usedAuto = true
  } else if (over?.industries?.length) {
    industries = over.industries.slice()
  } else if (base?.industries?.length) {
    industries = base.industries.slice()
  } else if (base?.industry) {
    industries = [base.industry]
  } else if (twseInd) {
    industries = [twseInd]
  } else if (finmindInd) {
    industries = [finmindInd]
  } else {
    industries = [UNCLASSIFIED]
  }


  // 2. revenueMix：DB override >（分類表，僅當 industries 來自分類表時）> overlay > base。
  //    採用分類表時不得回頭套 overlay/base 的營收組成 —— 兩者族群名稱不同調，
  //    混用會讓下方「以 mix 排序 industries」把細分族群換回舊大類。
  const revenueMix =
    normalizeMix(override?.revenue_mix) ||
    (usedAuto
      ? normalizeMix(auto?.revenueMix)
      : normalizeMix(over?.revenueMix) || normalizeMix(base?.revenueMix)) ||
    null




  // 若有 revenueMix，industries 順序改由 mix 決定；
  // 但 override 明確給了 industries 時必須完全尊重使用者輸入，
  // 即使 revenueMix 也來自 override（modal 會把 base revenueMix 一併回傳）也不能覆蓋。
  const hasIndustriesOverride =
    Array.isArray(override?.industries) && override.industries.length > 0
  const finalIndustries = hasIndustriesOverride
    ? industries
    : revenueMix
    ? revenueMix.map((m) => m.industry)
    : industries

  // 3. themes：合併 分類表 + base + overlay + DB override，去重
  const themeSet = new Set()
  for (const t of auto?.themes || []) if (t) themeSet.add(t)
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

