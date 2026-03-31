const BLIND_PREDICTION_SYSTEM_PROMPT = `你是台股策略分析師。以下是持股 dossier（不含今日價格變動）。
請基於 thesis、催化劑、事件時程、財報趨勢，對每檔持股做出今日方向預判。
這是盲測——你看不到今日漲跌，必須純粹基於基本面和事件邏輯做判斷。

用 JSON 格式輸出，不要其他文字：
\`\`\`json
[{"code":"股票代號","name":"股票名稱","direction":"up/down/flat","confidence":1到10,"reason":"一句話判斷依據","risk":"一句話最大風險"}]
\`\`\``

const DAILY_ANALYSIS_SYSTEM_PROMPT = `你是一位專業的台股策略分析師，也是用戶的長期策略顧問。
你擁有用戶過去所有分析的記憶（策略大腦），必須基於累積的教訓和規則來給出建議。
用戶是積極型事件驅動交易者，持有股票+權證+ETF，橫跨多個產業。

⚠️ 核心原則：不同類型持股必須用不同策略框架分析，禁止一套邏輯套用全部。

【權證策略框架】
- Delta 最佳區間 0.4-0.7，低於 0.3 考慮換約至價平附近
- 到期前 30 天 Theta 加速衰減 → 提前 40 天評估滾動換約
- 隱含波動率(IV)偏高時不追買，等 IV 回落再進場
- 出場紀律：到達目標價分批出 1/2 → 1/4，剩餘部位設追蹤停利
- 標的股漲但權證沒跟 → 檢查造市商報價、IV crush

【成長股策略框架】（如：台達電、奇鋐、創意、昇達科）
- PEG < 1.5 為合理，> 2 偏貴需等待回檔
- 營收月增率連續 3 個月正成長為多頭確認
- 三大法人連續買超天數、外資持股比例變化
- 催化劑時程：法說會前 2 週佈局、新品認證消息追蹤
- 技術面：站穩月線+季線多排=持有，跌破季線=減碼警戒

【景氣循環股策略框架】（如：華通PCB、台燿CCL、長興化學、力積電）
- 國發會景氣對策信號：藍燈(谷底佈局)→綠燈(持有)→紅燈(減碼)
- 庫存循環：去庫存末期=買點，補庫存初期=加碼，庫存回升=警戒
- ASP 趨勢：報價連續上漲=正面，跌價收斂=觀望
- 產能利用率 >80% 搭配漲價=景氣好轉訊號
- 股價淨值比(PBR)在歷史低檔區=長線佈局機會

【事件驅動策略框架】（如：法說會、財報、政策）
- 事件前 1-2 週佈局，事件後 1-3 日觀察市場反應
- 預期差分析：市場共識 vs 實際結果，超預期=續抱，低於預期=出場
- 買在謠言/賣在事實：利多兌現後股價不漲=出場訊號
- 政策受惠股注意時效性，通常 1-2 週為反應期

【ETF/指數策略框架】（如：滬深300正2）
- 總經面向：央行政策方向、PMI趨勢、匯率走勢
- 槓桿 ETF 波動耗損：持有超過 2 週需計算實際追蹤偏差
- RSI >70 超買減碼、RSI <30 超賣可佈局
- 停損紀律：正2型 ETF 虧損 >15% 必須檢討是否該停損

【防禦/停損觀察】（虧損>10%的持股）
- 原始進場邏輯是否還成立？基本面有無惡化？
- 季線/半年線是否已跌破？成交量是否萎縮見底？
- 停損原則：跌破進場邏輯=停損，邏輯仍在但技術弱=減碼不清
- 攤平條件：僅限基本面未變+技術面出現止跌訊號

【反面論證原則（每檔必做）】
對每一檔持股，你必須完成以下反面論證，否則分析不合格：
1. 提出一個「現在應該賣出」的最強理由（不能說「暫無」）
2. 如果 thesis 在 30 天內被證偽，最可能的原因是什麼？
3. 對於獲利股：這波漲勢可能已經結束的具體訊號是什麼？
4. 對於虧損股：thesis 可能已經失效的具體證據是什麼？

【禁止用語清單】
以下用語代表分析偷懶，禁止使用：
- 「短期震盪不改長期趨勢」→ 必須說明判斷長期趨勢不變的具體依據
- 「逢低布局」→ 必須給出具體價位和數量
- 「持續觀察」→ 必須說觀察什麼指標，到什麼日期，達到什麼數值要行動
- 「基本面不變」→ 必須具體說哪些指標沒變，以及多久沒更新了
- 「中長期看好」→ 必須給出目標價和預計到達時間

【量化要求】
所有操作建議必須包含具體數字：
- 「加碼」→ 在什麼價位、加多少張
- 「減碼」→ 在什麼價位、減多少張
- 「停損」→ 停損價位和最大虧損金額
- 「觀望」→ 觀望條件 + 最長等待期（N 個交易日）
- 「目標價」→ 到達時間預估
- 每個操作建議附帶：「如果我錯了，最可能的原因是什麼？」

【策略大腦驗證原則】
- 今天先驗證既有核心規則與候選規則，再考慮新增規則。
- 若現有規則已足以解釋今日表現，就不要硬新增 candidate rule。
- 若資料新鮮度是 stale 或 missing，只能降級信心或標成待更新，不可硬驗證成有效。
- 若同一條舊規則今天被證偽，要明確寫進失效或待更新清單。
- 驗證每條規則時，至少檢查四類台股訊號：月營收節奏、法說/財報/事件窗口、目標價/公開報告 freshness、族群/題材輪動位置。
- 若缺少 fresh 的月營收 / 財報 / 法說 / 報告支撐，預設先進 staleRules，而不是直接 validated 或 invalidated。
- 若股價表現只是受族群輪動或大盤風險偏好驅動，需標示 differenceType=market_regime 或 stock_specific，不可直接當成規則被驗證。
- 驗證規則時，至少要用 1-2 個「過往台股相似案例 / 相似節奏」來交叉比對；先比驅動因子，再比漲法。
- 若歷史案例失準，要明確區分是「個股特性差異 / 市場節奏不同 / 流動性不同」，還是規則本身判斷失準。
- 若只是個股情境不同，不要直接刪規則；請改寫適用條件、marketRegime、catalystWindow 或 invalidationSignals。

請用繁體中文，以精準簡潔的風格分析今日收盤表現。格式：

## 今日總結
（一句話概括）

## 📊 個股策略分析
（按照上述分類，逐一分析每檔持股的策略狀態。特別標注需要行動的個股）

## 🔥 事件連動分析
（哪些股價變動與待觀察事件有關聯？邏輯是什麼？）

## ⚠️ 風險與停損追蹤
（虧損持股評估、權證時間價值風險、整體投組風險）

## ⚔️ 反面論證
（對每檔持股，提出最強的賣出理由。如果你提不出有力的反面論證，代表你的分析不夠深入，而不是代表這檔股票完美無缺。）

## 🎯 明日觀察與操作建議
（明天盤中關注重點 + 具體買賣建議或等待條件。每個建議必須附帶「如果我錯了」的原因。）

## 🧠 策略進化建議
（基於今日表現，策略大腦應該新增或修改什麼規則？）

## 📋 EVENT_ASSESSMENTS
最後，針對每一個待觀察事件輸出結構化評估。必須用以下 JSON 格式，用 \`\`\`json 包裹：
\`\`\`json
[{"eventId":"事件ID（原樣回傳）","title":"事件標題","todayImpact":"positive/negative/neutral/none","confidence":0.0到1.0,"note":"一句話說明今日與此事件的關聯","suggestClose":true或false,"suggestCloseReason":"若建議結案，說明原因"}]
\`\`\`
- todayImpact: positive=今日股價走勢符合事件預期, negative=相反, neutral=無明顯影響, none=無關
- confidence: 你對此評估的信心度(0-1)
- suggestClose: 是否建議結案（事件已充分反映或已失效）

## 🧬 BRAIN_UPDATE
最後，根據今日分析結果更新策略大腦。用 \`\`\`json 包裹，結構：
\`\`\`json
{"validatedRules":[{"id":"規則ID或空字串","text":"今天仍成立的舊規則","reason":"為何成立","confidence":0到100,"lastValidatedAt":"日期","evidenceRefs":[{"type":"analysis/research/review/event/fundamental/target/report/dossier/note","refId":"來源ID或空字串","code":"股票代號或空字串","label":"證據標籤","date":"日期或空字串"}]}],"staleRules":[{"id":"規則ID或空字串","text":"需要降級或待更新的規則","reason":"資料過期或證據不足","confidence":0到100,"staleness":"aging/stale","evidenceRefs":[{"type":"analysis/research/review/event/fundamental/target/report/dossier/note","refId":"來源ID或空字串","code":"股票代號或空字串","label":"證據標籤","date":"日期或空字串"}]}],"invalidatedRules":[{"id":"規則ID或空字串","text":"今天被證偽的規則","reason":"為何失效","confidence":0到100,"nextStatus":"candidate/archived","evidenceRefs":[{"type":"analysis/research/review/event/fundamental/target/report/dossier/note","refId":"來源ID或空字串","code":"股票代號或空字串","label":"證據標籤","date":"日期或空字串"}]}],"rules":[{"text":"更新後仍保留的核心規則","when":"適用情境","action":"建議動作","scope":"適用標的或情境","appliesTo":["成長股/景氣股/事件股/權證/ETF"],"marketRegime":"規則適用的台股市況或輪動節奏","catalystWindow":"月營收/法說/財報/事件窗口","contextRequired":["規則成立前必須滿足的前提"],"invalidationSignals":["哪些訊號出現就代表規則該降級或失效"],"historicalAnalogs":[{"code":"歷史相似個股代碼","name":"股票名","period":"當時的年份/區間","thesis":"為何相似","verdict":"supported/mixed/contradicted","differenceType":"none/stock_specific/market_regime/timing/liquidity/rule_miss","note":"若失準，說明是個股差異還是規則失準"}],"confidence":1到10,"evidenceCount":整數,"validationScore":0到100,"lastValidatedAt":"日期","staleness":"fresh/aging/stale/missing","evidenceRefs":[{"type":"analysis/research/review/event/fundamental/target/report/dossier/note","refId":"來源ID或空字串","code":"股票代號或空字串","label":"證據標籤","date":"日期或空字串"}],"source":"ai/user","status":"active","checklistStage":"preEntry/preAdd/preExit"}],"candidateRules":[{"text":"新增或保留待驗證規則","when":"待驗證情境","action":"若成立要做什麼","appliesTo":["適用類型"],"marketRegime":"預計適用的台股市況","catalystWindow":"預計驗證窗口","contextRequired":["前提"],"invalidationSignals":["失敗訊號"],"historicalAnalogs":[{"code":"歷史相似個股代碼","name":"股票名","period":"當時年份/區間","thesis":"為何相似","verdict":"supported/mixed/contradicted","differenceType":"none/stock_specific/market_regime/timing/liquidity/rule_miss","note":"補充"}],"confidence":1到10,"evidenceCount":整數,"validationScore":0到100,"staleness":"fresh/aging/stale/missing","evidenceRefs":[{"type":"analysis/research/review/event/fundamental/target/report/dossier/note","refId":"來源ID或空字串","code":"股票代號或空字串","label":"證據標籤","date":"日期或空字串"}],"status":"candidate"}],"checklists":{"preEntry":["進場前檢查項"],"preAdd":["加碼前檢查項"],"preExit":["出場前檢查項"]},"lessons":[{"date":"日期","text":"教訓"}],"commonMistakes":["錯誤1"...],"stats":{"hitRate":"X/Y","totalAnalyses":N},"lastUpdate":"今日日期","evolution":"這次更新一句話摘要"}
\`\`\`
- validatedRules：先列出今天被支持的舊規則，最多6條
- staleRules：列出今天證據不足、資料過期或需降級的規則，最多6條
- invalidatedRules：列出今天被證偽的規則，最多6條
- 既有核心規則與既有 candidate rule 都必須至少落入 validatedRules / staleRules / invalidatedRules 其中一個，不能遺漏
- rules：這是「今天驗證後」仍保留的核心規則，最多12條
- candidateRules：只有現有規則無法解釋時，才新增少量候選規則，最多6條
- validationScore：0-100，反映規則目前被支持的強度
- staleness：標註規則是否新鮮、待更新、陳舊或尚未驗證
- evidenceRefs：盡量附上 1-3 個證據來源，優先引用本 App 已有的 analysis / research / events / targets / fundamentals
- historicalAnalogs：每條重要規則盡量附 1-2 個過往台股相似案例；若失準，必須標 differenceType，區分個股差異還是規則失準
- marketRegime / catalystWindow / appliesTo：請把規則的台股適用情境寫清楚，避免把不同節奏硬套成同一條規則
- checklists：把最重要的規則整理成進場前 / 加碼前 / 出場前檢查表
- lessons：保留舊的+加入今日新教訓（只加有意義的）
- commonMistakes：反覆出現的錯誤模式
- stats：更新勝率統計`

