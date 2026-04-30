// 知識庫存取模組（雲端為主、JSON 為 fallback）
// 設計原則：
// 1. 雲端 checkup_knowledge_items 為權威來源
// 2. App 啟動 / Free Checkup 進入時呼叫 preloadKnowledgeBase() 預載到記憶體
// 3. buildKnowledgeContext / getRelevantKnowledge / getRelevantCases 維持「同步」介面
//    （prompt 組裝鏈是同步的，避免大規模重寫 dossierUtils）
// 4. 雲端載入失敗 → 自動 fallback 到打包進來的 JSON

import { supabase } from '@/integrations/supabase/client'
import chipAnalysisJson from './knowledge-base/chip-analysis.json'
import technicalAnalysisJson from './knowledge-base/technical-analysis.json'
import industryTrendsJson from './knowledge-base/industry-trends.json'
import strategyCasesJson from './knowledge-base/strategy-cases.json'
import newsCorrelationJson from './knowledge-base/news-correlation.json'

// ----- 雲端 category ↔ 本地 JSON 對照 -----
const CATEGORY_TO_LOCAL_JSON = {
  chip_analysis: chipAnalysisJson,
  technical_analysis: technicalAnalysisJson,
  industry_trends: industryTrendsJson,
  strategy_cases: strategyCasesJson,
  news_correlation: newsCorrelationJson,
}

// ----- 記憶體快取 -----
// shape: { chip_analysis: [items...], technical_analysis: [...], ..., __source: 'cloud'|'local', __loadedAt: Date }
let _cache = null
let _loadingPromise = null

/**
 * 將雲端 row → 統一 item shape（與本地 JSON 同形）
 */
function rowToItem(row) {
  const base = {
    id: row.item_id,
    title: row.title,
    fact: row.fact,
    interpretation: row.interpretation ?? '',
    action: row.action ?? '',
    confidence: Number(row.confidence ?? 0.75),
    tags: Array.isArray(row.tags) ? row.tags : [],
  }
  // strategy_cases 額外欄位
  if (row.category === 'strategy_cases') {
    base.lessons = row.lessons ?? ''
    base.return = row.return_pct != null ? Number(row.return_pct) : 0
    base.outcome = row.outcome ?? 'success'
  }
  return base
}

/**
 * 從本地 JSON 組出與雲端相同 shape 的快取（fallback 用）
 */
function buildLocalCache() {
  const cache = { __source: 'local', __loadedAt: new Date() }
  for (const [category, json] of Object.entries(CATEGORY_TO_LOCAL_JSON)) {
    cache[category] = (json.items ?? []).slice()
  }
  return cache
}

/**
 * 預載雲端知識庫到記憶體。
 * - 應在 App 啟動或 Free Checkup 進入時呼叫一次
 * - 重複呼叫會 dedupe
 * - 載入失敗 → 退回本地 JSON，並 console.warn
 */
export function preloadKnowledgeBase({ force = false } = {}) {
  if (_cache && !force) return Promise.resolve(_cache)
  if (_loadingPromise && !force) return _loadingPromise

  _loadingPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('checkup_knowledge_items')
        .select('category,item_id,title,fact,interpretation,action,lessons,return_pct,outcome,confidence,tags,is_active,updated_at,version')
        .eq('is_active', true)

      if (error) throw error
      if (!data || data.length === 0) {
        console.warn('[knowledgeBase] cloud returned 0 rows, falling back to local JSON')
        _cache = buildLocalCache()
        return _cache
      }

      const next = { __source: 'cloud', __loadedAt: new Date() }
      for (const category of Object.keys(CATEGORY_TO_LOCAL_JSON)) next[category] = []
      for (const row of data) {
        if (!next[row.category]) next[row.category] = []
        next[row.category].push(rowToItem(row))
      }
      // 任何 category 雲端為空 → 用本地 JSON 補
      for (const [category, json] of Object.entries(CATEGORY_TO_LOCAL_JSON)) {
        if (next[category].length === 0) next[category] = (json.items ?? []).slice()
      }
      _cache = next
      return _cache
    } catch (err) {
      console.warn('[knowledgeBase] cloud preload failed, falling back to local JSON:', err?.message ?? err)
      _cache = buildLocalCache()
      return _cache
    } finally {
      _loadingPromise = null
    }
  })()
  return _loadingPromise
}

/**
 * 取得目前快取（同步）。若尚未預載 → 立即用本地 JSON 撐住，並背景觸發雲端預載。
 */
function getCacheSync() {
  if (_cache) return _cache
  // 還沒預載過 → 用 local 立即返回，背景補拉雲端（下次呼叫就拿到雲端版）
  _cache = buildLocalCache()
  preloadKnowledgeBase({ force: true }).catch(() => {})
  return _cache
}

export function getKnowledgeSource() {
  return getCacheSync().__source
}

export function getKnowledgeLoadedAt() {
  return getCacheSync().__loadedAt
}

