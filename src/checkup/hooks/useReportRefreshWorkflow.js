import { useCallback, useState } from 'react'
import {
  API_ENDPOINTS,
  REPORT_REFRESH_DAILY_LIMIT,
  REPORT_EXTRACT_MAX_ITEMS,
  STATUS_MESSAGE_TIMEOUT_MS,
} from '../constants.js'
import { APP_ERROR_MESSAGES, APP_STATUS_MESSAGES, APP_TOAST_MESSAGES } from '../lib/appMessages.js'
import {
  buildAnalystTargetUpserts,
  buildResearchExtractRequest,
  extractStructuredResearchRefreshPlan,
  mergeAnalystReportBatchStore,
  mergeReportRefreshMetaStore,
} from '../lib/reportRefreshRuntime.js'
import { fetchJsonWithTimeout } from '../lib/utils.js'

export function useReportRefreshWorkflow({
  holdings = [],
  dossierByCode = new Map(),
  analystReports = {},
  reportRefreshMeta = {},
  reportRefreshCandidates = [],
  todayRefreshKey = '',
  upsertTargetReport = () => false,
  upsertFundamentalsEntry = () => false,
  setAnalystReports = () => {},
  setReportRefreshMeta = () => {},
  flashSaved = () => {},
  toSlashDate = () => new Date().toLocaleDateString('zh-TW'),
}) {
  const [enrichingResearchCode, setEnrichingResearchCode] = useState(null)
  const [reportRefreshing, setReportRefreshing] = useState(false)
  const [reportRefreshStatus, setReportRefreshStatus] = useState('')

  const applyStructuredResearchRefresh = useCallback(
    (payload, { silent = false } = {}) => {
      const { code, fundamentals, reports } = extractStructuredResearchRefreshPlan(payload)
      if (!code) return false

      let changed = false
      if (fundamentals) {
        changed = upsertFundamentalsEntry(code, fundamentals, { silent: true }) || changed
      }
      reports.forEach((report) => {
        changed =
          upsertTargetReport({ code, ...report }, { silent: true, markNew: true }) || changed
      })

      if (changed && !silent) {
        flashSaved(APP_TOAST_MESSAGES.researchSyncedToDossier, STATUS_MESSAGE_TIMEOUT_MS.SHORT)
      }
      return changed
    },
    [flashSaved, upsertFundamentalsEntry, upsertTargetReport]
  )

  const enrichResearchToDossier = useCallback(
    async (report, { silent = false } = {}) => {
      const code = String(report?.code || '').trim()
      if (!code || report?.mode !== 'single') return false

      const targetStock = (Array.isArray(holdings) ? holdings : []).find(
        (item) => item.code === code
      )
      if (!targetStock) return false

      setEnrichingResearchCode(code)
      try {
        const dossier = dossierByCode.get(code) || null
        const { response, data } = await fetchJsonWithTimeout(
          API_ENDPOINTS.RESEARCH_EXTRACT,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              buildResearchExtractRequest({
                report,
                targetStock,
                dossier,
                todayLabel: toSlashDate(),
              })
            ),
          },
          8500
        )

        if (!response.ok) {
          throw new Error(data?.detail || data?.error || `同步失敗 (${response.status})`)
        }

        const changed = applyStructuredResearchRefresh({ code, ...data }, { silent })
        if (!changed && !silent) {
          flashSaved(
            APP_TOAST_MESSAGES.researchNoStructuredExtract,
            STATUS_MESSAGE_TIMEOUT_MS.SHORT
          )
        }
        return changed
      } catch (error) {
        console.error('研究資料同步失敗:', error)
        if (!silent) {
          const detail =
            error?.name === 'AbortError'
              ? APP_ERROR_MESSAGES.researchSyncTimeout
              : error?.message || APP_ERROR_MESSAGES.researchSyncFallback
          flashSaved(
            APP_TOAST_MESSAGES.researchSyncFailure(detail),
            STATUS_MESSAGE_TIMEOUT_MS.NOTICE
          )
        }
        return false
      } finally {
        setEnrichingResearchCode((current) => (current === code ? null : current))
      }
    },
    [applyStructuredResearchRefresh, dossierByCode, flashSaved, holdings, toSlashDate]
  )

  const mergeAnalystReportBatch = useCallback(
    (code, payload) => {
      let incomingItems = []
      setAnalystReports((prev) => {
        const result = mergeAnalystReportBatchStore(prev, code, payload)
        incomingItems = result.incomingItems
        return result.nextStore
      })

      buildAnalystTargetUpserts(code, incomingItems, { todayLabel: toSlashDate() }).forEach(
        (entry) => {
          upsertTargetReport(entry, { silent: true, markNew: true })
        }
      )

      return incomingItems.length > 0
    },
    [setAnalystReports, toSlashDate, upsertTargetReport]
  )

  const refreshAnalystReports = useCallback(
    async ({ force = false, silent = false, limit = REPORT_REFRESH_DAILY_LIMIT } = {}) => {
      if (reportRefreshing) return false

      const dailyMeta = reportRefreshMeta?.__daily || {}
      const processedCodes = new Set(
        Array.isArray(dailyMeta.processedCodes) ? dailyMeta.processedCodes : []
      )
      const candidates = (Array.isArray(reportRefreshCandidates) ? reportRefreshCandidates : [])
        .filter((item) => force || (!item.checkedToday && !processedCodes.has(item.holding.code)))
        .slice(0, limit)

      if (candidates.length === 0) {
        if (!silent) {
          flashSaved(APP_TOAST_MESSAGES.analystReportsFresh, STATUS_MESSAGE_TIMEOUT_MS.QUICK)
        }
        return false
      }

      setReportRefreshing(true)
      setReportRefreshStatus(APP_STATUS_MESSAGES.reportRefreshStarting(candidates.length))
      let changedCodes = 0
      const checkedCodes = []

      try {
        for (let index = 0; index < candidates.length; index += 1) {
          const { holding } = candidates[index]
          const checkedAt = new Date().toISOString()
          setReportRefreshStatus(
            APP_STATUS_MESSAGES.reportRefreshProgress(index + 1, candidates.length, holding.name)
          )

          try {
            const knownHashes = Array.isArray(analystReports?.[holding.code]?.items)
              ? analystReports[holding.code].items
                  .map((item) => item.id || item.hash)
                  .filter(Boolean)
              : []
            const { response, data } = await fetchJsonWithTimeout(
              API_ENDPOINTS.ANALYST_REPORTS,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  code: holding.code,
                  name: holding.name,
                  knownHashes,
                  maxItems: 6,
                  maxExtract: REPORT_EXTRACT_MAX_ITEMS,
                }),
              },
              9000
            )

            if (!response.ok) {
              throw new Error(data?.detail || data?.error || `刷新失敗 (${response.status})`)
            }

            const changed = mergeAnalystReportBatch(holding.code, data)
            if (changed) changedCodes += 1
            checkedCodes.push(holding.code)
            setReportRefreshMeta((prev) =>
              mergeReportRefreshMetaStore(prev, {
                code: holding.code,
                todayRefreshKey,
                fetchedAt: data?.fetchedAt || checkedAt,
                changed,
                items: data?.items,
                newCount: data?.newCount || 0,
              })
            )
          } catch (error) {
            console.error(`公開報告刷新失敗 (${holding.code}):`, error)
            checkedCodes.push(holding.code)
            setReportRefreshMeta((prev) =>
              mergeReportRefreshMetaStore(prev, {
                code: holding.code,
                todayRefreshKey,
                fetchedAt: checkedAt,
                changed: false,
                errorMessage: error?.message || APP_STATUS_MESSAGES.reportRefreshFailed,
              })
            )
          }
        }

        if (!silent) {
          flashSaved(
            APP_TOAST_MESSAGES.analystReportsRefreshed(checkedCodes.length, changedCodes),
            STATUS_MESSAGE_TIMEOUT_MS.NOTICE
          )
        }
        return changedCodes > 0
      } finally {
        setReportRefreshing(false)
        setReportRefreshStatus('')
      }
    },
    [
      analystReports,
      flashSaved,
      mergeAnalystReportBatch,
      reportRefreshCandidates,
      reportRefreshMeta,
      reportRefreshing,
      setReportRefreshMeta,
      todayRefreshKey,
    ]
  )

  return {
    reportRefreshing,
    reportRefreshStatus,
    enrichingResearchCode,
    refreshAnalystReports,
    enrichResearchToDossier,
  }
}
