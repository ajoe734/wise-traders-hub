## 目標

1. 訪客（DEMO 模式）看起來「像真的在跑」：**收盤分析、事件預測、行事曆、策略大腦** 一律從 `demoData.js` 讀取，配 1.5–3 秒模擬載入動畫。
2. 每個 AI / 鎖定功能都有清楚的「DEMO」標示與「登入解鎖」CTA。
3. 寫一份維護腳本與 SOP，讓 `demoData.js` 每月（或重大事件後）能快速更新，避免畫面過期。

---

## 一、Demo 守門盤點與處理

`FreeCheckup.jsx` 共 8 處 `callEdge`，依「公開資料 / AI 私有」分類：

| # | callEdge | 性質 | Demo 行為 |
|---|----------|------|----------|
| 1 | `checkup-twse` (持倉刷新) | 公開股價 | **保留即時呼叫**（demo 持倉是真實代號，價格即時看起來才真） |
| 2 | `checkup-twse` (收盤分析內) | 公開股價 | **跳過**，因整段 daily 分析改吃 demoData |
| 3 | `checkup-sparkline` | 公開走勢 | **保留即時呼叫** |
| 4 | `checkup-calendar` | AI/外部 | **攔截** → 直接 `setNewsEvents(DEMO_EVENTS)` |
| 5 | `checkup-predict-events` | AI | **攔截** → 從 `DEMO_EVENTS` 取 `prediction` 欄位填入 |
| 6 | `checkup-analyze` (daily) | AI | **攔截** → 套 `DEMO_ANALYSIS` |
| 7 | `checkup-analyze` (brain-update) | AI | **攔截** → 套 `DEMO_BRAIN` |
| 8 | `checkup-parse` (OCR) | AI | 已守門（`startLineLogin()`）→ 文案改更明顯 |

實作方式：在每個攔截點最前面加 `if (isDemo) { ...mock流程; return; }`。

---

## 二、模擬 AI 延遲（讓 Demo「像真的在算」）

新增 `src/checkup/utils/demoSimulate.js`：

```js
export const demoDelay = (min = 1500, max = 3000) =>
  new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

export async function simulateSteps(steps, setStep) {
  for (const s of steps) {
    setStep(s.label);
    await demoDelay(s.min, s.max);
  }
}
```

各模擬流程的步驟文案（沿用既有 `setAnalyzeStep` / `setParseStep` UI）：

- **收盤分析**：`取得即時股價...` → `分析持倉表現...` → `比對事件邏輯...` → `策略大腦進化中...`（共約 4–6 秒，最後寫入 `DEMO_ANALYSIS` + `DEMO_BRAIN`）
- **事件預測**：`AI 預測事件影響中...`（單步 2–3 秒）
- **行事曆抓取**：`掃描未來重大事件...` → `比對持股相關性...`（共 2–3 秒）

每段結束後**強制扣不到雲端額度**（直接從本地 demoData 寫回 state）。

---

## 三、登入解鎖 UI

1. **頂部 Demo Banner**（`isDemo === true` 才顯示，sticky 在 `<main>` 上方）：
   - 文案：「目前是 DEMO 模式：所有資料為示範用途，登入後可使用你的真實持倉、AI 分析與策略大腦」
   - 右側按鈕：「LINE 登入解鎖」→ `startLineLogin()`、「Email 登入」→ `/auth/login?redirect=/checkup`
   - 顏色：遵守「Kore-eda」極簡風（`alpha(C.text, '06')` 底、無陰影）。

2. **每個鎖定動作**統一改用 `showDemoLockToast(featureName)`：
   - 觸發點：手動編輯持倉、上傳截圖、收盤分析按鈕、手動更新股價、刪除/新增持股、編輯交易日誌
   - 文案模板：「這是 DEMO 範例。登入後即可 {featureName}」+ CTA 按鈕
   - 改用既有 `setSaved` toast 顯示，避免新增 UI 元件。

