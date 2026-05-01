# Demo 資料維護 SOP

> 目的：訪客模式（`/free-checkup` 未登入）的所有展示內容來自 `src/checkup/data/demoData.js`。為了避免畫面看起來「過期」（例如收盤分析提到上個月才有的事件），需要定期更新本檔。

## 更新頻率

- **每月 1 號**（例行更新）
- **重大事件後**：FOMC、台股重大新聞、財報季中段、產業變動

## 步驟

### 1. 執行提示腳本

```bash
bun scripts/refresh-demo-data.mjs
# 或
node scripts/refresh-demo-data.mjs
```

腳本會印出：
- 當月應使用的 `DEMO_DATA_VERSION`
- `aiInsight` 改寫指引
- 行事曆 / 事件日期換算（已用相對日期，通常無需手改）
- 驗收清單

> 此腳本**不會自動覆寫**檔案，請依輸出手動編輯 `demoData.js`。

### 2. 編輯 `src/checkup/data/demoData.js`

依序更新以下區塊：

| 變數 | 內容 | 重點 |
|------|------|------|
| `DEMO_DATA_VERSION` | `'YYYY-MM'` | 改為當月 |
| `DEMO_ANALYSIS.aiInsight` | 收盤分析 markdown | 提到的股票必須存在於 `INIT_HOLDINGS` |
| `DEMO_CALENDAR` | 行事曆條目 | 至少 3 個 upcoming 事件 |
| `DEMO_EVENTS` | 事件分析 | 至少 1 個 past 命中事件 + 3-4 個 upcoming |
| `DEMO_BRAIN_UPDATED.lessons` | 策略大腦教訓 | 新增當日教訓，刪除超過 3 個月的 |
| `DEMO_BRAIN_UPDATED.lastUpdate` | `'YYYY/MM/DD'` | 今天日期 |

### 3. 驗收

訪客模式（瀏覽器隱身視窗 → `/free-checkup`）必須通過：

- [ ] DemoBanner 顯示，**沒有**「示範資料更新中」
- [ ] 持倉看板顯示完整 20+ 檔
- [ ] 點「收盤分析」按鈕 → 走 4 段模擬載入步驟（4-6 秒）→ 顯示 `aiInsight`
- [ ] **Network tab 完全沒有** `checkup-analyze` / `checkup-calendar` / `checkup-predict-events` 請求
- [ ] 點「上傳截圖」「編輯持倉」「刪除」→ 跳統一登入引導 toast
- [ ] 行事曆顯示至少 3 筆 upcoming 事件
- [ ] 策略大腦顯示更新日期 = 今天

### 4. 常見錯誤

- ❌ `aiInsight` 提到 `INIT_HOLDINGS` 沒有的股票 → 點「個股」會找不到資料
- ❌ 忘記更新 `DEMO_DATA_VERSION` → DemoBanner 會誤顯「示範資料更新中」
- ❌ 把 `DEMO_BRAIN_UPDATED.lessons` 整個清空 → 看起來像剛初始化的空大腦

## 相關檔案

- `src/checkup/data/demoData.js` — 主要資料檔
- `src/checkup/utils/demoSimulate.js` — 模擬載入延遲工具
- `src/checkup/components/DemoBanner.jsx` — 頂部提示條
- `src/pages/FreeCheckup.jsx` — Demo 守門邏輯（搜尋 `if (isDemo)`）
- `scripts/refresh-demo-data.mjs` — 提示腳本
