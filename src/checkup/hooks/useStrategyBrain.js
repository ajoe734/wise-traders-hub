/**
 * Strategy Brain Hook
 *
 * Manages strategy brain state, validation casebook, and rule lifecycle.
 */

import { useState, useCallback, useMemo } from 'react'
import {
  OWNER_PORTFOLIO_ID,
  BRAIN_VALIDATION_CASE_LIMIT,
  STATUS_MESSAGE_TIMEOUT_MS,
} from '../constants.js'
import {
  normalizeStrategyBrain,
  normalizeBrainValidationStore,
  normalizeBrainAuditBuckets,
  attachEvidenceRefsToBrainAudit,
  ensureBrainAuditCoverage,
  mergeBrainWithAuditLifecycle,
} from '../lib/brainRuntime.js'

/**
 * Read from localStorage
 */
const readStorageValue = (key) => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Strategy Brain Hook
 *
 * @param {Object} params
 * @param {string} params.activePortfolioId - Current portfolio ID
 * @param {string} params.viewMode - Current view mode
 * @param {boolean} params.canUseCloud - Whether cloud sync is enabled
 * @param {Function} params.setSaved - Show status callback
 * @returns {Object} Strategy brain state and operations
 */
export const useStrategyBrain = ({
  activePortfolioId: _activePortfolioId,
  viewMode: _viewMode,
  canUseCloud = false,
  setSaved = () => {},
  notifySaved = null,
} = {}) => {
  const [strategyBrain, setStrategyBrain] = useState(() =>
    normalizeStrategyBrain(readStorageValue(`pf-${OWNER_PORTFOLIO_ID}-brain-v1`))
  )
  const [brainValidation, setBrainValidation] = useState(() =>
    normalizeBrainValidationStore(readStorageValue(`pf-${OWNER_PORTFOLIO_ID}-brain-validation-v1`))
  )
  const [brainAudit, setBrainAudit] = useState(() =>
    normalizeBrainAuditBuckets(strategyBrain?.brainAudit)
  )

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
   * Update strategy brain with validation
   */
  const updateStrategyBrain = useCallback(async (pid, suffix, data) => {
    if (suffix !== 'brain-v1') return

    const normalized = normalizeStrategyBrain(data)
    setStrategyBrain(normalized)

    // Update audit buckets when brain changes
    if (normalized?.brainAudit) {
      setBrainAudit(normalizeBrainAuditBuckets(normalized.brainAudit))
    }
  }, [])

  /**
   * Update brain validation casebook
   */
  const updateBrainValidation = useCallback(async (pid, suffix, data) => {
    if (suffix !== 'brain-validation-v1') return

    const normalized = normalizeBrainValidationStore(data)
    setBrainValidation(normalized)
  }, [])

  /**
   * Add validation case to casebook
   */
  const addValidationCase = useCallback((newCase) => {
    if (!newCase) return

    setBrainValidation((prev) => {
      const normalized = normalizeBrainValidationStore(prev)
      const cases = normalized.cases || []

      // Check for duplicates
      const exists = cases.some(
        (c) => c?.id === newCase.id || (c?.text === newCase.text && c?.verdict === newCase.verdict)
      )

      if (exists) return prev

      const nextCases = [...cases, newCase].slice(-BRAIN_VALIDATION_CASE_LIMIT)
      return { ...normalized, cases: nextCases }
    })
  }, [])

  /**
   * Update brain audit buckets
   */
  const updateBrainAudit = useCallback((auditUpdate) => {
    if (!auditUpdate) return

    setBrainAudit((prev) => {
      const merged = {
        ...prev,
        ...auditUpdate,
        validatedRules: auditUpdate.validatedRules || prev.validatedRules,
        staleRules: auditUpdate.staleRules || prev.staleRules,
        invalidatedRules: auditUpdate.invalidatedRules || prev.invalidatedRules,
      }
      return normalizeBrainAuditBuckets(merged)
    })
  }, [])

  /**
   * Merge brain with audit lifecycle
   */
  const mergeBrainAudit = useCallback(
    (nextBrain, currentBrain) => {
      if (!nextBrain || !currentBrain) return nextBrain

      const withAudit = mergeBrainWithAuditLifecycle(nextBrain, currentBrain, brainAudit)
      return withAudit
    },
    [brainAudit]
  )

  /**
   * Ensure brain audit coverage
   */
  const ensureAuditCoverage = useCallback(
    (currentBrain, dossiers = null) => {
      return ensureBrainAuditCoverage(brainAudit, currentBrain, { dossiers })
    },
    [brainAudit]
  )

  /**
   * Attach evidence references to brain audit
   */
  const attachEvidenceRefs = useCallback(
    (evidenceRefs, defaultLastValidatedAt = null) => {
      return attachEvidenceRefsToBrainAudit(brainAudit, evidenceRefs, { defaultLastValidatedAt })
    },
    [brainAudit]
  )

  /**
   * Sync brain from cloud
   */
  const syncBrainFromCloud = useCallback(async () => {
    if (!canUseCloud) return null

    try {
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-brain' }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) throw new Error(data?.error || `Sync failed (${res.status})`)

      const normalized = normalizeStrategyBrain(data.content)
      setStrategyBrain(normalized)

      if (normalized?.brainAudit) {
        setBrainAudit(normalizeBrainAuditBuckets(normalized.brainAudit))
      }

      return normalized
    } catch (err) {
      console.warn('Failed to sync brain from cloud:', err)
      return null
    }
  }, [canUseCloud])

  /**
   * Save brain to cloud
   */
  const saveBrainToCloud = useCallback(
    async (brainData) => {
      if (!canUseCloud) return

      try {
        const res = await fetch('/api/brain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save-brain', data: brainData }),
        })
        const data = await res.json().catch(() => ({}))

        if (!res.ok) throw new Error(data?.error || `Save failed (${res.status})`)

        emitSaved('✅ 策略大腦已同步至雲端', STATUS_MESSAGE_TIMEOUT_MS.BRIEF)
      } catch (err) {
        console.warn('Failed to save brain to cloud:', err)
        emitSaved('⚠️ 策略大腦雲端同步失敗')
      }
    },
    [canUseCloud, emitSaved]
  )

  /**
   * Get brain rules by status
   */
  const brainRulesByStatus = useMemo(() => {
    if (!strategyBrain) return { active: [], candidate: [], archived: [] }

    const rules = strategyBrain.rules || []
    return {
      active: rules.filter((r) => r.status === 'active'),
      candidate: rules.filter((r) => r.status === 'candidate'),
      archived: rules.filter((r) => r.status === 'archived'),
    }
  }, [strategyBrain])

  /**
   * Get validation statistics
   */
  const validationStats = useMemo(() => {
    if (!brainValidation) return { total: 0, supported: 0, contradicted: 0, mixed: 0 }

    const cases = brainValidation.cases || []
    return {
      total: cases.length,
      supported: cases.filter((c) => c.verdict === 'supported').length,
      contradicted: cases.filter((c) => c.verdict === 'contradicted').length,
      mixed: cases.filter((c) => c.verdict === 'mixed').length,
    }
  }, [brainValidation])

  /**
   * Get audit statistics
   */
  const auditStats = useMemo(() => {
    return {
      validated: brainAudit.validatedRules?.length || 0,
      stale: brainAudit.staleRules?.length || 0,
      invalidated: brainAudit.invalidatedRules?.length || 0,
    }
  }, [brainAudit])

  return {
    // State
    strategyBrain,
    brainValidation,
    brainAudit,

    // Statistics
    brainRulesByStatus,
    validationStats,
    auditStats,

    // Operations
    updateStrategyBrain,
    updateBrainValidation,
    addValidationCase,
    updateBrainAudit,
    mergeBrainAudit,
    ensureAuditCoverage,
    attachEvidenceRefs,
    syncBrainFromCloud,
    saveBrainToCloud,

    // Helpers
    normalizeStrategyBrain,
    normalizeBrainValidationStore,
    normalizeBrainAuditBuckets,
  }
}
