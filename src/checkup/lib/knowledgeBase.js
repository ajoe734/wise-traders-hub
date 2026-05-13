// 知識庫存取模組（雲端為唯一權威來源）
//
// 設計原則（2026-05 重構）：
// 1. 雲端 checkup_knowledge_items 是「唯一」資料來源，不再有本地 JSON fallback
// 2. App 啟動 / Free Checkup 進入時呼叫 preloadKnowledgeBase() 預載到記憶體
// 3. buildKnowledgeContext / getRelevantKnowledge / getRelevantCases 維持「同步」介面
//    （prompt 組裝鏈是同步的，避免大規模重寫 dossierUtils）
// 4. 雲端載入失敗 → cache 留空，buildKnowledgeContext 回傳 ''，AI prompt 自然省略「知識庫參考」段落
//    （刻意不用過時的本地 fallback，避免誤導）

import { supabase } from '@/integrations/supabase/client'

const KNOWN_CATEGORIES = [
  'chip_analysis',
  'technical_analysis',
  'industry_trends',
  'strategy_cases',
  'news_correlation',
]

// ----- 記憶體快取 -----
// shape: { chip_analysis: [items...], ..., __source: 'cloud'|'empty', __loadedAt: Date }
let _cache = null
let _loadingPromise = null

function rowToItem(row) {
  const base = {
    id: row.item_id,
    __dbId: row.id ?? null,
    __category: row.category,
    title: row.title,
    fact: row.fact,
    interpretation: row.interpretation ?? '',
    action: row.action ?? '',
    confidence: Number(row.confidence ?? 0.75),
    tags: Array.isArray(row.tags) ? row.tags : [],
    triggerCondition: row.trigger_condition ?? null,
    expectedOutcome: row.expected_outcome ?? null,
    winRate: row.win_rate != null ? Number(row.win_rate) : null,
    sampleSize: row.sample_size ?? 0,
    sourceType: row.source_type ?? 'editorial',
    industryTags: Array.isArray(row.industry_tags) ? row.industry_tags : [],
    timeHorizon: row.time_horizon ?? null,
    lifecycleStatus: row.lifecycle_status ?? 'active',
  }
  if (row.category === 'strategy_cases') {
    base.lessons = row.lessons ?? ''
    base.return = row.return_pct != null ? Number(row.return_pct) : 0
    base.outcome = row.outcome ?? 'success'
  }
  return base
}

function effectiveScore(item) {
  const c = Number(item.confidence ?? 0.7)
  let base
  if (item.sampleSize >= 10 && typeof item.winRate === 'number') {
    base = c * (0.5 + 0.5 * item.winRate)
  } else {
    base = c
  }
  if (item.lifecycleStatus === 'rescue') base *= 0.5
  return base
}

function buildEmptyCache(reason = 'empty') {
  const cache = { __source: reason, __loadedAt: new Date() }
  for (const cat of KNOWN_CATEGORIES) cache[cat] = []
  return cache
}

export function resetKnowledgeBaseCache() {
  _cache = null
  _loadingPromise = null
}

export function preloadKnowledgeBase({ force = false } = {}) {
  if (_cache && !force) return Promise.resolve(_cache)
  if (_loadingPromise && !force) return _loadingPromise

  _loadingPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('checkup_knowledge_items')
        .select('id,category,item_id,title,fact,interpretation,action,lessons,return_pct,outcome,confidence,tags,is_active,updated_at,version,trigger_condition,expected_outcome,win_rate,sample_size,source_type,industry_tags,time_horizon,lifecycle_status')
        .eq('is_active', true)
        .in('lifecycle_status', ['active', 'rescue'])

      if (error) throw error
      if (!data || data.length === 0) {
        console.warn('[knowledgeBase] cloud returned 0 rows — knowledge context will be empty')
        _cache = buildEmptyCache('empty_cloud')
        return _cache
      }

      const next = buildEmptyCache('cloud')
      for (const row of data) {
        if (!next[row.category]) next[row.category] = []
        next[row.category].push(rowToItem(row))
      }
      _cache = next
      return _cache
    } catch (err) {
      console.warn('[knowledgeBase] cloud preload failed — knowledge context will be empty:', err?.message ?? err)
      _cache = buildEmptyCache('error')
      return _cache
    } finally {
      _loadingPromise = null
    }
  })()
  return _loadingPromise
}

function getCacheSync() {
  if (_cache) return _cache
  // 還沒預載 → 立即回傳空 cache 撐住，背景補拉雲端
  _cache = buildEmptyCache('pending')
  preloadKnowledgeBase({ force: true }).catch(() => {})
  return _cache
}

export function getKnowledgeSource() {
  return getCacheSync().__source
}

export function getKnowledgeLoadedAt() {
  return getCacheSync().__loadedAt
}

// ----- 主邏輯 -----

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

  const result = unique.sort((a, b) => effectiveScore(b) - effectiveScore(a)).slice(0, maxItems)
  rememberHits(result, 'knowledge')
  return result
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

  const result = items.slice(0, maxItems)
  rememberHits(result, 'strategy_cases')
  return result
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

let _hitBuffer = []

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

export async function flushKnowledgeHits({ stockCode = null, context = null } = {}) {
  if (_hitBuffer.length === 0) return { inserted: 0 }
  const buffer = _hitBuffer
  _hitBuffer = []

  const seen = new Set()
  const unique = buffer.filter(h => {
    const k = h.dbId ?? h.itemId
    if (seen.has(k)) return false
    seen.add(k)
    return !!h.dbId
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

export function _resetKnowledgeCacheForTests() {
  _cache = null
  _loadingPromise = null
  _hitBuffer = []
}
