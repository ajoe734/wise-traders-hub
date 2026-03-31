/**
 * Demo data for unauthenticated users viewing the free checkup.
 * All data is static — AI analysis results are pre-generated text.
 */

export const DEMO_HOLDINGS = [
  {
    code: '2330',
    name: '台積電',
    qty: 5,
    price: 1045,
    cost: 980,
    value: 5225,
    pnl: 325,
    pct: 6.63,
    type: '股票',
  },
  {
    code: '2454',
    name: '聯發科',
    qty: 3,
    price: 1820,
    cost: 1750,
    value: 5460,
    pnl: 210,
    pct: 4.0,
    type: '股票',
  },
  {
    code: '2317',
    name: '鴻海',
    qty: 20,
    price: 205,
    cost: 195,
    value: 4100,
    pnl: 200,
    pct: 5.13,
    type: '股票',
  },
  {
    code: '2382',
    name: '廣達',
    qty: 10,
    price: 380,
    cost: 350,
    value: 3800,
    pnl: 300,
    pct: 8.57,
    type: '股票',
  },
  {
    code: '3443',
    name: '創意',
    qty: 2,
    price: 3200,
    cost: 3050,
    value: 6400,
    pnl: 300,
    pct: 4.92,
    type: '股票',
  },
]

export const DEMO_ANALYSIS = {
  date: new Date().toLocaleDateString('zh-TW'),
  summary: `## 📊 今日收盤分析（Demo 模式）

### 大盤概況
加權指數收在 22,850 點，成交量 3,200 億，量能溫和。外資買超 85 億，投信賣超 12 億。

### 持倉檢視

| 標的 | 今日表現 | 觀察重點 |
|------|----------|----------|
| 2330 台積電 | +1.2% | CoWoS 產能持續擴充，法說會展望正面 |
| 2454 聯發科 | +0.8% | 天璣 9400 備貨啟動，Q2 營收可期 |
| 2317 鴻海 | -0.3% | AI 伺服器出貨穩定，等待 GB300 訂單 |
| 2382 廣達 | +2.1% | 雲端伺服器需求強勁，股價創新高 |
| 3443 創意 | +1.5% | ASIC 設計案持續增加，長線看好 |

### 風險提示
⚠️ 持倉集中於 AI/半導體族群，建議適度分散至傳產或金融股。

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

**投資風格辨識**：偏好科技成長股，集中 AI/半導體主題。

**常見模式**：
1. 傾向在法說會前佈局
2. 停損紀律尚可加強
3. 權證操作偏好短線

**建議改善**：
- 設定明確的停損/停利點
- 避免在高點追價
- 增加非 AI 族群的配置

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
    title: '2330 台積電法說會',
    detail: 'Q1 財報公布暨法說會',
    stocks: '2330',
    type: '法說',
    status: 'pending',
    pred: 'up',
    predReason: 'CoWoS 產能滿載，AI 需求強勁，預期展望正面',
    source: 'demo',
  },
  {
    id: 'demo-2',
    date: (() => {
      const d = new Date()
      d.setDate(d.getDate() + 7)
      return d.toISOString().slice(0, 10).replace(/-/g, '/')
    })(),
    title: '2454 聯發科營收公布',
    detail: '3月營收公告',
    stocks: '2454',
    type: '營收',
    status: 'pending',
    pred: 'up',
    predReason: '天璣 9400 拉貨效應，預期月營收年增 15%+',
    source: 'demo',
  },
  {
    id: 'demo-3',
    date: (() => {
      const d = new Date()
      d.setDate(d.getDate() + 14)
      return d.toISOString().slice(0, 10).replace(/-/g, '/')
    })(),
    title: '美國 CPI 數據公布',
    detail: '消費者物價指數',
    stocks: '',
    type: '總經',
    status: 'pending',
    pred: 'neutral',
    predReason: '預期持平，若低於預期有利科技股',
    source: 'demo',
  },
]
