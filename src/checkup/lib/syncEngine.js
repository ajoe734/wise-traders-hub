/**
 * syncEngine — 統一 localStorage ↔ checkup-brain 雲端同步入口
 *
 * 設計原則：
 *  - 對上層提供「slice」概念（holdings / events / brain / analysis / research）
 *  - 對下封裝 savePortfolioData（localStorage 雙寫第一寫）
 *    + checkup-brain edge function（雙寫第二寫，僅在 owner portfolio 啟用）
 *  - 維護 sentinel UUID 隔離（demo / 非 owner portfolio 不寫雲端）
 *  - debounce 雲端寫入，TTL 控制 cloud → local 拉取
 *  - 保留既有 readSyncAt / writeSyncAt key 名稱以維持回滾安全
 *
 * 對外 API：
 *   syncEngine.persistSlice(slice, data, opts)   寫 local + 排程 cloud
 *   syncEngine.fetchCloudSlice(slice)            讀 cloud（含 TTL）
 *   syncEngine.deleteAnalysis({id, date})        刪 cloud analysis
 *   syncEngine.cancelAll()                       清掉所有 debounce
 *   syncEngine.setContext({activePortfolioId, viewMode}) 切 portfolio 時更新 owner gating
 *   syncEngine.getStatus()                       { enabled, syncedAt, pendingActions }
 *
 * 注意：本層**不直接動 React state**。狀態更新仍由呼叫端 setState；本層只負責 IO。
 */

import {
  API_ENDPOINTS,
  CLOUD_SAVE_DEBOUNCE,
  CLOUD_SYNC_TTL,
  OWNER_PORTFOLIO_ID,
  PORTFOLIO_ALIAS_TO_SUFFIX,
  PORTFOLIO_VIEW_MODE,
} from '../constants.js'
import { savePortfolioData, readSyncAt, writeSyncAt } from './portfolioUtils.js'

// slice → { suffix?: localStorage suffix, cloudAction?: 雲端 action, syncKey?: TTL key }
const SLICE_REGISTRY = {
  holdings: {
    suffix: PORTFOLIO_ALIAS_TO_SUFFIX.holdings,
    cloudAction: 'save-holdings',
    cloudGetAction: 'get-holdings',
  },
  tradeLog: { suffix: PORTFOLIO_ALIAS_TO_SUFFIX.tradeLog },
  targets: { suffix: PORTFOLIO_ALIAS_TO_SUFFIX.targets },
  fundamentals: { suffix: PORTFOLIO_ALIAS_TO_SUFFIX.fundamentals },
  watchlist: { suffix: PORTFOLIO_ALIAS_TO_SUFFIX.watchlist },
  analystReports: { suffix: PORTFOLIO_ALIAS_TO_SUFFIX.analystReports },
  reportRefreshMeta: { suffix: 'report-refresh-meta-v1' },
  holdingDossiers: { suffix: PORTFOLIO_ALIAS_TO_SUFFIX.holdingDossiers },
  newsEvents: {
    suffix: PORTFOLIO_ALIAS_TO_SUFFIX.newsEvents,
    cloudAction: 'save-events',
    cloudGetAction: 'load-events',
  },
  analysisHistory: {
    suffix: PORTFOLIO_ALIAS_TO_SUFFIX.analysisHistory,
    cloudGetAction: 'get-analysis-history',
    syncKey: 'pf-analysis-cloud-sync-at',
  },
  dailyReport: { suffix: PORTFOLIO_ALIAS_TO_SUFFIX.dailyReport },
  reversalConditions: { suffix: PORTFOLIO_ALIAS_TO_SUFFIX.reversalConditions },
  strategyBrain: {
    suffix: PORTFOLIO_ALIAS_TO_SUFFIX.strategyBrain,
    cloudAction: 'save-brain',
    cloudGetAction: 'get-brain',
  },
  brainValidation: { suffix: 'brain-validation-v1' },
  researchHistory: {
    suffix: PORTFOLIO_ALIAS_TO_SUFFIX.researchHistory,
    cloudAction: 'save-research-history',
    cloudGetAction: 'get-research-history',
    syncKey: 'pf-research-cloud-sync-at',
  },
  portfolioNotes: { suffix: PORTFOLIO_ALIAS_TO_SUFFIX.portfolioNotes },
}

const CLOUD_TIMESTAMP_KEY = 'pf-cloud-sync-at'

