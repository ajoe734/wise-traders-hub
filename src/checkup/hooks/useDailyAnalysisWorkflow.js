import { API_ENDPOINTS } from '../constants.js'
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
  persistAnalysisToCloud,
  flushPendingAnalyses,
} from '../lib/dailyAnalysisRuntime.js'
import { parseJsonArray, parseJsonObject } from '../lib/aiJsonRepair.js'
import { normalizeAnalysisHistoryEntries, normalizeDailyReportEntry } from '../lib/reportUtils.js'
import { flushKnowledgeHits } from '../lib/knowledgeBase.js'
// Phase 3A.4 Step 1: store 直取 setter
import { useHoldingsStore } from '../stores/holdingsStore.js'
import { useReportsStore } from '../stores/reportsStore.js'
import { useBrainStore } from '../stores/brainStore.js'
import { getCheckupGateway, parseGatewayErrorBody } from '../lib/gateway'

// ── 背景收盤分析 job：開始時建立 row，結束時更新 + 觸發 notify-complete ──
async function createAnalysisJob(holdings) {
  try {
    const gw = getCheckupGateway()
    const uid = await gw.auth.getUserId()
    if (!uid) return null
    const snapshot = (holdings || []).map((h) => ({
      code: h.code, name: h.name, qty: h.qty, cost: h.cost, price: h.price,
    }))
    const { data, error } = await gw.db
      .from('checkup_analysis_jobs')
      .insert({ user_id: uid, status: 'running', holdings_snapshot: snapshot, started_at: new Date().toISOString() })
      .select('id')
      .maybeSingle()
    if (error) { console.warn('[analysis-job] create failed', error); return null }
    return data?.id || null
  } catch (e) { console.warn('[analysis-job] create exception', e); return null }
}

