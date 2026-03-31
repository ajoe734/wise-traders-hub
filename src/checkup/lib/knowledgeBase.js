// 知識庫存取模組
// 供 dossierUtils.js 等 prompt 組裝層使用
// 只注入高信心度、與持股策略相關的條目，避免 prompt 膨脹

import chipAnalysis from './knowledge-base/chip-analysis.json'
import technicalAnalysis from './knowledge-base/technical-analysis.json'
import industryTrends from './knowledge-base/industry-trends.json'
import strategyCases from './knowledge-base/strategy-cases.json'
import newsCorrelation from './knowledge-base/news-correlation.json'

// strategy 欄位 → 最相關的知識庫分類
const STRATEGY_KNOWLEDGE_MAP = {
  成長股: [industryTrends, technicalAnalysis],
  景氣循環: [industryTrends, technicalAnalysis],
  事件驅動: [newsCorrelation, chipAnalysis],
  權證: [chipAnalysis, technicalAnalysis],
  ETF指數: [technicalAnalysis],
}

/**
 * 依持股的 strategy 類型，回傳最相關的高信心度知識條目
 * @param {{ strategy?: string, industry?: string }} stockMeta
 * @param {{ maxItems?: number, minConfidence?: number }} options
 * @returns {{ fact: string, interpretation: string, action: string, title: string }[]}
 */
export function getRelevantKnowledge(stockMeta = {}, { maxItems = 3, minConfidence = 0.70 } = {}) {
  const { strategy } = stockMeta
  const sources = STRATEGY_KNOWLEDGE_MAP[strategy] ?? [technicalAnalysis]

  const candidates = sources.flatMap((source) =>
    (source.items ?? []).filter((item) => (item.confidence ?? 0) >= minConfidence)
  )

  // 去重（同 id 只留一次）
  const seen = new Set()
  const unique = candidates.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })

  // 按信心度降序，取前 N 條
  return unique.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)).slice(0, maxItems)
}

/**
 * 取得與持股 strategy 相關的歷史策略案例（只取成功案例）
 * @param {{ strategy?: string }} stockMeta
 * @param {{ maxItems?: number }} options
 * @returns {{ title: string, fact: string, lessons: string }[]}
 */
export function getRelevantCases(stockMeta = {}, { maxItems = 2 } = {}) {
  const { strategy } = stockMeta
  const strategyTagMap = {
    事件驅動: ['事件驅動', '法說會', '月營收', '催化劑'],
    權證: ['權證', '時間價值', '事件驅動'],
    成長股: ['趨勢追蹤', '成長股', '技術面', '基本面'],
    景氣循環: ['循環股', '產業輪動', '景氣'],
  }

  const tags = strategyTagMap[strategy] ?? []
  const items = (strategyCases.items ?? []).filter(
    (item) =>
      item.outcome === 'success' &&
      tags.length > 0 &&
      item.tags?.some((t) => tags.includes(t))
  )

  return items.slice(0, maxItems)
}

/**
 * 格式化知識條目為 prompt 文字（結構化格式）
 */
export function formatKnowledgeItem(item) {
  return `【${item.title}】
  事實：${item.fact}
  解讀：${item.interpretation}
  行動：${item.action}
  信心度：${(item.confidence * 100).toFixed(0)}%`
}

/**
 * 格式化策略案例為 prompt 文字（結構化格式）
 */
export function formatCaseItem(item) {
  return `【${item.title}】
  背景：${item.fact}
  教訓：${item.lessons}
  報酬：${(item.return * 100).toFixed(0)}%`
}

/**
 * 回傳 prompt 可用的知識摘要區塊（有內容才回傳，空字串代表略過）
 */
export function buildKnowledgeContext(stockMeta = {}) {
  const knowledge = getRelevantKnowledge(stockMeta)
  const cases = getRelevantCases(stockMeta)

  if (knowledge.length === 0 && cases.length === 0) return ''

  const lines = []
  lines.push('=== 知識庫參考 ===')

  if (knowledge.length > 0) {
    lines.push('')
    lines.push('📊 相關知識：')
    knowledge.forEach((item, index) => {
      lines.push(`${index + 1}. ${formatKnowledgeItem(item)}`)
      if (index < knowledge.length - 1) lines.push('')
    })
  }

  if (cases.length > 0) {
    lines.push('')
    lines.push('📚 歷史案例：')
    cases.forEach((item, index) => {
      lines.push(`${index + 1}. ${formatCaseItem(item)}`)
      if (index < cases.length - 1) lines.push('')
    })
  }

  lines.push('')
  lines.push('===============')

  return lines.join('\n')
}