// ----- 主邏輯（保持與舊版相同的介面與行為）-----

// strategy 欄位 → 最相關的知識庫分類（雲端 category key）
const STRATEGY_KNOWLEDGE_MAP = {
  成長股: ['industry_trends', 'technical_analysis'],
  景氣循環: ['industry_trends', 'technical_analysis'],
  事件驅動: ['news_correlation', 'chip_analysis'],
  權證: ['chip_analysis', 'technical_analysis'],
  ETF指數: ['technical_analysis'],
}

export function getRelevantKnowledge(stockMeta = {}, { maxItems = 3, minConfidence = 0.70 } = {}) {
  const cache = getCacheSync()
  const { strategy } = stockMeta
  const categories = STRATEGY_KNOWLEDGE_MAP[strategy] ?? ['technical_analysis']

  const candidates = categories.flatMap((cat) =>
    (cache[cat] ?? []).filter((item) => (item.confidence ?? 0) >= minConfidence)
  )

  const seen = new Set()
  const unique = candidates.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })

  return unique.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)).slice(0, maxItems)
}

export function getRelevantCases(stockMeta = {}, { maxItems = 2 } = {}) {
  const cache = getCacheSync()
  const { strategy } = stockMeta
  const strategyTagMap = {
    事件驅動: ['事件驅動', '法說會', '月營收', '催化劑'],
    權證: ['權證', '時間價值', '事件驅動'],
    成長股: ['趨勢追蹤', '成長股', '技術面', '基本面'],
    景氣循環: ['循環股', '產業輪動', '景氣'],
  }

  const tags = strategyTagMap[strategy] ?? []
  const items = (cache.strategy_cases ?? []).filter(
    (item) =>
      item.outcome === 'success' &&
      tags.length > 0 &&
      item.tags?.some((t) => tags.includes(t))
  )

  return items.slice(0, maxItems)
}

export function formatKnowledgeItem(item) {
  return `【${item.title}】
  事實：${item.fact}
  解讀：${item.interpretation}
  行動：${item.action}
  信心度：${(item.confidence * 100).toFixed(0)}%`
}

export function formatCaseItem(item) {
  return `【${item.title}】
  背景：${item.fact}
  教訓：${item.lessons}
  報酬：${(item.return * 100).toFixed(0)}%`
}

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

// ============================================================
// 知識命中追蹤 (hit tracking)
// ============================================================
// 設計：
// - getRelevantKnowledge / getRelevantCases 內部會把當次選中的條目寫進 buffer
// - caller 在呼叫 AI 前後呼叫 flushKnowledgeHits({ stockCode, context }) 寫入 DB
// - 雲端 cache 中的 item.id 是 item_id（如 'ta-06'），DB 主鍵是 uuid，
//   所以 flush 時用 item_id 反查 uuid（rowToItem 帶 dbId 進來）

let _hitBuffer = [] // [{ itemId, dbId, confidence, category }]

function rememberHits(items, category) {
  if (!Array.isArray(items)) return
  for (const it of items) {
    if (!it?.id) continue
    _hitBuffer.push({
      itemId: it.id,
      dbId: it.__dbId ?? null,
      confidence: it.confidence ?? null,
      category: category ?? null,
    })
  }
}

/**
 * 將 buffer 寫入 checkup_knowledge_hits。
 * - 由 caller（AI 分析 workflow）在分析觸發後呼叫
 * - 失敗不阻擋主流程，只 console.warn
 */
export async function flushKnowledgeHits({ stockCode = null, context = null } = {}) {
  if (_hitBuffer.length === 0) return { inserted: 0 }
  const buffer = _hitBuffer
  _hitBuffer = []

  // 去重（同一次 flush，同一條 item 只記一次）
  const seen = new Set()
  const unique = buffer.filter(h => {
    const k = h.dbId ?? h.itemId
    if (seen.has(k)) return false
    seen.add(k)
    return !!h.dbId // 只寫有 dbId 的（雲端來源）；fallback 到 local JSON 時不記
  })
  if (unique.length === 0) return { inserted: 0 }

  try {
    const { data: { user } } = await supabase.auth.getUser()
    const userId = user?.id ?? null

    const rows = unique.map(h => ({
      knowledge_item_id: h.dbId,
      user_id: userId,
      stock_code: stockCode,
      context: context,
      confidence: h.confidence,
    }))
    const { error } = await supabase.from('checkup_knowledge_hits').insert(rows)
    if (error) {
      console.warn('[knowledgeBase] flush hits failed:', error.message)
      return { inserted: 0, error: error.message }
    }
    return { inserted: rows.length }
  } catch (err) {
    console.warn('[knowledgeBase] flush hits exception:', err?.message ?? err)
    return { inserted: 0, error: String(err) }
  }
}

export function _peekHitBufferForTests() {
  return _hitBuffer.slice()
}

// 測試 / Admin 用
export function _resetKnowledgeCacheForTests() {
  _cache = null
  _loadingPromise = null
  _hitBuffer = []
}
