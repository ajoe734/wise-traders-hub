/**
 * Demo data for unauthenticated users viewing the free checkup.
 * Uses the full seed holdings (20+ stocks) instead of a thin 5-item set.
 */

import { INIT_HOLDINGS } from '../seedData.js'

/**
 * Demo 資料版本（YYYY-MM）。每次手動更新本檔內容時請同步調整。
 * 若版本與當前月份相差 > 60 天，DemoBanner 會顯示「示範資料更新中」提醒。
 * 維護方式：scripts/refresh-demo-data.mjs（詳見 docs/demo-data-maintenance.md）
 */
export const DEMO_DATA_VERSION = '2026-05'

export const DEMO_HOLDINGS = INIT_HOLDINGS

const _demoToday = new Date().toLocaleDateString('zh-TW').replace(/-/g, '/')

export const DEMO_ANALYSIS = {
  date: _demoToday,
  // aiInsight：對應 dailyReport.aiInsight，會被 <Md /> 渲染成主分析內容
  aiInsight: `## 今日總結
AI/散熱族群延續強勢，整體持倉今日漲跌互見，成長股走勢明顯優於景氣循環標的。

## 事件連動分析
- **奇鋐液冷大單** 對應 GB200 出貨進度，今日 +2.1% 與消息面相符
- **創意 CoWoS 良率** 雜音影響，股價弱勢但量縮，尚未跌破關鍵均線

## 個股操作建議
- **3017 奇鋐**：液冷利多落地後等待回測 5 日線再加碼
- **3443 創意**：良率消息持續觀察 3 個交易日，跌破前波低點再考慮減碼
- **2308 台達電**：除息前後波動加大，核心倉位續抱
- **晟銘電**：仍處弱勢，已持有部位需設明確停損

## 風險警示
持倉集中於 AI/半導體（>60%），建議下次加碼考慮金融或傳產分散風險。

---
*此為 DEMO 範例分析，登入後系統會根據你的真實持倉與當日盤後資料生成個人化報告。*`,
  summary: `## 📊 今日收盤分析（Demo 模式）

### 大盤概況
加權指數收在 22,850 點，成交量 3,200 億，量能溫和。外資買超 85 億，投信賣超 12 億。

### 持倉檢視

| 標的 | 今日表現 | 觀察重點 |
|------|----------|----------|
| 2308 台達電 | +1.2% | AI 伺服器＋電動車雙引擎，法人持續加碼 |
| 3017 奇鋐 | +2.1% | 散熱模組需求強勁，資料中心擴建帶動 |
| 3443 創意 | +1.5% | ASIC 設計案持續增加，CoWoS 產能加持 |
| 3491 昇達科 | +0.8% | CPO 光通訊商機，低軌衛星訂單 |
| 2313 華通 | -0.3% | ABF 載板需求回溫，等待 Q2 拉貨 |
| 053848 亞翔權證 | +3.2% | 半導體設備需求增，權證槓桿放大 |

### 風險提示
⚠️ 持倉集中於 AI/半導體族群（佔比 > 60%），建議適度分散。
⚠️ 權證部位佔比留意時間價值耗損。

### 明日觀察
- 台積電法說會後續效應
- 美國非農數據公布
- 外資期貨未平倉變化

---
*此為 Demo 模式的範例分析，上傳您的成交明細即可獲得個人化分析。*`,
  holdings: [],
}

export const DEMO_BRAIN = {
  lastUpdated: new Date().toISOString(),
  summary: `### 策略大腦（Demo 模式）

**投資風格辨識**：以 AI/半導體成長股為核心，搭配權證做短線戰術操作。

**持倉結構分析**：
- 核心持股：台達電、奇鋐、創意、昇達科（中長期成長）
- 衛星持股：華通、長興、台燿（景氣循環/材料）
- 戰術部位：權證（禾伸堂、亞翔、華星光）＋ 滬深300正2

**常見模式**：
1. 偏好在法說會或營收公布前佈局
2. 權證操作偏好中長天期認購
3. 停損紀律可再加強（晟銘電 -21%、創意 -11%）

**建議改善**：
- 虧損標的（晟銘電、士電）設定明確出場條件
- 權證到期前 1 個月需重新評估是否展期
- 增加非科技族群配置（如金融、傳產）降低集中風險

*上傳真實交易紀錄後，AI 將根據您的實際操作模式給出個人化建議。*`,
}

// Decision v6 test events — these have source !== 'demo' so buildDecision picks them up
const today = new Date().toISOString().slice(0, 10)
const todaySlash = today.replace(/-/g, '/')
const threeDaysLater = (() => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString().slice(0, 10) })()
const fiveDaysLater = (() => { const d = new Date(); d.setDate(d.getDate() + 5); return d.toISOString().slice(0, 10) })()
const sevenDaysLater = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10) })()
const tenDaysLater = (() => { const d = new Date(); d.setDate(d.getDate() + 10); return d.toISOString().slice(0, 10) })()
const fourteenDaysLater = (() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10) })()
const thirtyDaysAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) })()