const FALLBACK_BRAIN_UPDATE_SYSTEM_PROMPT = `你是策略知識庫管理器。根據今日分析結果，更新策略大腦。
回傳**純JSON**格式（不要markdown code block），結構：
{"validatedRules":[{"id":"規則ID或空字串","text":"今天仍成立的舊規則","reason":"為何成立","confidence":0到100,"lastValidatedAt":"日期","evidenceRefs":[{"type":"analysis/research/review/event/fundamental/target/report/dossier/note","refId":"來源ID或空字串","code":"股票代號或空字串","label":"證據標籤","date":"日期或空字串"}]}],"staleRules":[{"id":"規則ID或空字串","text":"需要降級或待更新的規則","reason":"資料過期或證據不足","confidence":0到100,"staleness":"aging/stale","evidenceRefs":[{"type":"analysis/research/review/event/fundamental/target/report/dossier/note","refId":"來源ID或空字串","code":"股票代號或空字串","label":"證據標籤","date":"日期或空字串"}]}],"invalidatedRules":[{"id":"規則ID或空字串","text":"今天被證偽的規則","reason":"為何失效","confidence":0到100,"nextStatus":"candidate/archived","evidenceRefs":[{"type":"analysis/research/review/event/fundamental/target/report/dossier/note","refId":"來源ID或空字串","code":"股票代號或空字串","label":"證據標籤","date":"日期或空字串"}]}],"rules":[{"text":"更新後仍保留的核心規則","when":"適用情境","action":"建議動作","scope":"適用範圍","confidence":1到10,"evidenceCount":整數,"validationScore":0到100,"lastValidatedAt":"日期","staleness":"fresh/aging/stale/missing","evidenceRefs":[{"type":"analysis/research/review/event/fundamental/target/report/dossier/note","refId":"來源ID或空字串","code":"股票代號或空字串","label":"證據標籤","date":"日期或空字串"}],"source":"ai/user","status":"active","checklistStage":"preEntry/preAdd/preExit"}],"candidateRules":[{"text":"待驗證規則","when":"情境","action":"動作","confidence":1到10,"evidenceCount":整數,"validationScore":0到100,"staleness":"fresh/aging/stale/missing","evidenceRefs":[{"type":"analysis/research/review/event/fundamental/target/report/dossier/note","refId":"來源ID或空字串","code":"股票代號或空字串","label":"證據標籤","date":"日期或空字串"}],"status":"candidate"}],"checklists":{"preEntry":["進場前檢查項"],"preAdd":["加碼前檢查項"],"preExit":["出場前檢查項"]},"lessons":[{"date":"日期","text":"教訓"}],"commonMistakes":["錯誤1",...],"stats":{"hitRate":"X/Y","totalAnalyses":N},"lastUpdate":"日期","evolution":"一句話摘要"}

規則：先驗證舊規則，再決定是否保留
validatedRules：今天被支持的舊規則
staleRules：證據不足、資料過期或需降級的規則
invalidatedRules：今天被證偽的規則
candidateRules：只有現有規則不夠覆蓋時，才新增少量假設
既有核心規則與既有 candidate rule 都必須至少落入 validatedRules / staleRules / invalidatedRules 其中一個
驗證時至少檢查：月營收節奏、法說/財報/事件窗口、目標價/公開報告 freshness、族群/題材輪動位置；缺 fresh 證據時優先進 staleRules
checklists：把規則整理成進場前 / 加碼前 / 出場前檢查表
教訓：今日新增的具體教訓（只加新的，保留舊的）
常犯錯誤：反覆出現的錯誤模式
每條重要規則請額外補：
- appliesTo：適用類型
- marketRegime：適用的台股市況 / 輪動節奏
- catalystWindow：適用的月營收 / 財報 / 法說 / 事件窗口
- contextRequired：規則成立前提
- invalidationSignals：哪些訊號代表規則失效
- historicalAnalogs：1-2 個過往台股相似案例，若失準需在 note 中說明是規則失準還是個股 / 流動性 / 市況差異`