3. **既有不明顯的「DEMO」字樣**（line 2819, 10px）：
   - 替換為角落浮水印「DEMO 範例資料」14px，`color: alpha(C.text, '40')`，避免與正式內容混淆。

4. **每個分析卡片右上角**加小標籤「示範」（收盤分析卡、策略大腦卡、事件卡、行事曆卡），點擊 → 帶出登入 toast。

---

## 四、demoData 月更維護機制

1. **新增腳本** `scripts/refresh-demo-data.mjs`（手動或月排程）：
   - 連線到正式環境一個指定 demo 帳號（或直接打 `checkup-twse` + `checkup-calendar` + `checkup-analyze` 拿即時資料）
   - 產出新的 `DEMO_ANALYSIS.date / summary / aiInsight`、`DEMO_EVENTS`（保留 1 個 past 命中、3–4 個 upcoming）、`DEMO_BRAIN.lastUpdate / lessons`
   - 寫回 `src/checkup/data/demoData.js`（保留檔頭註解 + `// AUTO-UPDATED: YYYY/MM/DD`）

2. **新增 SOP 文件** `docs/demo-data-maintenance.md`：
   - 何時更新：每月 1 號、或大事件（FOMC、財報季、台股重大新聞）後
   - 怎麼更新：`bun scripts/refresh-demo-data.mjs` → 人工檢查 diff → 提交
   - 驗收清單：日期是當月、`DEMO_EVENTS` 至少 1 past + 3 upcoming、`DEMO_ANALYSIS.aiInsight` 提到的股票全部存在於 `DEMO_HOLDINGS`

3. **保險絲**：在 `demoData.js` 加 `DEMO_DATA_VERSION = 'YYYY-MM'`；若 `Date.now()` 與版本相差 > 60 天，Demo Banner 額外顯示「示範資料更新中」小字（不影響功能，只提醒維護者）。

---

## 五、技術細節

- **檔案改動**
  - `src/pages/FreeCheckup.jsx`：8 個 callEdge 點加守門 + 模擬延遲（重點區段：860, 1294, 1456, 1795, 1910, 2045, 2173, 2505 附近的 try 區塊最前面）
  - `src/checkup/utils/demoSimulate.js`（新增）
  - `src/checkup/data/demoData.js`：補 `prediction` 欄位、加 `DEMO_DATA_VERSION`
  - `src/checkup/components/DemoBanner.jsx`（新增，sticky banner）
  - `scripts/refresh-demo-data.mjs`（新增，腳本）
  - `docs/demo-data-maintenance.md`（新增，SOP）
  - `mem://qa/checkup/demo-mode-behavior`（新增記憶條）

- **不改動**
  - `useCheckupMode` / `auth` 流程
  - 任何 edge function（守門純前端）
  - 已正確守門的 `parseShot`（line 2479）只調文案，不改邏輯
  - `pf-storage-owner-v1 = "demo"` 的隔離機制
  - 即時股價（`checkup-twse` 持倉刷新與 sparkline）保留，避免畫面靜止

- **驗收**
  - 未登入進 `/free-checkup`：banner、所有卡片有「示範」標、無任何 401 / AI 相關 callEdge 出現在 Network
  - 點「收盤分析」按鈕 → 走 4 段模擬步驟 → 顯示 `DEMO_ANALYSIS`，全程不打 `checkup-analyze`
  - 點「上傳截圖」「編輯持倉」「刪除」→ 都跳統一 toast + 登入 CTA
  - `bun scripts/refresh-demo-data.mjs --dry-run` 能輸出 diff 預覽

---

## 執行步驟（建議切兩個 PR）

1. **PR-1：守門 + 模擬延遲 + Demo Banner / Toast**（佔 80% 體感改善）
2. **PR-2：refresh-demo-data 腳本 + SOP 文件 + DEMO_DATA_VERSION**（維護工具）

是否照這個計畫進行？確認後切回 default 模式開工。
