/**
 * Cloud Sync Hook（重構版 — 委派給 syncEngine）
 *
 * 對外 API 與舊版相同，內部全部走 src/checkup/lib/syncEngine.js。
 * Owner portfolio + portfolio view mode 才啟用雲端寫入。
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  OWNER_PORTFOLIO_ID,
  PORTFOLIO_VIEW_MODE,
  STATUS_MESSAGE_TIMEOUT_MS,
} from '../constants.js'
import { syncEngine } from '../lib/syncEngine.js'

export const useCloudSync = ({
  activePortfolioId,
  viewMode,
  setSaved = () => {},
  notifySaved = null,
} = {}) => {
  const [cloudSync, setCloudSync] = useState(false)
  const cloudSyncStateRef = useRef({ enabled: false, syncedAt: 0 })

  // owner gating
  const canUseCloud = viewMode === PORTFOLIO_VIEW_MODE && activePortfolioId === OWNER_PORTFOLIO_ID

  // 同步 syncEngine context
  useEffect(() => {
    syncEngine.setContext({ activePortfolioId, viewMode })
    const status = syncEngine.getStatus()
    cloudSyncStateRef.current = { enabled: status.enabled, syncedAt: status.syncedAt }
    setCloudSync(status.enabled)
  }, [activePortfolioId, viewMode])

  const emitSaved = useCallback(
    (message, timeout = STATUS_MESSAGE_TIMEOUT_MS.DEFAULT) => {
      if (typeof notifySaved === 'function') {
        notifySaved(message, timeout)
        return
      }
      setSaved(message)
      if (timeout != null) {
        setTimeout(() => setSaved(''), timeout)
      }
    },
    [notifySaved, setSaved]
  )

  const setCloudStateForPortfolio = useCallback((pid, nextViewMode = PORTFOLIO_VIEW_MODE) => {
    syncEngine.setContext({ activePortfolioId: pid, viewMode: nextViewMode })
    const status = syncEngine.getStatus()
    cloudSyncStateRef.current = { enabled: status.enabled, syncedAt: status.syncedAt }
    setCloudSync(status.enabled)
  }, [])

  // 舊 API：以 action 名稱直寫；委派給 syncEngine（透過 slice mapping）
  // 為了維持 100% 向後相容，這裡保留低階形狀
  const scheduleCloudSave = useCallback(
    (action, data, successMsg) => {
      // 舊 caller 用 action 名（save-holdings, save-events, save-brain 等），
      // syncEngine 內部以 slice 為主，這裡將 action → slice 映射。
      const ACTION_TO_SLICE = {
        'save-holdings': 'holdings',
        'save-events': 'newsEvents',
        'save-brain': 'strategyBrain',
        'save-research-history': 'researchHistory',
      }
      const slice = ACTION_TO_SLICE[action]
      if (slice) {
        // 只走 cloud 寫入；local 由各自 hook 已處理（避免雙重寫入造成競態）
        syncEngine.persistSlice(slice, data, {
          notifySaved: successMsg ? (msg) => emitSaved(msg) : undefined,
          successMsg,
          skipCloud: false,
        })
      }
    },
    [emitSaved]
  )

  const cancelCloudSave = useCallback(() => {
    // 細粒度取消已不需要：syncEngine debounce 會自動覆蓋
  }, [])

  const cancelAllCloudSaves = useCallback(() => {
    syncEngine.cancelAll()
  }, [])

  const syncAnalysisFromCloud = useCallback(async (portfolioId) => {
    if (portfolioId !== OWNER_PORTFOLIO_ID) return null
    return syncEngine.fetchCloudSlice('analysisHistory')
  }, [])

  const syncResearchFromCloud = useCallback(async (portfolioId) => {
    if (portfolioId !== OWNER_PORTFOLIO_ID) return null
    return syncEngine.fetchCloudSlice('researchHistory')
  }, [])

  const deleteAnalysisFromCloud = useCallback(
    async (reportId, reportDate) => {
      if (!canUseCloud) return false
      return syncEngine.deleteAnalysis({ id: reportId, date: reportDate })
    },
    [canUseCloud]
  )

  const saveAnalysisToCloud = useCallback(
    async (report) => {
      if (!canUseCloud) return
      // analysisHistory 的雲端寫入是透過 'save-analysis' action（非 batch）
      // 這裡直接走原始 brain action，因為 analysis 是 append-only 不適合走 slice
      await syncEngine.persistSlice('analysisHistory', report, { skipCloud: true })
      // 仍保留 'save-analysis' 直送（單筆 append）
      try {
        const { API_ENDPOINTS } = await import('../constants.js')
        const res = await fetch(API_ENDPOINTS.BRAIN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save-analysis', data: { report } }),
        })
        if (res.ok) emitSaved('✅ 已同步至雲端', STATUS_MESSAGE_TIMEOUT_MS.BRIEF)
      } catch (err) {
        console.warn('saveAnalysisToCloud failed:', err)
      }
    },
    [canUseCloud, emitSaved]
  )

  const saveResearchToCloud = useCallback(
    async (research) => {
      if (!canUseCloud) return
      syncEngine.persistSlice('researchHistory', research, {
        successMsg: '✅ 已同步至雲端',
        notifySaved: (msg) => emitSaved(msg, STATUS_MESSAGE_TIMEOUT_MS.BRIEF),
      })
    },
    [canUseCloud, emitSaved]
  )

  useEffect(() => {
    return () => {
      syncEngine.cancelAll()
    }
  }, [])

  return {
    // State
    cloudSync,
    cloudSyncState: cloudSyncStateRef.current,
    canUseCloud,

    // Operations
    setCloudStateForPortfolio,
    scheduleCloudSave,
    cancelCloudSave,
    cancelAllCloudSaves,
    syncAnalysisFromCloud,
    syncResearchFromCloud,
    deleteAnalysisFromCloud,
    saveAnalysisToCloud,
    saveResearchToCloud,
  }
}