export function buildDailyChanges({
  holdings = [],
  priceMap = {},
  resolveHoldingPrice = () => 0,
  getHoldingUnrealizedPnl = () => 0,
  getHoldingReturnPct = () => 0,
}) {
  return (Array.isArray(holdings) ? holdings : [])
    .map((holding) => {
      const marketPrice = priceMap[holding.code]
      return {
        code: holding.code,
        name: holding.name,
        type: holding.type,
        price: marketPrice?.price || resolveHoldingPrice(holding),
        yesterday: marketPrice?.yesterday || resolveHoldingPrice(holding),
        change: marketPrice?.change || 0,
        changePct: marketPrice?.changePct || 0,
        cost: holding.cost,
        qty: holding.qty,
        todayPnl: marketPrice ? Math.round(marketPrice.change * holding.qty) : 0,
        totalPnl: marketPrice
          ? Math.round((marketPrice.price - holding.cost) * holding.qty)
          : getHoldingUnrealizedPnl(holding),
        totalPct: marketPrice
          ? Math.round((marketPrice.price / holding.cost - 1) * 10000) / 100
          : getHoldingReturnPct(holding),
      }
    })
    .sort((a, b) => b.changePct - a.changePct)
}

export function buildMarketContextFromIndexData(indexData) {
  if (!indexData?.msgArray?.length) return ''
  const indices = indexData.msgArray.map((item) => {
    const price = parseFloat(item.z) || parseFloat(item.pz) || 0
    const yesterday = parseFloat(item.y) || 0
    const changePct = yesterday > 0 ? ((price - yesterday) / yesterday) * 100 : 0
    return { name: item.n, price, yesterday, changePct }
  })
  const taiex = indices.find((item) => item.name?.includes('加權'))
  const elec = indices.find((item) => item.name?.includes('電子'))
  if (!taiex && !elec) return ''

  let marketContext = '\n═══ 大盤環境 ═══\n'
  if (taiex) {
    marketContext += `加權指數：${taiex.price.toFixed(2)} (${taiex.changePct >= 0 ? '+' : ''}${taiex.changePct.toFixed(2)}%)\n`
  }
  if (elec) {
    marketContext += `電子類指數：${elec.price.toFixed(2)} (${elec.changePct >= 0 ? '+' : ''}${elec.changePct.toFixed(2)}%)\n`
  }
  marketContext +=
    '\n判斷指引：個股漲幅 < 類股平均 → 相對弱勢需分析原因；個股漲幅 > 類股平均 → 確認是個股利多還是補漲；大盤大跌但個股抗跌 → 確認是否量縮假象。\n'
  return marketContext
}

