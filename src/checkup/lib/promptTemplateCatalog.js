function formatPredictionLabel(value) {
  return value === 'up' ? '看漲' : value === 'down' ? '看跌' : '中性'
}

function formatActualLabel(value) {
  return value === 'up' ? '上漲' : value === 'down' ? '下跌' : '中性'
}

function formatSignedPrefix(value) {
  return Number(value) >= 0 ? '+' : ''
}

function formatHoldingLine({
  holding,
  resolveHoldingPrice,
  getHoldingUnrealizedPnl,
  getHoldingReturnPct,
}) {
  const pnl = Math.round(getHoldingUnrealizedPnl(holding))
  const pct = Math.round(getHoldingReturnPct(holding) * 100) / 100
  return `${holding.name}(${holding.code}) | 現價${resolveHoldingPrice(holding)} | 成本${holding.cost} | 損益${formatSignedPrefix(pnl)}${pnl}(${formatSignedPrefix(pct)}${pct}%) | ${holding.type}`
}

function formatRecentAnalysisLine(entry) {
  const summary = entry.aiInsight
    ? entry.aiInsight.slice(0, 500) + (entry.aiInsight.length > 500 ? '...' : '')
    : '（無 AI 分析）'
  return `【${entry.date} ${entry.time}】損益${formatSignedPrefix(entry.totalTodayPnl)}${entry.totalTodayPnl}\n${summary}`
}