export const DEMO_EVENTS = [
  // ── Legacy demo events (source: 'demo', filtered out by buildDecision) ──
  {
    id: 'demo-1',
    date: threeDaysLater.replace(/-/g, '/'),
    title: '3443 創意法說會',
    detail: 'Q1 財報公布暨法說會，關注 CoWoS 進度',
    stocks: [{ code: '3443', name: '創意' }],
    type: '法說',
    status: 'pending',
    pred: 'up',
    predReason: 'ASIC 設計案增加，NVIDIA 合作深化，預期展望正面',
    source: 'demo',
  },
  {
    id: 'demo-2',
    date: fiveDaysLater.replace(/-/g, '/'),
    title: '6274 台燿法說會',
    detail: '法說會＋Q4 財報',
    stocks: [{ code: '6274', name: '台燿' }],
    type: '法說',
    status: 'verifying',
    pred: 'up',
    predReason: '毛利率回沖，AI 伺服器 CCL 需求強勁',
    source: 'demo',
  },
  {
    id: 'demo-3',
    date: sevenDaysLater.replace(/-/g, '/'),
    title: '3017 奇鋐營收公布',
    detail: '3月營收公告',
    stocks: [{ code: '3017', name: '奇鋐' }],
    type: '營收',
    status: 'pending',
    pred: 'up',
    predReason: '散熱模組需求持續成長，預期月營收年增 20%+',
    source: 'demo',
  },
  {
    id: 'demo-4',
    date: fourteenDaysLater.replace(/-/g, '/'),
    title: '美國 CPI 數據公布',
    detail: '消費者物價指數',
    stocks: [],
    type: '總經',
    status: 'pending',
    pred: 'neutral',
    predReason: '預期持平，若低於預期有利科技股',
    source: 'demo',
  },
  {
    id: 'demo-5',
    date: tenDaysLater.replace(/-/g, '/'),
    title: '2308 台達電除息',
    detail: '現金股利 $12.5',
    stocks: [{ code: '2308', name: '台達電' }],
    type: '除息',
    status: 'pending',
    pred: 'neutral',
    predReason: '殖利率約 0.9%，預期快速填息',
    source: 'demo',
  },

  // ── Decision v6 test events (source: 'user'/'ai', visible to buildDecision) ──

  // Scenario 1: 創意 — broken thesis (break impact), exit urgency
  {
    id: 'decision-test-1',
    date: todaySlash,
    title: '創意 CoWoS 良率問題',
    detail: '供應鏈消息指出 CoWoS 良率不如預期，可能影響 Q2 出貨',
    stocks: [{ code: '3443', name: '創意' }],
    type: '供應鏈',
    status: 'tracking',
    pred: 'down',
    predReason: '良率問題可能導致訂單遞延',
    source: 'user',
    category: 'supply_chain',
    decisionImpact: 'break',
    severity: 'high',
    occurredAt: today,
    relatedCodes: ['3443'],
    summary: 'CoWoS 良率不如預期，可能影響 Q2 出貨時程',
    evidence: '供應鏈調查、法人報告',
  },

  // Scenario 2: 奇鋐 — weakening + conflict (opposing impacts from different sources)
  {
    id: 'decision-test-2a',
    date: todaySlash,
    title: '奇鋐散熱訂單縮減',
    detail: '部分伺服器廠砍單，散熱模組需求下修',
    stocks: [{ code: '3017', name: '奇鋐' }],
    type: '營收',
    status: 'tracking',
    pred: 'down',
    predReason: '短期營收可能低於預期',
    source: 'ai',
    category: 'earnings',
    decisionImpact: 'weaken',
    severity: 'medium',
    occurredAt: today,
    relatedCodes: ['3017'],
    summary: '部分伺服器廠砍單，散熱模組需求下修 10-15%',
    evidence: 'AI 分析供應鏈數據',
  },
  {
    id: 'decision-test-2b',
    date: todaySlash,
    title: '奇鋐獲液冷大單',
    detail: 'NVIDIA GB200 液冷模組獨家供應',
    stocks: [{ code: '3017', name: '奇鋐' }],
    type: '訂單',
    status: 'tracking',
    pred: 'up',
    predReason: '液冷大單可彌補氣冷減少',
    source: 'user',
    category: 'catalyst',
    decisionImpact: 'strengthen',
    severity: 'high',
    occurredAt: today,
    relatedCodes: ['3017'],
    summary: 'NVIDIA GB200 液冷模組獨家供應，中長期利多',
    evidence: '法人報告確認',
  },

  // Scenario 3: 台達電 — stale event (30 days ago, tests freshness)
  {
    id: 'decision-test-3',
    date: thirtyDaysAgo.replace(/-/g, '/'),
    title: '台達電 Q4 財報優於預期',
    detail: 'EPS 超出市場共識 8%',
    stocks: [{ code: '2308', name: '台達電' }],
    type: '法說',
    status: 'tracking',
    pred: 'up',
    predReason: '財報利多但已反映完畢',
    source: 'user',
    category: 'earnings',
    decisionImpact: 'weaken',
    severity: 'low',
    occurredAt: thirtyDaysAgo,
    relatedCodes: ['2308'],
    summary: 'Q4 EPS 超出共識 8%，但股價已反映',
    evidence: '財報數據',
  },

  // Scenario 4: 台燿 — open event with review deadline (urgency: soon)
  {
    id: 'decision-test-4',
    date: fiveDaysLater.replace(/-/g, '/'),
    title: '台燿 CCL 報價調漲',
    detail: '主要客戶接受 Q2 調漲 5-8%',
    stocks: [{ code: '6274', name: '台燿' }],
    type: '產業',
    status: 'tracking',
    pred: 'up',
    predReason: '毛利率有望改善',
    source: 'user',
    category: 'catalyst',
    decisionImpact: 'weaken',
    severity: 'medium',
    occurredAt: today,
    relatedCodes: ['6274'],
    summary: 'CCL 報價 Q2 調漲 5-8%，觀察實際反映',
    evidence: '產業調查',
    reviewAt: fiveDaysLater,
  },
]
