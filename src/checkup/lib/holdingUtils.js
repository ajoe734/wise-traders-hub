/**
 * Holdings sector / theme / strategy aggregations
 *
 * 用於 `/holding-checkup` 持倉頁上方的「族群分佈」總覽。
 *
 * 核心邏輯：多族群加權
 *   - 若個股有 revenueMix → 市值按 pct 拆到多個產業桶
 *   - 若只有 industries[] → 市值平均拆到每個產業桶
 *   - 若完全無資料 → 全額計入「未分類」
 *
 * 純函式，方便單元測試；元件只負責渲染。
 */

import { getMultiMeta, UNCLASSIFIED } from './stockMetaMulti.js'

function marketValue(item) {
  if (!item) return 0
  if (Number.isFinite(item.value)) return Number(item.value)
  const price = Number(item.price ?? item.currentPrice ?? item.cost ?? 0)
  const qty = Number(item.qty ?? item.quantity ?? 0)
  return price > 0 && qty > 0 ? price * qty : 0
}

/**
 * @param {Array} holdings  當前持股陣列（含 code / value / qty / price）
 * @param {Object} stockMeta  STOCK_META（code → { industry, strategy, themes, ... }）
 * @param {Object} [overrides]  holding_meta_overrides map: { [code]: row }
 * @returns {{
 *   industryByValue: Array<{ key: string, value: number, count: number, pct: number }>,
 *   themeByCount: Array<{ key: string, count: number }>,
 *   strategyByCount: Array<{ key: string, count: number }>,
 *   totalValue: number,
 *   totalCount: number,
 *   unclassifiedCount: number,
 *   warnings: Array<{ key: string, count: number, pct: number, reason: 'value'|'count'|'both' }>,
 *   overDiversified: boolean,
 *   multiIndustryCount: number,
 * }}
 */
export function aggregateBySector(holdings, stockMeta, overrides) {
  const list = Array.isArray(holdings) ? holdings : []
  const meta = stockMeta || {}
  const ov = overrides || {}

  const indMap = new Map() // key → { value, count(整檔數，不拆) }
  const themeMap = new Map() // key → count
  const stratMap = new Map() // key → count
  let unclassifiedCount = 0
  let multiIndustryCount = 0

  for (const item of list) {
    if (!item?.code) continue
    const { industries, revenueMix, themes, strategy } = getMultiMeta(
      item.code,
      meta,
      ov[item.code],
    )
    const isUnclassified =
      industries.length === 1 && industries[0] === UNCLASSIFIED
    if (isUnclassified) unclassifiedCount += 1
    if (industries.length > 1) multiIndustryCount += 1

    const v = marketValue(item)

    // 產業：按 revenueMix 加權，或 industries 平均拆
    const weights = revenueMix
      ? revenueMix.map((m) => ({ key: m.industry, w: m.pct / 100 }))
      : industries.map((k) => ({ key: k, w: 1 / industries.length }))

    // 每檔在同一產業桶只算 1 次（避免多族群導致 count 膨脹到 > 總檔數）
    const countedInd = new Set()
    for (const { key, w } of weights) {
      const prev = indMap.get(key) || { value: 0, count: 0 }
      const nextCount = countedInd.has(key) ? prev.count : prev.count + 1
      countedInd.add(key)
      indMap.set(key, { value: prev.value + v * w, count: nextCount })
    }

    // 題材：每檔在每個 theme 各算 1 次
    const countedTheme = new Set()
    for (const t of themes) {
      if (countedTheme.has(t)) continue
      countedTheme.add(t)
      themeMap.set(t, (themeMap.get(t) || 0) + 1)
    }

    // 策略：每檔 1 次
    const strat = strategy || UNCLASSIFIED
    stratMap.set(strat, (stratMap.get(strat) || 0) + 1)
  }

  const totalValue =
    Array.from(indMap.values()).reduce((s, x) => s + (x.value || 0), 0) || 0
  const totalCount = list.length
  const denom = totalValue > 0 ? totalValue : 1

  const industryByValue = Array.from(indMap.entries())
    .map(([key, x]) => ({
      key,
      value: x.value,
      count: x.count,
      pct: (x.value / denom) * 100,
    }))
    .sort((a, b) => b.value - a.value || b.count - a.count)

  const themeByCount = Array.from(themeMap.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)

  const strategyByCount = Array.from(stratMap.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)

  // 集中警示：改用「單一產業 > 25%」為主，或 ≥3 檔（老標準）
  const warnings = industryByValue
    .filter((x) => x.key !== UNCLASSIFIED)
    .filter((x) => x.pct > 25 || x.count >= 3)
    .map((x) => {
      const byVal = x.pct > 25
      const byCnt = x.count >= 3
      return {
        key: x.key,
        count: x.count,
        pct: x.pct,
        reason: byVal && byCnt ? 'both' : byVal ? 'value' : 'count',
      }
    })

  const industryCount = industryByValue.filter((x) => x.key !== UNCLASSIFIED).length
  const maxPct = industryByValue[0]?.pct ?? 0
  const overDiversified = industryCount > 6 && maxPct < 20

  return {
    industryByValue,
    themeByCount,
    strategyByCount,
    totalValue,
    totalCount,
    unclassifiedCount,
    multiIndustryCount,
    warnings,
    overDiversified,
  }
}

export const HOLDING_UNCLASSIFIED_LABEL = UNCLASSIFIED
