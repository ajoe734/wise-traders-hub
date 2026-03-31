import { useCallback } from 'react'
import { STATUS_MESSAGE_TIMEOUT_MS } from '../constants.js'
import { APP_LABELS, APP_TOAST_MESSAGES } from '../lib/appMessages.js'
import { normalizeHoldings } from '../lib/holdings.js'
import { normalizeFundamentalsEntry } from '../lib/dossierUtils.js'
import { mergeTargetReports } from '../lib/reportUtils.js'

export function usePortfolioDossierActions({
  marketQuotes = null,
  setHoldings = () => {},
  setTargets = () => {},
  setFundamentals = () => {},
  flashSaved = () => {},
  toSlashDate = () => new Date().toLocaleDateString('zh-TW'),
}) {
  const updateTargetPrice = useCallback(
    (code, targetPrice) => {
      if (!code) return

      const normalizedTarget = Number.isFinite(Number(targetPrice)) ? Number(targetPrice) : null
      setHoldings((prev) =>
        normalizeHoldings(
          (prev || []).map((holding) =>
            holding.code === code ? { ...holding, targetPrice: normalizedTarget } : holding
          ),
          marketQuotes
        )
      )
      setTargets((prev) => {
        const existing = (prev || {})[code] || {}
        return {
          ...(prev || {}),
          [code]: {
            ...existing,
            targetPrice: normalizedTarget,
            updatedAt: toSlashDate(),
          },
        }
      })
    },
    [marketQuotes, setHoldings, setTargets, toSlashDate]
  )

  const updateAlert = useCallback(
    (code, alert) => {
      if (!code) return

      setHoldings((prev) =>
        normalizeHoldings(
          (prev || []).map((holding) =>
            holding.code === code ? { ...holding, alert: String(alert || '') } : holding
          ),
          marketQuotes
        )
      )
    },
    [marketQuotes, setHoldings]
  )

  const upsertTargetReport = useCallback(
    ({ code, firm, target, date }, { silent = false, markNew = true } = {}) => {
      const normalizedCode = String(code || '').trim()
      const normalizedFirm = String(firm || '').trim() || APP_LABELS.manualEntryFirm
      const normalizedTarget = Number(target)
      if (!normalizedCode || !Number.isFinite(normalizedTarget) || normalizedTarget <= 0)
        return false

      const reportDate = String(date || '').trim() || toSlashDate()
      setTargets((prev) => {
        const existing = (prev || {})[normalizedCode] || { reports: [] }
        return {
          ...(prev || {}),
          [normalizedCode]: {
            ...existing,
            reports: mergeTargetReports(existing.reports, [
              { firm: normalizedFirm, target: normalizedTarget, date: reportDate },
            ]),
            updatedAt: reportDate,
            isNew: markNew || Boolean(existing.isNew),
          },
        }
      })

      if (!silent) {
        flashSaved(APP_TOAST_MESSAGES.targetUpdated, STATUS_MESSAGE_TIMEOUT_MS.QUICK)
      }
      return true
    },
    [flashSaved, setTargets, toSlashDate]
  )

  const upsertFundamentalsEntry = useCallback(
    (code, patch, { silent = false } = {}) => {
      const normalizedCode = String(code || '').trim()
      if (!normalizedCode || !patch || typeof patch !== 'object') return false

      let didPersist = false
      setFundamentals((prev) => {
        const existing = normalizeFundamentalsEntry(prev?.[normalizedCode]) || {}
        const merged = normalizeFundamentalsEntry({
          ...existing,
          ...patch,
          updatedAt: patch.updatedAt || existing.updatedAt || toSlashDate(),
        })
        if (!merged) return prev || {}
        didPersist = true
        return {
          ...(prev || {}),
          [normalizedCode]: merged,
        }
      })

      if (didPersist && !silent) {
        flashSaved(APP_TOAST_MESSAGES.fundamentalsUpdated, STATUS_MESSAGE_TIMEOUT_MS.QUICK)
      }
      return didPersist
    },
    [flashSaved, setFundamentals, toSlashDate]
  )

  return {
    updateTargetPrice,
    updateAlert,
    upsertTargetReport,
    upsertFundamentalsEntry,
  }
}
