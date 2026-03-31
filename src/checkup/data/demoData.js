/**
 * Demo data for unauthenticated users viewing the free checkup.
 * Uses the full seed holdings (20+ stocks) instead of a thin 5-item set.
 */

import { INIT_HOLDINGS } from '../seedData.js'

export const DEMO_HOLDINGS = INIT_HOLDINGS

export const DEMO_ANALYSIS = {
  date: new Date().toLocaleDateString('zh-TW'),
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

export const DEMO_EVENTS = [
  {
    id: 'demo-1',
    date: (() => {
      const d = new Date()
      d.setDate(d.getDate() + 3)
      return d.toISOString().slice(0, 10).replace(/-/g, '/')
    })(),
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
    date: (() => {
      const d = new Date()
      d.setDate(d.getDate() + 5)
      return d.toISOString().slice(0, 10).replace(/-/g, '/')
    })(),
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
    date: (() => {
      const d = new Date()
      d.setDate(d.getDate() + 7)
      return d.toISOString().slice(0, 10).replace(/-/g, '/')
    })(),
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
    date: (() => {
      const d = new Date()
      d.setDate(d.getDate() + 14)
      return d.toISOString().slice(0, 10).replace(/-/g, '/')
    })(),
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
    date: (() => {
      const d = new Date()
      d.setDate(d.getDate() + 10)
      return d.toISOString().slice(0, 10).replace(/-/g, '/')
    })(),
    title: '2308 台達電除息',
    detail: '現金股利 $12.5',
    stocks: [{ code: '2308', name: '台達電' }],
    type: '除息',
    status: 'pending',
    pred: 'neutral',
    predReason: '殖利率約 0.9%，預期快速填息',
    source: 'demo',
  },
]