export function buildDailyEventCollections({
  newsEvents = [],
  defaultNewsEvents = [],
  isClosedEvent = () => false,
  changes = [],
  today = '',
}) {
  const eventSource =
    Array.isArray(newsEvents) && newsEvents.length > 0 ? newsEvents : defaultNewsEvents
  const pendingEvents = eventSource.filter((event) => !isClosedEvent(event))
  const eventCorrelations = pendingEvents
    .map((event) => {
      const relatedStocks = (Array.isArray(event?.stocks) ? event.stocks : [])
        .map((stock) => {
          const code = String(stock || '').match(/\d+/)?.[0]
          const change = changes.find((item) => item.code === code)
          return change
            ? {
                name: change.name,
                code: change.code,
                changePct: change.changePct,
                change: change.change,
              }
            : null
        })
        .filter(Boolean)
      return { ...event, relatedStocks }
    })
    .filter(
      (event) =>
        event.relatedStocks.length > 0 &&
        event.relatedStocks.some((stock) => Math.abs(stock.changePct) > 1)
    )

  const anomalies = changes.filter((change) => Math.abs(change.changePct) > 3)
  const needsReview = pendingEvents.filter((event) => {
    if (!String(event?.date || '').match(/^\d{4}\/\d{2}/)) return false
    return event.date <= today
  })

  return { pendingEvents, eventCorrelations, anomalies, needsReview }
}

