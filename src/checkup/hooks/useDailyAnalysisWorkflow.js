import { useCallback } from 'react'
import { OWNER_PORTFOLIO_ID, REPORT_REFRESH_DAILY_LIMIT } from '../constants.js'
import { APP_STATUS_MESSAGES } from '../lib/appMessages.js'
import {
  buildAnalysisDossiers,
  buildBlindPredictionBlock,
  buildBlindPredictionRequest,
  buildDailyAnalysisRequest,
  buildDailyChanges,
  buildDailyEventCollections,
  buildDailyReport,
  buildFallbackBrainUpdateRequest,
  buildMarketContextFromIndexData,
  buildPreviousPredictionReviewBlock,
  calculatePredictionScores,
  stripDailyAnalysisEmbeddedBlocks,
} from '../lib/dailyAnalysisRuntime.js'
import { normalizeAnalysisHistoryEntries, normalizeDailyReportEntry } from '../lib/reportUtils.js'

export function useDailyAnalysisWorkflow({
  analyzing = false,
  setAnalyzing = () => {},
  setAnalyzeStep = () => {},
  holdings = [],
  losers = [],
  newsEvents = [],
  defaultNewsEvents = [],
  analysisHistory = [],
  strategyBrain = null,
  portfolioNotes = {},
  reversalConditions = {},
  reportRefreshMeta = {},
  todayRefreshKey = '',
  dossierByCode = new Map(),
  activePortfolioId = OWNER_PORTFOLIO_ID,
  canUseCloud = false,
  getMarketQuotesForCodes = async () => ({}),
  resolveHoldingPrice = () => 0,
  getHoldingUnrealizedPnl = () => 0,
  getHoldingReturnPct = () => 0,
  buildDailyHoldingDossierContext = () => '',
  formatPortfolioNotesContext = () => '',
  formatBrainChecklistsForPrompt = () => '',
  formatBrainRulesForValidationPrompt = () => '',
  normalizeStrategyBrain = (value) => value,
  createEmptyBrainAudit = () => ({ validatedRules: [], staleRules: [], invalidatedRules: [] }),
  ensureBrainAuditCoverage = (brainAudit) => brainAudit,
  enforceTaiwanHardGatesOnBrainAudit = (brainAudit) => brainAudit,
  mergeBrainWithAuditLifecycle = (_rawBrain, currentBrain) => currentBrain,
  appendBrainValidationCases = (prev) => prev,
  normalizeHoldings = (rows) => rows,
  isClosedEvent = () => false,
  toSlashDate = () => new Date().toLocaleDateString('zh-TW'),
  setDailyReport = () => {},
  setAnalysisHistory = () => {},
  setStrategyBrain = () => {},
  setBrainValidation = () => {},
  setHoldings = () => {},
  setLastUpdate = () => {},
  setSaved = () => {},
  notifySaved = null,
  refreshAnalystReportsRef = { current: async () => false },
}) {
  const emitSaved = useCallback(
    (message, timeout) => {
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

  const runDailyAnalysis = useCallback(async () => {
    if (analyzing) return
    setAnalyzing(true)
    setAnalyzeStep(APP_STATUS_MESSAGES.dailyLoadingMarketCache)

    try {
      const codes = holdings.map((holding) => holding.code)
      const priceMap = await getMarketQuotesForCodes(codes)
      const changes = buildDailyChanges({
        holdings,
        priceMap,
        resolveHoldingPrice,
        getHoldingUnrealizedPnl,
        getHoldingReturnPct,
      })

      const totalTodayPnl = changes.reduce((sum, change) => sum + change.todayPnl, 0)

      let marketContext = ''
      try {
        const indexResponse = await fetch('/api/twse?ex_ch=tse_t00.tw|tse_t01.tw')
        const indexData = await indexResponse.json()
        marketContext = buildMarketContextFromIndexData(indexData)
      } catch (indexError) {
        console.warn('大盤指數取得失敗（不影響分析）:', indexError)
      }

      const today = toSlashDate()
      const { pendingEvents, eventCorrelations, anomalies, needsReview } =
        buildDailyEventCollections({
          newsEvents,
          defaultNewsEvents,
          isClosedEvent,
          changes,
          today,
        })

      setAnalyzeStep(APP_STATUS_MESSAGES.dailyAiAnalysis)
      let aiInsight = null
      let aiError = null
      let eventAssessments = []
      let brainAudit = createEmptyBrainAudit()
      let brainUpdatedInline = false
      let finalBrainForValidation = normalizeStrategyBrain(strategyBrain, { allowEmpty: true })
      let analysisDossiers = []
      let blindPredictions = []

      try {
        const dailyDossiers = buildAnalysisDossiers({ changes, dossierByCode })
        analysisDossiers = dailyDossiers

        const holdingSummary =
          dailyDossiers.length > 0
            ? dailyDossiers
                .map((dossier) => {
                  const change = changes.find((item) => item.code === dossier.code)
                  return buildDailyHoldingDossierContext(dossier, change)
                })
                .join('\n\n')
            : '目前沒有持股 dossier。'

        const eventSummary = pendingEvents
          .map(
            (event) =>
              `[eventId:${event.id}] [${event.date}] ${event.title} — 預測:${event.pred === 'up' ? '看漲' : event.pred === 'down' ? '看跌' : '中性'} — 狀態:${event.status}`
          )
          .join('\n')

        const anomalySummary =
          anomalies.length > 0
            ? anomalies
                .map(
                  (item) =>
                    `${item.name} ${item.changePct >= 0 ? '+' : ''}${item.changePct.toFixed(2)}%`
                )
                .join(', ')
            : '無'

        const brain = strategyBrain
        const notesContext = formatPortfolioNotesContext(portfolioNotes)
        const coachContext =
          activePortfolioId === OWNER_PORTFOLIO_ID && (brain?.coachLessons || []).length > 0
            ? `
跨組合教練教訓：
${brain.coachLessons
  .slice(-5)
  .map((item) => `- [${item.date}] ${item.source || item.sourcePortfolioId}：${item.text}`)
  .join('\n')}
`
            : ''
        const userRules = (brain?.rules || []).filter((rule) => rule?.source === 'user')
        const aiRules = (brain?.rules || []).filter((rule) => rule?.source !== 'user')
        const candidateRules = brain?.candidateRules || []
        const checklistText = formatBrainChecklistsForPrompt(brain?.checklists)

        const brainContext = brain
          ? `
══ 策略大腦（累積知識庫）══
${
  userRules.length > 0
    ? `✅ 已驗證規則（用戶確認）：
${formatBrainRulesForValidationPrompt(userRules, { limit: 8 })}

`
    : ''
}🤖 核心規則（AI/系統整理）：
${formatBrainRulesForValidationPrompt(aiRules, { limit: 10 })}

🧪 候選規則（需持續驗證）：
${formatBrainRulesForValidationPrompt(candidateRules, { limit: 6 })}

📋 決策檢查表：
${checklistText}

⚠️ 今日任務不是盲目沿用規則，而是先驗證這些規則今天是否仍成立；只有當現有規則無法解釋今日表現時，才新增少量候選規則。
⚠️ 注意：AI 建議規則可能存在確認偏差，不要因為「策略大腦這樣說」就不加質疑地套用。
⚠️ 驗證規則時，要盡量對照過往台股相似案例；若結果失準，需分清楚是規則失準，還是個股 / 流動性 / 市場節奏差異。

歷史教訓：
${(brain.lessons || [])
  .slice(-10)
  .map((lesson) => `- [${lesson.date}] ${lesson.text}`)
  .join('\n')}

勝率統計：${brain.stats?.hitRate || '尚無'}
常犯錯誤：${(brain.commonMistakes || []).join('、') || '尚無'}
${coachContext}
══════════════════════════`
          : ''

        const revContext =
          losers.length > 0
            ? `
反轉追蹤持股：
${losers
  .map((holding) => {
    const reversal = (reversalConditions || {})[holding.code]
    return `${holding.name}(${holding.code}) ${getHoldingReturnPct(holding).toFixed(2)}% | 反轉條件：${reversal?.signal || '未設定'} | 停損：${reversal?.stopLoss || '未設定'}`
  })
  .join('\n')}`
            : ''

        setAnalyzeStep(APP_STATUS_MESSAGES.dailyBlindPrediction)
        const blindHoldingSummary =
          dailyDossiers.length > 0
            ? dailyDossiers
                .map((dossier) => {
                  const change = changes.find((item) => item.code === dossier.code)
                  return buildDailyHoldingDossierContext(dossier, change, { blind: true })
                })
                .join('\n\n')
            : '目前沒有持股 dossier。'

        blindPredictions = []
        try {
          const blindResponse = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              buildBlindPredictionRequest({
                today,
                notesContext,
                brainContext,
                blindHoldingSummary,
                eventSummary,
              })
            ),
          })
          const blindData = await blindResponse.json()
          const blindText = blindData.content?.[0]?.text || ''
          const jsonMatch =
            blindText.match(/```json\s*([\s\S]*?)```/) || blindText.match(/\[[\s\S]*\]/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0])
            if (Array.isArray(parsed)) blindPredictions = parsed
          }
        } catch (blindError) {
          console.warn('盲測預測失敗（不影響主分析）:', blindError)
        }

        const prevReport = (analysisHistory || [])[0]
        const prevReviewBlock = buildPreviousPredictionReviewBlock(prevReport)
        const blindPredBlock = buildBlindPredictionBlock(blindPredictions)

        setAnalyzeStep(APP_STATUS_MESSAGES.dailyAiAnalysis)
        const historicalEvents = (newsEvents || defaultNewsEvents).filter(isClosedEvent)
        const hits = historicalEvents.filter((event) => event.correct === true).length
        const total = historicalEvents.filter((event) => event.correct !== null).length
        const analysisResponse = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            buildDailyAnalysisRequest({
              today,
              prevReviewBlock,
              blindPredBlock,
              totalTodayPnl,
              marketContext,
              notesContext,
              brainContext,
              revContext,
              holdingSummary,
              anomalySummary,
              eventSummary,
              blindPredictions,
              predictionHitRate: `${hits}/${total}`,
            })
          ),
        })
        const analysisData = await analysisResponse.json()
        if (!analysisResponse.ok) {
          throw new Error(
            analysisData?.detail ||
              analysisData?.error ||
              `AI 分析失敗 (${analysisResponse.status})`
          )
        }
        const rawInsight = analysisData.content?.[0]?.text || null
        if (!rawInsight) {
          aiError = 'AI 有回應，但沒有產出可顯示的文字內容'
        } else {
          const displayText = rawInsight
          const eventMatch = displayText.match(
            /## 📋 EVENT_ASSESSMENTS[\s\S]*?```json\s*([\s\S]*?)```/
          )
          if (eventMatch) {
            try {
              const assessments = JSON.parse(eventMatch[1].trim())
              if (Array.isArray(assessments)) eventAssessments = assessments
            } catch (parseError) {
              console.warn('事件評估 JSON 解析失敗:', parseError)
            }
          }

          const brainMatch = displayText.match(/## 🧬 BRAIN_UPDATE[\s\S]*?```json\s*([\s\S]*?)```/)
          if (brainMatch) {
            try {
              const brainJson = JSON.parse(brainMatch[1].trim())
              if (brainJson && typeof brainJson === 'object' && brainJson.rules) {
                brainAudit = ensureBrainAuditCoverage(brainJson, strategyBrain)
                brainAudit = enforceTaiwanHardGatesOnBrainAudit(brainAudit, strategyBrain, {
                  dossiers: analysisDossiers,
                  defaultLastValidatedAt: today,
                })
                const newBrain = mergeBrainWithAuditLifecycle(brainJson, strategyBrain, brainAudit)
                finalBrainForValidation = newBrain
                setStrategyBrain(newBrain)
                brainUpdatedInline = true
              }
            } catch (parseError) {
              console.warn('大腦更新 JSON 解析失敗:', parseError)
            }
          }

          aiInsight = stripDailyAnalysisEmbeddedBlocks(displayText)
        }
      } catch (analysisError) {
        console.error('AI 分析失敗:', analysisError)
        aiError = analysisError?.message || 'AI 分析失敗'
      }

      const predictionScores = calculatePredictionScores(blindPredictions, changes)
      const report = buildDailyReport({
        today,
        totalTodayPnl,
        changes,
        anomalies,
        eventCorrelations,
        needsReview,
        aiInsight,
        aiError,
        eventAssessments,
        blindPredictions,
        predictionScores,
        brainAudit,
      })

      setDailyReport(normalizeDailyReportEntry(report))
      setAnalysisHistory((prev) => normalizeAnalysisHistoryEntries([report, ...(prev || [])]))

      if (canUseCloud) {
        fetch('/api/brain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save-analysis', data: report }),
        }).catch(() => {})
      }

      if (aiInsight && !brainUpdatedInline) {
        setAnalyzeStep('策略大腦進化中（fallback）...')
        try {
          const historicalEvents = (newsEvents || defaultNewsEvents).filter(isClosedEvent)
          const hits = historicalEvents.filter((event) => event.correct === true).length
          const total = historicalEvents.filter((event) => event.correct !== null).length

          const brainResponse = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              buildFallbackBrainUpdateRequest({
                aiInsight,
                strategyBrain,
                hits,
                total,
                totalTodayPnl,
              })
            ),
          })
          const brainData = await brainResponse.json()
          const brainText = brainData.content?.[0]?.text || ''
          const cleanBrain = brainText.replace(/```json|```/g, '').trim()
          const rawBrain = JSON.parse(cleanBrain)
          brainAudit = ensureBrainAuditCoverage(rawBrain, strategyBrain)
          brainAudit = enforceTaiwanHardGatesOnBrainAudit(brainAudit, strategyBrain, {
            dossiers: analysisDossiers,
            defaultLastValidatedAt: today,
          })
          const newBrain = mergeBrainWithAuditLifecycle(rawBrain, strategyBrain, brainAudit)
          finalBrainForValidation = newBrain
          setStrategyBrain(newBrain)
          setDailyReport((prev) =>
            prev ? normalizeDailyReportEntry({ ...prev, brainAudit }) : prev
          )
        } catch (brainError) {
          console.error('策略大腦更新失敗（fallback）:', brainError)
        }
      }

      if (analysisDossiers.length > 0 && finalBrainForValidation) {
        setBrainValidation((prev) =>
          appendBrainValidationCases(prev, {
            portfolioId: activePortfolioId,
            sourceType: 'dailyAnalysis',
            sourceRefId: String(report.id),
            dossiers: analysisDossiers,
            brain: finalBrainForValidation,
            brainAudit,
            capturedAt: `${report.date} ${report.time}`,
          })
        )
      }

      setHoldings((prev) =>
        normalizeHoldings(
          (prev || []).map((holding) => {
            const marketPrice = priceMap[holding.code]
            if (!marketPrice) return holding
            const newValue = Math.round(marketPrice.price * holding.qty)
            const newPnl = Math.round((marketPrice.price - holding.cost) * holding.qty)
            const newPct = Math.round((marketPrice.price / holding.cost - 1) * 10000) / 100
            return {
              ...holding,
              price: marketPrice.price,
              value: newValue,
              pnl: newPnl,
              pct: newPct,
            }
          }),
          priceMap
        )
      )

      setLastUpdate(new Date())
      if (reportRefreshMeta?.__daily?.date !== todayRefreshKey) {
        refreshAnalystReportsRef
          .current({ silent: true, limit: Math.min(3, REPORT_REFRESH_DAILY_LIMIT) })
          .catch((refreshError) => {
            console.error('收盤分析後刷新公開報告失敗:', refreshError)
          })
      }
    } catch (error) {
      console.error('收盤分析失敗:', error)
      emitSaved('❌ 分析失敗', 3000)
    }

    setAnalyzing(false)
    setAnalyzeStep('')
  }, [
    activePortfolioId,
    analysisHistory,
    analyzing,
    appendBrainValidationCases,
    buildDailyHoldingDossierContext,
    canUseCloud,
    createEmptyBrainAudit,
    defaultNewsEvents,
    dossierByCode,
    enforceTaiwanHardGatesOnBrainAudit,
    formatBrainChecklistsForPrompt,
    formatBrainRulesForValidationPrompt,
    formatPortfolioNotesContext,
    getHoldingReturnPct,
    getHoldingUnrealizedPnl,
    getMarketQuotesForCodes,
    holdings,
    isClosedEvent,
    losers,
    mergeBrainWithAuditLifecycle,
    newsEvents,
    normalizeHoldings,
    normalizeStrategyBrain,
    portfolioNotes,
    refreshAnalystReportsRef,
    reportRefreshMeta,
    resolveHoldingPrice,
    reversalConditions,
    setAnalysisHistory,
    setAnalyzeStep,
    setAnalyzing,
    setBrainValidation,
    setDailyReport,
    setHoldings,
    setLastUpdate,
    setStrategyBrain,
    strategyBrain,
    toSlashDate,
    todayRefreshKey,
    ensureBrainAuditCoverage,
    emitSaved,
  ])

  return { runDailyAnalysis }
}