function buildWeeklyReportBrainSection(brain, brainRuleSummary) {
  if (!brain) return ''

  const checklistSummary = [
    (brain.checklists?.preEntry || []).length > 0
      ? `進場前：${brain.checklists.preEntry.join('；')}`
      : null,
    (brain.checklists?.preAdd || []).length > 0
      ? `加碼前：${brain.checklists.preAdd.join('；')}`
      : null,
    (brain.checklists?.preExit || []).length > 0
      ? `出場前：${brain.checklists.preExit.join('；')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  return `
## 策略大腦
核心規則：
${(brain.rules || []).map((rule, index) => `${index + 1}. ${brainRuleSummary(rule, { includeMeta: true })}`).join('\n')}

候選規則：
${(brain.candidateRules || []).length > 0 ? (brain.candidateRules || []).map((rule, index) => `${index + 1}. ${brainRuleSummary(rule, { includeMeta: true })}`).join('\n') : '無'}

決策檢查表：
${checklistSummary || '無'}

常犯錯誤：${(brain.commonMistakes || []).join('、') || '無'}
命中率：${brain.stats?.hitRate || '計算中'}
累計分析次數：${brain.stats?.totalAnalyses || 0}

最近教訓：
${(brain.lessons || [])
  .slice(-5)
  .map((lesson) => `- [${lesson.date}] ${lesson.text}`)
  .join('\n')}`
}

export function buildEventReviewBrainSystemPrompt() {
  return `你是策略知識庫管理器。用戶剛完成一筆事件復盤，你要：
1. 評估用戶的覆盤心得是否合理（用戶不一定正確，需要糾正偏差）
2. 從這次復盤中提取可學習的策略教訓
3. 先驗證與本次事件 / 相關持股 dossier 有關的既有策略規則，判斷哪些被真實 outcome 支持、削弱或證偽
4. 更新策略大腦的規則和教訓

回傳**純JSON**格式（不要markdown code block），結構：
{"validatedRules":[{"id":"規則ID或空字串","text":"這次 outcome 仍支持的舊規則","reason":"為何成立","confidence":0到100,"lastValidatedAt":"日期","evidenceRefs":[{"type":"analysis/research/review/event/fundamental/target/report/dossier/note","refId":"來源ID或空字串","code":"股票代號或空字串","label":"證據標籤","date":"日期或空字串"}]}],"staleRules":[{"id":"規則ID或空字串","text":"這次復盤只能部分支持、證據不足或需降級的規則","reason":"為何只能先標記 stale","confidence":0到100,"staleness":"aging/stale","evidenceRefs":[{"type":"analysis/research/review/event/fundamental/target/report/dossier/note","refId":"來源ID或空字串","code":"股票代號或空字串","label":"證據標籤","date":"日期或空字串"}]}],"invalidatedRules":[{"id":"規則ID或空字串","text":"這次被真實 outcome 證偽的規則","reason":"為何失效","confidence":0到100,"nextStatus":"candidate/archived","evidenceRefs":[{"type":"analysis/research/review/event/fundamental/target/report/dossier/note","refId":"來源ID或空字串","code":"股票代號或空字串","label":"證據標籤","date":"日期或空字串"}]}],"rules":[{"text":"規則","when":"適用情境","action":"建議動作","scope":"適用範圍","confidence":1到10,"evidenceCount":整數,"validationScore":0到100,"lastValidatedAt":"日期","staleness":"fresh/aging/stale/missing","evidenceRefs":[{"type":"analysis/research/review/event/fundamental/target/report/dossier/note","refId":"來源ID或空字串","code":"股票代號或空字串","label":"證據標籤","date":"日期或空字串"}],"source":"ai/user","status":"active","checklistStage":"preEntry/preAdd/preExit"}],"candidateRules":[{"text":"待驗證規則","when":"情境","action":"動作","confidence":1到10,"evidenceCount":整數,"validationScore":0到100,"staleness":"fresh/aging/stale/missing","evidenceRefs":[{"type":"analysis/research/review/event/fundamental/target/report/dossier/note","refId":"來源ID或空字串","code":"股票代號或空字串","label":"證據標籤","date":"日期或空字串"}],"status":"candidate"}],"checklists":{"preEntry":["進場前檢查項"],"preAdd":["加碼前檢查項"],"preExit":["出場前檢查項"]},"lessons":[{"date":"日期","text":"教訓"}],"commonMistakes":[...],"stats":{"hitRate":"X/Y","totalAnalyses":N},"lastUpdate":"日期","evolution":"一句話摘要","reviewFeedback":"給用戶的一句話反饋：覆盤是否合理？有什麼盲點？"}

另外，每條規則 / 候選規則盡量補上：
- appliesTo / marketRegime / catalystWindow
- contextRequired / invalidationSignals
- historicalAnalogs：1-2 個過往台股相似案例；若這次失準，說明是規則失準還是個股情境差異`
}

export function buildStressTestSystemPrompt() {
  return `你是風險管理專家，你的唯一任務是找出每一檔持股的致命風險。

規則：
- 你不能說任何正面的事情。任何正面評論都代表你的分析不夠深入。
- 對每檔持股，假設它會在未來 30 天下跌 20%，列出最可能的 3 個原因
- 對每個 thesis，列出 3 個會讓它完全失效的情境
- 對每個催化劑，說明為什麼它可能不會發生或已被市場定價
- 計算整體組合在最壞情境下的最大虧損金額

格式：

## 🔴 逐股致命風險
（每檔持股的最大下行風險，假設未來 30 天跌 20% 的情境分析）

## 💀 Thesis 失效情境
（每個投資論文可能被完全推翻的 3 個情境）

## ⚡ 催化劑失效風險
（為什麼你期待的利多可能不會發生）

## 📉 最壞情境計算
（整體組合的最大虧損金額和比例）

## 🚨 最需要立即行動的 3 檔
（哪些持股的風險報酬比最差，應該優先處理）

你的分析必須讓持有者感到不安。如果看完後覺得安心，代表分析不夠深入。`
}

export function buildStressTestUserPrompt({ holdingSummary = '', totalValue = 0 }) {
  return `持倉 dossier：
${holdingSummary || '目前沒有持股 dossier。'}

目前組合總市值約 ${Number(totalValue || 0).toLocaleString()} 元

請進行全面風險壓力測試。`
}

export function buildEventReviewBrainUserPrompt({
  event,
  notesContext = '',
  reviewDossierContext = '',
  actual,
  savedNote = '',
  wasCorrect = false,
  reviewedEvent = null,
  reviewDate = '',
  savedLessons = '',
  currentBrain = null,
}) {
  return `事件：${event?.title || ''}
${notesContext}
相關持股 dossier：
${reviewDossierContext || '無可用持股 dossier'}

預測：${formatPredictionLabel(event?.pred)} — ${event?.predReason || ''}
實際走勢：${formatActualLabel(actual)} — ${savedNote}
預測${wasCorrect ? '正確' : '錯誤'}
事件日期：${reviewedEvent?.eventDate || event?.date || '未填'}；結案日期：${reviewedEvent?.exitDate || reviewDate}
請優先用真實 outcome 驗證舊規則，再決定是否新增候選規則；只有與這次事件 / 相關持股 dossier 有關的既有核心規則與 candidate rule 才需要落入 validatedRules / staleRules / invalidatedRules。
驗證時至少檢查：月營收節奏、法說/財報/事件窗口、目標價/公開報告 freshness、族群/題材輪動位置；若缺 fresh 證據或事件資訊不足，優先進 staleRules，不要硬判 validated / invalidated。
若這次失準只是個股流動性、監管、時間差、資金面、題材輪動差異，請在 historicalAnalogs.note 與 reason 說清楚，不要直接把規則判死。
用戶覆盤心得：${savedLessons || '（未填）'}

現有策略大腦：
${JSON.stringify(currentBrain)}

請更新策略大腦，特別注意：用戶的覆盤不一定客觀，如果有歸因偏差請指出。`
}

export function buildWeeklyReportTemplate({
  today,
  holdings = [],
  watchlist = [],
  analysisHistory = [],
  newsEvents = [],
  strategyBrain = null,
  totalCost = 0,
  totalVal = 0,
  totalPnl = 0,
  retPct = 0,
  isClosedEvent = () => false,
  resolveHoldingPrice = () => 0,
  getHoldingUnrealizedPnl = () => 0,
  getHoldingReturnPct = () => 0,
  brainRuleSummary = (rule) => rule?.text || '',
}) {
  const pastEvents = newsEvents.filter(isClosedEvent)
  const pendingEvents = newsEvents.filter((event) => !isClosedEvent(event))
  const hits = pastEvents.filter((event) => event.correct === true).length
  const total = pastEvents.filter((event) => event.correct !== null).length

  const holdingLines = holdings
    .map((holding) =>
      formatHoldingLine({
        holding,
        resolveHoldingPrice,
        getHoldingUnrealizedPnl,
        getHoldingReturnPct,
      })
    )
    .join('\n')

  const recentAnalyses = analysisHistory
    .slice(0, 7)
    .map(formatRecentAnalysisLine)
    .join('\n\n---\n\n')

  const eventLines = pastEvents
    .map(
      (event) =>
        `[${event.correct ? '✓準確' : '✗失誤'}] ${event.date} ${event.title}\n  預測：${formatPredictionLabel(event.pred)} | 結果：${event.actualNote}`
    )
    .join('\n')

  const pendingLines = pendingEvents
    .map(
      (event) =>
        `[⏳] ${event.date} ${event.title}\n  預測：${formatPredictionLabel(event.pred)} | 理由：${event.predReason}`
    )
    .join('\n')

  const brainSection = buildWeeklyReportBrainSection(strategyBrain, brainRuleSummary)

  return `# 持倉看板週報素材
生成日期：${today}
總成本：${totalCost.toLocaleString()} | 總市值：${totalVal.toLocaleString()} | 損益：${formatSignedPrefix(totalPnl)}${totalPnl.toLocaleString()}（${formatSignedPrefix(retPct)}${retPct.toFixed(2)}%）
持股數：${holdings.length} 檔 | 事件預測命中率：${total > 0 ? `${Math.round((hits / total) * 100)}%（${hits}/${total}）` : '尚無數據'}

## 持倉明細
${holdingLines}

## 觀察股
${watchlist.length > 0 ? watchlist.map((item) => `${item.name}(${item.code}) | 現價${item.price} | 目標${item.target || '未設定'} | 狀態：${item.status || '觀察中'}`).join('\n') : '無'}

## 事件預測紀錄
已驗證（${pastEvents.length} 筆）：
${eventLines || '無'}

待處理（${pendingEvents.length} 筆）：
${pendingLines || '無'}
${brainSection}

## 近 7 日收盤分析
${recentAnalyses || '尚無分析紀錄'}

---
以上為持倉看板自動生成的週報素材，請根據這些數據撰寫 Podcast 腳本。`
}
