/**
 * Holdings sector / strategy aggregations
 *
 * 用於 `/holding-checkup` 持倉頁上方的「族群分佈」總覽。
 * 純函式，方便單元測試；元件只負責渲染。
 */

const UNCLASSIFIED = '未分類'

function marketValue(item) {
  if (!item) return 0
  if (Number.isFinite(item.value)) return Number(item.value)
  const price = Number(item.price ?? item.currentPrice ?? item.cost ?? 0)
  const qty = Number(item.qty ?? item.quantity ?? 0)
  return price > 0 && qty > 0 ? price * qty : 0
}

/**
 * @param {Array} holdings  當前持股陣列（含 code / value / qty / price）
 * @param {Object} stockMeta  STOCK_META（code → { industry, strategy, ... }）
 * @returns {{
 *   industryByValue: Array<{ key: string, value: number, count: number, pct: number }>,
 *   strategyByCount: Array<{ key: string, count: number }>,
 *   totalValue: number,
 *   totalCount: number,
 *   unclassifiedCount: number,
 *   warnings: Array<{ key: string, count: number, pct: number, reason: 'value'|'count'|'both' }>,
 *   overDiversified: boolean,
 * }}
 */
export function aggregateBySector(holdings, stockMeta) {
  const list = Array.isArray(holdings) ? holdings : []
  const meta = stockMeta || {}

  const indMap = new Map() // key → { value, count }
  const stratMap = new Map() // key → count
  let unclassifiedCount = 0

  for (const item of list) {
    if (!item?.code) continue
    const m = meta[item.code]
    const ind = m?.industry || UNCLASSIFIED
    const strat = m?.strategy || UNCLASSIFIED
    if (!m?.industry) unclassifiedCount += 1

    const v = marketValue(item)
    const prev = indMap.get(ind) || { value: 0, count: 0 }
    indMap.set(ind, { value: prev.value + v, count: prev.count + 1 })

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

  const strategyByCount = Array.from(stratMap.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)

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
    strategyByCount,
    totalValue,
    totalCount,
    unclassifiedCount,
    warnings,
    overDiversified,
  }
}

export const HOLDING_UNCLASSIFIED_LABEL = UNCLASSIFIED