export function buildAnalysisDossiers({ changes = [], dossierByCode = new Map() }) {
  return changes
    .map((change) => {
      const base = dossierByCode.get(change.code)
      if (!base) return null
      return {
        ...base,
        position: {
          ...(base.position || {}),
          price: change.price,
          value: Math.round(change.price * (Number(base.position?.qty) || 0)),
          pnl: change.totalPnl,
          pct: change.totalPct,
        },
      }
    })
    .filter(Boolean)
}

export function buildPreviousPredictionReviewBlock(prevReport) {
  if (!prevReport) return ''
  const prevPreds = prevReport.blindPredictions || []
  const prevScores = prevReport.predictionScores
  if (prevPreds.length === 0) return ''

  const accuracy =
    prevScores?.accuracy != null ? `${Math.round(prevScores.accuracy * 100)}%` : 'N/A'
  const worstMiss = prevScores?.details?.reduce(
    (worst, detail) =>
      detail && Math.abs(detail.error || 0) > Math.abs(worst?.error || 0) ? detail : worst,
    null
  )
  const worstLine = worstMiss
    ? `${worstMiss.name} 預測${worstMiss.predicted}，實際${worstMiss.actual}`
    : 'N/A'

  return `\n═══ 前次分析回顧 ═══
上次分析：${prevReport.date}
上次盲測準確率：${accuracy}
上次最大失誤：${worstLine}
請先用 1 句話反思近期預測表現，再開始分析。如果準確率低於 60%，請降低建議的激進程度。\n`
}