async function finishAnalysisJob(jobId, { status, summary, errorText } = {}) {
  if (!jobId) return
  try {
    const gw = getCheckupGateway()
    await gw.db
      .from('checkup_analysis_jobs')
      .update({
        status,
        result_summary: summary || null,
        error_text: errorText || null,
        finished_at: new Date().toISOString(),
      })
      .eq('id', jobId)
    // fire-and-forget notify
    gw.invoke('checkup-notify-complete', { job_id: jobId })
      .catch((e) => console.warn('[analysis-job] notify failed', e))
  } catch (e) { console.warn('[analysis-job] finish exception', e) }
}


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
  setLastUpdate = () => {},
  setSaved = () => {},
  flashSaved = null,
  refreshAnalystReportsRef = { current: async () => false },
}) {
  const setHoldings = useHoldingsStore((s) => s.setHoldings)
  const setDailyReport = useReportsStore((s) => s.setDailyReport)
  const setAnalysisHistory = useReportsStore((s) => s.setAnalysisHistory)
  const setStrategyBrain = useBrainStore((s) => s.setStrategyBrain)
  const setBrainValidation = useBrainStore((s) => s.setBrainValidation)
  const emitSaved = useCallback(
    (message, timeout) => {
      if (typeof flashSaved === 'function') {
        flashSaved(message, timeout)
        return
      }
      setSaved(message)
      if (timeout != null) {
        setTimeout(() => setSaved(''), timeout)
      }
    },
    [flashSaved, setSaved]
  )

  const runDailyAnalysis = useCallback(async () => {
    if (analyzing) return
    setAnalyzing(true)
    setAnalyzeStep(APP_STATUS_MESSAGES.dailyLoadingMarketCache)

    // 背景 job 標記：建立 row，結束時通知（Line / Email / 站內）
    const __jobId = await createAnalysisJob(holdings)
    if (__jobId) emitSaved('🔔 分析已開始，可關閉網頁，完成後將通知您', 5000)

    // Flush previously buffered analyses (fire-and-forget, doesn't block flow)
    if (canUseCloud) {
      flushPendingAnalyses(API_ENDPOINTS.BRAIN).catch(() => {})
    }


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
        const indexData = await getCheckupGateway().http.json(
          `${API_ENDPOINTS.TWSE}?ex_ch=tse_t00.tw|tse_t01.tw`,
        )
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
      let blindStatus = 'ok' // 'ok' | 'failed' | 'empty' | 'parse_error'

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

        // 記錄本批 dossier 命中的知識條目（不阻擋主流程）
        flushKnowledgeHits({ context: 'daily_analysis' }).catch(() => {})

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

        // 盲測批次的命中（不阻擋主流程）
        flushKnowledgeHits({ context: 'daily_analysis_blind' }).catch(() => {})

        blindPredictions = []
        try {
          const blindData = await getCheckupGateway().http.tryJson(API_ENDPOINTS.ANALYZE, {
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
          if (!blindData) {
            blindStatus = 'failed'
          } else {
            const blindText = blindData.content?.[0]?.text || ''
            const parsed = parseJsonArray(blindText)
            if (parsed === null) {
              blindStatus = 'parse_error'
              console.warn('盲測 JSON 解析失敗（不影響主分析）')
            } else if (parsed.length === 0) {
              blindStatus = 'empty'
            } else {
              blindPredictions = parsed
            }
          }
        } catch (blindError) {
          blindStatus = 'failed'
          console.warn('盲測預測失敗（不影響主分析）:', blindError)
        }

        const prevReport = (analysisHistory || [])[0]
        const prevReviewBlock = buildPreviousPredictionReviewBlock(prevReport)
        const blindPredBlock = buildBlindPredictionBlock(blindPredictions)

        setAnalyzeStep(APP_STATUS_MESSAGES.dailyAiAnalysis)
        const historicalEvents = (newsEvents || defaultNewsEvents).filter(isClosedEvent)
        const hits = historicalEvents.filter((event) => event.correct === true).length
        const total = historicalEvents.filter((event) => event.correct !== null).length
        let analysisData
        try {
          analysisData = await getCheckupGateway().http.json(API_ENDPOINTS.ANALYZE, {
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
        } catch (err) {
          const detail = parseGatewayErrorBody(err)
          throw new Error(
            detail?.detail || detail?.error || `AI 分析失敗 (${err?.status || 0})`
          )
        }
        const rawInsight = analysisData.content?.[0]?.text || null
        if (!rawInsight) {
          aiError = 'AI 有回應，但沒有產出可顯示的文字內容'
        } else {
          const displayText = rawInsight
          const eventMatch = displayText.match(
            /## 📋 EVENT_ASSESSMENTS([\s\S]*?)(?=## 🧬 BRAIN_UPDATE|$)/
          )
          if (eventMatch) {
            const assessments = parseJsonArray(eventMatch[1])
            if (assessments) {
              eventAssessments = assessments
            } else {
              console.warn('事件評估 JSON 解析失敗（已嘗試修復）')
            }
          }

          const brainMatch = displayText.match(/## 🧬 BRAIN_UPDATE([\s\S]*?)$/)
          if (brainMatch) {
            const brainJson = parseJsonObject(brainMatch[1])
            if (brainJson && brainJson.rules) {
              brainAudit = ensureBrainAuditCoverage(brainJson, strategyBrain)
              brainAudit = enforceTaiwanHardGatesOnBrainAudit(brainAudit, strategyBrain, {
                dossiers: analysisDossiers,
                defaultLastValidatedAt: today,
              })
              const newBrain = mergeBrainWithAuditLifecycle(brainJson, strategyBrain, brainAudit)
              finalBrainForValidation = newBrain
              setStrategyBrain(newBrain)
              brainUpdatedInline = true
            } else {
              console.warn('大腦更新 JSON 解析失敗或缺少 rules（已嘗試修復）')
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
        meta: { blindStatus },
      })

      setDailyReport(normalizeDailyReportEntry(report))
      setAnalysisHistory((prev) => normalizeAnalysisHistoryEntries([report, ...(prev || [])]))

      if (canUseCloud) {
        persistAnalysisToCloud(API_ENDPOINTS.BRAIN, report).catch(() => {})
      }

      if (aiInsight && !brainUpdatedInline) {
        setAnalyzeStep('策略大腦進化中（fallback）...')
        try {
          const historicalEvents = (newsEvents || defaultNewsEvents).filter(isClosedEvent)
          const hits = historicalEvents.filter((event) => event.correct === true).length
          const total = historicalEvents.filter((event) => event.correct !== null).length

          const brainData = await getCheckupGateway().http.json(API_ENDPOINTS.ANALYZE, {
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

      // 標記 job 完成 → 觸發 Line / Email / 站內通知
      try {
        const watchlist = [...changes]
          .sort((a, b) => (a.todayPnl || 0) - (b.todayPnl || 0))
          .slice(0, 3)
          .map((c) => ({
            code: c.code,
            name: c.name || c.code,
            note: `今日 ${(c.todayPnl >= 0 ? '+' : '')}${Math.round(c.todayPnl || 0).toLocaleString()}`,
          }))
        finishAnalysisJob(__jobId, {
          status: 'done',
          summary: {
            total_pnl: totalTodayPnl,
            total_holdings: holdings.length,
            watchlist,
          },
        })
      } catch (jobErr) { console.warn('[analysis-job] summary build failed', jobErr) }
    } catch (error) {
      console.error('收盤分析失敗:', error)
      emitSaved('❌ 分析失敗', 3000)
      finishAnalysisJob(__jobId, { status: 'failed', errorText: error?.message || '分析失敗' })
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

  // 背景模式：建立所有 prompt → 呼叫 enqueue → 立刻回傳，使用者可關頁面
  // 注意：跳過盲測（worker 不重組 prompt），主分析 + 大腦 fallback 由 worker 跑
  const runDailyAnalysisInBackground = useCallback(async () => {
    if (analyzing) return { ok: false, reason: 'already_analyzing' }
    try {
      const codes = holdings.map((h) => h.code)
      const priceMap = await getMarketQuotesForCodes(codes)
      const changes = buildDailyChanges({
        holdings, priceMap, resolveHoldingPrice, getHoldingUnrealizedPnl, getHoldingReturnPct,
      })
      const totalTodayPnl = changes.reduce((s, c) => s + c.todayPnl, 0)

      let marketContext = ''
      try {
        const r = await getCheckupGateway().http.json(
          `${API_ENDPOINTS.TWSE}?ex_ch=tse_t00.tw|tse_t01.tw`,
        )
        marketContext = buildMarketContextFromIndexData(r)
      } catch { /* */ }

      const today = toSlashDate()
      const { pendingEvents, anomalies } = buildDailyEventCollections({
        newsEvents, defaultNewsEvents, isClosedEvent, changes, today,
      })

      const dailyDossiers = buildAnalysisDossiers({ changes, dossierByCode })
      // 背景模式同樣 flush 知識命中（dossier 已建立 → buffer 已填）
      flushKnowledgeHits({ context: 'daily_analysis_background' }).catch(() => {})
      const holdingSummary = dailyDossiers.length > 0
        ? dailyDossiers.map((d) => {
            const ch = changes.find((c) => c.code === d.code)
            return buildDailyHoldingDossierContext(d, ch)
          }).join('\n\n')
        : '目前沒有持股 dossier。'


      const eventSummary = pendingEvents
        .map((e) => `[eventId:${e.id}] [${e.date}] ${e.title} — 預測:${e.pred === 'up' ? '看漲' : e.pred === 'down' ? '看跌' : '中性'} — 狀態:${e.status}`)
        .join('\n')
      const anomalySummary = anomalies.length > 0
        ? anomalies.map((a) => `${a.name} ${a.changePct >= 0 ? '+' : ''}${a.changePct.toFixed(2)}%`).join(', ')
        : '無'

      const brain = strategyBrain
      const notesContext = formatPortfolioNotesContext(portfolioNotes)
      const userRules = (brain?.rules || []).filter((r) => r?.source === 'user')
      const aiRules = (brain?.rules || []).filter((r) => r?.source !== 'user')
      const candidateRules = brain?.candidateRules || []
      const checklistText = formatBrainChecklistsForPrompt(brain?.checklists)
      const brainContext = brain
        ? `══ 策略大腦（累積知識庫）══\n${userRules.length > 0 ? `✅ 已驗證規則：\n${formatBrainRulesForValidationPrompt(userRules, { limit: 8 })}\n\n` : ''}🤖 核心規則：\n${formatBrainRulesForValidationPrompt(aiRules, { limit: 10 })}\n\n🧪 候選規則：\n${formatBrainRulesForValidationPrompt(candidateRules, { limit: 6 })}\n\n📋 檢查表：\n${checklistText}\n\n歷史教訓：\n${(brain.lessons || []).slice(-10).map((l) => `- [${l.date}] ${l.text}`).join('\n')}\n勝率：${brain.stats?.hitRate || '尚無'}\n常犯錯誤：${(brain.commonMistakes || []).join('、') || '尚無'}\n══════════════════════════`
        : ''
      const revContext = losers.length > 0
        ? losers.map((h) => {
            const rev = (reversalConditions || {})[h.code]
            return `${h.name}(${h.code}) ${getHoldingReturnPct(h).toFixed(2)}% | 反轉:${rev?.signal || '未設定'} | 停損:${rev?.stopLoss || '未設定'}`
          }).join('\n')
        : ''

      const prevReport = (analysisHistory || [])[0]
      const prevReviewBlock = buildPreviousPredictionReviewBlock(prevReport)
      const blindPredBlock = '（背景模式：略過盲測）'

      const historicalEvents = (newsEvents || defaultNewsEvents).filter(isClosedEvent)
      const hits = historicalEvents.filter((e) => e.correct === true).length
      const total = historicalEvents.filter((e) => e.correct !== null).length

      const mainReq = buildDailyAnalysisRequest({
        today, prevReviewBlock, blindPredBlock, totalTodayPnl, marketContext,
        notesContext, brainContext, revContext, holdingSummary, anomalySummary,
        eventSummary, blindPredictions: [], predictionHitRate: `${hits}/${total}`,
      })
      const brainReq = buildFallbackBrainUpdateRequest({
        aiInsight: '（worker 將以主分析回覆為準）',
        strategyBrain, hits, total, totalTodayPnl,
      })

      const snapshot = (holdings || []).map((h) => ({
        code: h.code, name: h.name, qty: h.qty, cost: h.cost, price: h.price,
      }))

      const data = await getCheckupGateway()
        .invoke('checkup-analyze-enqueue', {
          prompts: { main: mainReq, brain: brainReq },
          holdings_snapshot: snapshot,
        })
        .catch((err) => ({ ok: false, __error: err }))
      if (!data?.ok) {
        emitSaved('❌ 背景分析啟動失敗', 4000)
        return { ok: false, reason: data?.__error?.message || 'enqueue_failed' }
      }
      emitSaved('🔔 分析已送背景，可關閉網頁，完成後將通知您', 6000)
      return { ok: true, job_id: data.job_id, reused: !!data.reused }
    } catch (e) {
      console.error('[background-analysis] failed', e)
      emitSaved('❌ 背景分析啟動失敗', 4000)
      return { ok: false, reason: e?.message || 'exception' }
    }
  }, [
    analyzing, holdings, losers, newsEvents, defaultNewsEvents, analysisHistory,
    strategyBrain, portfolioNotes, reversalConditions, dossierByCode,
    getMarketQuotesForCodes, resolveHoldingPrice, getHoldingUnrealizedPnl,
    getHoldingReturnPct, buildDailyHoldingDossierContext, formatPortfolioNotesContext,
    formatBrainChecklistsForPrompt, formatBrainRulesForValidationPrompt,
    isClosedEvent, toSlashDate, emitSaved,
  ])

  return { runDailyAnalysis, runDailyAnalysisInBackground }
}