function createSyncEngine() {
  let context = { activePortfolioId: OWNER_PORTFOLIO_ID, viewMode: PORTFOLIO_VIEW_MODE }
  let cloudEnabled = true
  let lastCloudSyncAt = readSyncAt(CLOUD_TIMESTAMP_KEY)
  const debounceTimers = {}
  let fetchImpl = (...args) => globalThis.fetch(...args)

  // sentinel: 只有 owner portfolio + portfolio mode 才同步雲端
  function recomputeCloudGating() {
    cloudEnabled =
      context.viewMode === PORTFOLIO_VIEW_MODE &&
      context.activePortfolioId === OWNER_PORTFOLIO_ID
    lastCloudSyncAt = cloudEnabled ? readSyncAt(CLOUD_TIMESTAMP_KEY) : 0
  }

  recomputeCloudGating()

  function setContext(next) {
    context = { ...context, ...next }
    recomputeCloudGating()
  }

  function setFetch(fn) {
    if (typeof fn === 'function') fetchImpl = fn
  }

  function getRegistry(slice) {
    const meta = SLICE_REGISTRY[slice]
    if (!meta) throw new Error(`[syncEngine] Unknown slice: ${slice}`)
    return meta
  }

  /**
   * 寫一個 slice：local（必）+ cloud（選擇性，僅 owner）
   * @param {string} slice
   * @param {*} data
   * @param {object} [opts]
   * @param {string} [opts.successMsg]   成功訊息
   * @param {boolean} [opts.skipCloud]   強制跳過雲端
   * @param {(msg:string)=>void} [opts.notifySaved]
   */
  async function persistSlice(slice, data, opts = {}) {
    const meta = getRegistry(slice)
    const { activePortfolioId } = context
    const { skipCloud = false, successMsg = null, notifySaved = null } = opts

    if (meta.suffix && data !== undefined) {
      await savePortfolioData(activePortfolioId, meta.suffix, data)
    }

    if (!skipCloud && meta.cloudAction && cloudEnabled) {
      scheduleCloudSave(meta.cloudAction, data, successMsg, notifySaved)
    }
  }

  function scheduleCloudSave(action, data, successMsg, notifySaved) {
    if (!cloudEnabled) return
    clearTimeout(debounceTimers[action])
    debounceTimers[action] = setTimeout(async () => {
      try {
        const res = await fetchImpl(API_ENDPOINTS.BRAIN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, data }),
        })
        if (!res.ok) {
          let detail = {}
          try {
            detail = await res.json()
          } catch {
            /* ignore */
          }
          throw new Error(detail?.error || `Sync failed (${res.status})`)
        }
        const now = Date.now()
        lastCloudSyncAt = now
        writeSyncAt(CLOUD_TIMESTAMP_KEY, now)
        if (successMsg && typeof notifySaved === 'function') {
          notifySaved(successMsg)
        }
      } catch (err) {
        // 雲端失敗不影響 local；下次寫入會再嘗試
        if (typeof console !== 'undefined') {
          console.warn(`[syncEngine] cloud save "${action}" failed:`, err)
        }
      }
    }, CLOUD_SAVE_DEBOUNCE)
  }

  /**
   * 從雲端拉取 slice（含 TTL gating）。
   * 回 null 表示不應更新（TTL 未到 / 非 owner / 無資料）。
   */
  async function fetchCloudSlice(slice) {
    const meta = getRegistry(slice)
    if (!cloudEnabled || !meta.cloudGetAction) return null

    if (meta.syncKey) {
      const last = readSyncAt(meta.syncKey)
      if (last && Date.now() - last < CLOUD_SYNC_TTL) return null
    }

    try {
      let res
      if (meta.cloudGetAction === 'get-analysis-history' || meta.cloudGetAction === 'get-research-history' || meta.cloudGetAction === 'get-brain' || meta.cloudGetAction === 'get-holdings' || meta.cloudGetAction === 'load-events') {
        // 後端兩種風格：part 走 GET ?action=, part 走 POST {action}
        // checkup-brain 全部走 POST { action }
        res = await fetchImpl(API_ENDPOINTS.BRAIN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: meta.cloudGetAction }),
        })
      } else {
        res = await fetchImpl(`${API_ENDPOINTS.BRAIN}?action=${meta.cloudGetAction}`)
      }
      if (!res.ok) throw new Error(`fetch ${meta.cloudGetAction} ${res.status}`)
      const json = await res.json().catch(() => ({}))
      const payload =
        json?.content ?? json?.history ?? json?.events ?? json?.holdings ?? json?.data ?? json
      if (meta.syncKey) writeSyncAt(meta.syncKey, Date.now())
      return payload ?? null
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn(`[syncEngine] cloud fetch "${slice}" failed:`, err)
      }
      return null
    }
  }

  async function deleteAnalysis({ id, date }) {
    if (!cloudEnabled) return false
    try {
      const res = await fetchImpl(API_ENDPOINTS.BRAIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-analysis', data: { id, date } }),
      })
      if (!res.ok) throw new Error(`delete-analysis ${res.status}`)
      const now = Date.now()
      lastCloudSyncAt = now
      writeSyncAt('pf-analysis-cloud-sync-at', now)
      return true
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[syncEngine] deleteAnalysis failed:', err)
      }
      return false
    }
  }

  function cancelAll() {
    Object.keys(debounceTimers).forEach((k) => clearTimeout(debounceTimers[k]))
    Object.keys(debounceTimers).forEach((k) => delete debounceTimers[k])
  }

  function getStatus() {
    return {
      enabled: cloudEnabled,
      syncedAt: lastCloudSyncAt,
      pendingActions: Object.keys(debounceTimers),
      activePortfolioId: context.activePortfolioId,
      viewMode: context.viewMode,
    }
  }

  return {
    persistSlice,
    fetchCloudSlice,
    deleteAnalysis,
    cancelAll,
    setContext,
    setFetch,
    getStatus,
    // 暴露給測試 / 偵錯
    _registry: SLICE_REGISTRY,
  }
}

// 單例
export const syncEngine = createSyncEngine()
export { createSyncEngine }