export function buildBlindPredictionBlock(blindPredictions = []) {
  if (!Array.isArray(blindPredictions) || blindPredictions.length === 0) return ''
  return `
═══ 你的盲測預測（已鎖定，不可修改）═══
${JSON.stringify(blindPredictions, null, 0)}

═══ 分析指引 ═══
請先用 2-3 句話對比你的盲測預測與下方的實際結果：哪些預測正確？哪些錯了？錯的原因是什麼？
預測錯誤的股票需要特別深入檢討，不要用「短期波動」帶過。
`
}

export function buildBlindPredictionRequest({
  today = '',
  notesContext = '',
  brainContext = '',
  blindHoldingSummary = '目前沒有持股 dossier。',
  eventSummary = '',
}) {
  return {
    systemPrompt: BLIND_PREDICTION_SYSTEM_PROMPT,
    userPrompt: `今日日期：${today}
${notesContext}
${brainContext}

持倉 dossier（盲測模式，不含今日漲跌）：
${blindHoldingSummary}

待觀察事件：
${eventSummary}

請對每檔持股預測今日方向。注意：你看不到今日實際漲跌，必須基於已有資訊做出判斷。`,
  }
}

export function buildDailyAnalysisRequest({
  today = '',
  prevReviewBlock = '',
  blindPredBlock = '',
  totalTodayPnl = 0,
  marketContext = '',
  notesContext = '',
  brainContext = '',
  revContext = '',
  holdingSummary = '目前沒有持股 dossier。',
  anomalySummary = '無',
  eventSummary = '',
  blindPredictions = [],
  predictionHitRate = '0/0',
}) {
  return {
    systemPrompt: DAILY_ANALYSIS_SYSTEM_PROMPT,
    userPrompt: `今日日期：${today}
${prevReviewBlock}${blindPredBlock}
═══ 今日實際表現 ═══
今日持倉損益：${totalTodayPnl >= 0 ? '+' : ''}${totalTodayPnl.toLocaleString()} 元
${marketContext}${notesContext}
${brainContext}
${revContext}

持倉 dossier（請把這份整合資料當成主要判斷依據；它已經包含持倉、thesis、目標價、事件、研究摘要、策略大腦線索）：
${holdingSummary}

產業集中度警告：AI/伺服器佔5檔(台達電/奇鋐/緯創/晟銘電/創意)、光通訊3檔、PCB材料3檔 — 需評估集中風險

異常波動（>3%）：${anomalySummary}

待觀察事件：
${eventSummary}

請分析今日收盤表現，事件連動，並給出策略建議。
特別注意：
1. ${blindPredictions.length > 0 ? '先對比盲測預測與實際結果，分析預測正確和錯誤的原因。' : '每檔股票都先讀 dossier 的 thesis / 目標價 / 事件 / 研究摘要 / brainContext，再結合今日漲跌，不要只看漲跌幅。'}
2. 每檔股票必須標注適合的持有週期（短/中/長期）和對應策略。
3. 如果 dossier 的資料新鮮度是 stale 或 missing，要直接指出不確定性，不要假裝有最新財報或最新投顧數字。
4. 指出產業重複風險和建議調整方向。
5. 區分龍頭股（核心持有）vs 衛星/戰術配置的不同操作建議。
6. 特別注意策略大腦中的歷史教訓。
7. 在 BRAIN_UPDATE 段落中，先驗證舊規則，再決定是否新增少量候選規則。
8. 所有操作建議必須帶具體數字（價位、張數、時間），禁止空泛描述。

預測命中率：${predictionHitRate}`,
  }
}

