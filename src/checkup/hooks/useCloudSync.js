/**
 * Cloud Sync Hook
 *
 * Manages cloud synchronization state and operations.
 * Only enabled for owner portfolio in portfolio view mode.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  OWNER_PORTFOLIO_ID,
  PORTFOLIO_VIEW_MODE,
  CLOUD_SYNC_TTL,
  CLOUD_SAVE_DEBOUNCE,
  STATUS_MESSAGE_TIMEOUT_MS,
} from '../constants.js'

/**
 * Read sync timestamp from localStorage
 */
const readSyncAt = (key) => {
  try {
    return Number(localStorage.getItem(key) || 0)
  } catch {
    return 0
  }
}

/**
 * Write sync timestamp to localStorage
 */
const writeSyncAt = (key, value) => {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* best-effort local sync timestamp */
  }
}

/**
 * Cloud Sync Hook
 *
 * @param {Object} params
 * @param {string} params.activePortfolioId - Current portfolio ID
 * @param {string} params.viewMode - Current view mode (portfolio/overview)
 * @param {Function} params.setSaved - Callback to show save status
 * @returns {Object} Cloud sync state and operations
 */
export const useCloudSync = ({
  activePortfolioId,
  viewMode,
  setSaved = () => {},
  notifySaved = null,
} = {}) => {
  const [cloudSync, setCloudSync] = useState(false)
  const cloudSyncStateRef = useRef({ enabled: false, syncedAt: 0 })
  const cloudSaveTimersRef = useRef({})

  // Check if cloud sync should be enabled
  const canUseCloud = viewMode === PORTFOLIO_VIEW_MODE && activePortfolioId === OWNER_PORTFOLIO_ID

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

  /**
   * Set cloud state for a portfolio
   */
  const setCloudStateForPortfolio = useCallback((pid, nextViewMode = PORTFOLIO_VIEW_MODE) => {
    const enabled = nextViewMode === PORTFOLIO_VIEW_MODE && pid === OWNER_PORTFOLIO_ID
    cloudSyncStateRef.current = {
      enabled,
      syncedAt: enabled ? readSyncAt('pf-cloud-sync-at') : 0,
    }
    setCloudSync(enabled)
  }, [])

  /**
   * Schedule a cloud save operation with debounce
   */
  const scheduleCloudSave = useCallback(
    (action, data, successMsg) => {
      if (!cloudSyncStateRef.current.enabled) return

      clearTimeout(cloudSaveTimersRef.current[action])
      cloudSaveTimersRef.current[action] = setTimeout(async () => {
        try {
          const res = await fetch('/api/brain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, data }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data?.error || `Sync failed (${res.status})`)

          const now = Date.now()
          cloudSyncStateRef.current.syncedAt = now
          writeSyncAt('pf-cloud-sync-at', now)

          if (successMsg) {
            emitSaved(successMsg, STATUS_MESSAGE_TIMEOUT_MS.BRIEF)
          }
        } catch (err) {
          console.warn('Cloud save failed:', err)
        }
      }, CLOUD_SAVE_DEBOUNCE)
    },
    [emitSaved]
  )

  /**
   * Cancel a scheduled cloud save
   */
  const cancelCloudSave = useCallback((action) => {
    if (cloudSaveTimersRef.current[action]) {
      clearTimeout(cloudSaveTimersRef.current[action])
      delete cloudSaveTimersRef.current[action]
    }
  }, [])

  /**
   * Cancel all scheduled cloud saves
   */
  const cancelAllCloudSaves = useCallback(() => {
    Object.keys(cloudSaveTimersRef.current).forEach((action) => {
      clearTimeout(cloudSaveTimersRef.current[action])
    })
    cloudSaveTimersRef.current = {}
  }, [])

  /**
   * Sync analysis data from cloud
   */
  const syncAnalysisFromCloud = useCallback(async (portfolioId) => {
    if (portfolioId !== OWNER_PORTFOLIO_ID) return null

    const lastSyncAt = readSyncAt('pf-analysis-cloud-sync-at')
    const shouldSync = !lastSyncAt || Date.now() - lastSyncAt > CLOUD_SYNC_TTL

    if (!shouldSync) return null

    try {
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-analysis-history' }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) throw new Error(data?.error || `Sync failed (${res.status})`)

      writeSyncAt('pf-analysis-cloud-sync-at', Date.now())
      return data.content || []
    } catch (err) {
      console.warn('Failed to sync analysis from cloud:', err)
      return null
    }
  }, [])

  /**
   * Sync research data from cloud
   */
  const syncResearchFromCloud = useCallback(async (portfolioId) => {
    if (portfolioId !== OWNER_PORTFOLIO_ID) return null

    const lastSyncAt = readSyncAt('pf-research-cloud-sync-at')
    const shouldSync = !lastSyncAt || Date.now() - lastSyncAt > CLOUD_SYNC_TTL

    if (!shouldSync) return null

    try {
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-research-history' }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) throw new Error(data?.error || `Sync failed (${res.status})`)

      writeSyncAt('pf-research-cloud-sync-at', Date.now())
      return data.content || []
    } catch (err) {
      console.warn('Failed to sync research from cloud:', err)
      return null
    }
  }, [])

  /**
   * Delete analysis from cloud
   */
  const deleteAnalysisFromCloud = useCallback(
    async (reportId, reportDate) => {
      if (!canUseCloud) return false

      try {
        const res = await fetch('/api/brain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'delete-analysis',
            data: { id: reportId, date: reportDate },
          }),
        })
        const data = await res.json().catch(() => ({}))

        if (!res.ok) throw new Error(data?.error || `Delete failed (${res.status})`)

        const now = Date.now()
        cloudSyncStateRef.current.syncedAt = now
        writeSyncAt('pf-analysis-cloud-sync-at', now)

        return true
      } catch (err) {
        console.warn('Failed to delete analysis from cloud:', err)
        return false
      }
    },
    [canUseCloud]
  )

  /**
   * Save analysis to cloud
   */
  const saveAnalysisToCloud = useCallback(
    async (report) => {
      if (!canUseCloud) return

      scheduleCloudSave('analysis', { report }, '✅ 已同步至雲端')
    },
    [canUseCloud, scheduleCloudSave]
  )

  /**
   * Save research to cloud
   */
  const saveResearchToCloud = useCallback(
    async (research) => {
      if (!canUseCloud) return

      scheduleCloudSave('research', { research }, '✅ 已同步至雲端')
    },
    [canUseCloud, scheduleCloudSave]
  )

  /**
   * Initialize cloud sync state on mount
   */
  useEffect(() => {
    const lastSyncAt = readSyncAt('pf-cloud-sync-at')
    cloudSyncStateRef.current = {
      enabled: canUseCloud,
      syncedAt: canUseCloud ? lastSyncAt : 0,
    }
    setCloudSync(canUseCloud)

    // Cleanup on unmount
    return () => {
      cancelAllCloudSaves()
    }
  }, [canUseCloud, cancelAllCloudSaves])

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