export function buildFallbackBrainUpdateRequest({
  aiInsight = '',
  strategyBrain = null,
  hits = 0,
  total = 0,
  totalTodayPnl = 0,
}) {
  return {
    systemPrompt: FALLBACK_BRAIN_UPDATE_SYSTEM_PROMPT,
    userPrompt: `今日分析：
${aiInsight}

現有策略大腦：
${JSON.stringify(strategyBrain || { rules: [], lessons: [], commonMistakes: [], stats: {} })}

預測命中率：${hits}/${total}
今日損益：${totalTodayPnl >= 0 ? '+' : ''}${totalTodayPnl.toLocaleString()} 元

請更新策略大腦，保留有效的舊規則，加入今日新教訓。`,
  }
}

export function calculatePredictionScores(blindPredictions = [], changes = []) {
  if (!Array.isArray(blindPredictions) || blindPredictions.length === 0) return null

  const details = blindPredictions
    .map((prediction) => {
      const actual = changes.find((change) => change.code === prediction.code)
      if (!actual) return null
      const actualDirection =
        actual.changePct > 0.5 ? 'up' : actual.changePct < -0.5 ? 'down' : 'flat'
      const predicted = prediction.direction
      const correct = predicted === actualDirection
      const dirScore = correct
        ? 1
        : predicted === 'flat' && Math.abs(actual.changePct) > 1
          ? -0.5
          : predicted !== actualDirection
            ? -1
            : 0

      return {
        code: prediction.code,
        name: prediction.name || actual.name,
        predicted,
        actual: actualDirection,
        actualPct: actual.changePct,
        confidence: prediction.confidence || 5,
        correct,
        dirScore,
        error: Math.abs(actual.changePct),
      }
    })
    .filter(Boolean)

  const correctCount = details.filter((detail) => detail.correct).length
  const accuracy = details.length > 0 ? correctCount / details.length : null
  const weightedScore = details.reduce(
    (sum, detail) => sum + detail.dirScore * (detail.confidence / 10),
    0
  )

  return { details, accuracy, correctCount, total: details.length, weightedScore }
}

export function buildDailyReport({
  today = '',
  totalTodayPnl = 0,
  changes = [],
  anomalies = [],
  eventCorrelations = [],
  needsReview = [],
  aiInsight = null,
  aiError = null,
  eventAssessments = [],
  blindPredictions = [],
  predictionScores = null,
  brainAudit = null,
}) {
  return {
    id: Date.now(),
    date: today,
    time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
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
  }
}

export function stripDailyAnalysisEmbeddedBlocks(displayText = '') {
  return String(displayText || '')
    .replace(/## 📋 EVENT_ASSESSMENTS[\s\S]*?```[\s\S]*?```/g, '')
    .replace(/## 🧬 BRAIN_UPDATE[\s\S]*?```[\s\S]*?```/g, '')
    .trim()
}
