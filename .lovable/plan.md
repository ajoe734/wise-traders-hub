# 持倉看板四階段壓測 + 50 檔上限 + 優化建議清單

## 範圍與前提
- 目標：對 `/free-checkup` 持倉看板的「所有功能與聯動」進行四階段測試，並產出**優化建議清單**（不直接改業務邏輯）。
- 壓測規模：最多 **50 檔**持倉（依使用者指示）。
- AI 並發：**不限縮**配額，實打 `checkup-analyze / parse / predict-events / calendar`，順便驗證知識庫品質與 fallback。
- 資料隔離：壓測注入只寫入 `localStorage`（demo 模式），絕不污染雲端 `checkup_storage`（依 `mem://infrastructure/checkup/sync-isolation-logic`）。

---

## 階段 1：靜態程式碼與資料聯動審計（不跑瀏覽器）

對 `src/pages/FreeCheckup.jsx`(5,111 行) 與相關 hook 進行靜態審計：

1. **持倉資料流**：`setHoldings → upsertSnapshotHolding / mergeTradeIntoHoldings → 報價拉取 → totalPnl/totalValue 計算 → Hero/卡片渲染 → 行事曆 / 事件 / 大腦聯動**整條鏈路。
2. **聯動鉤子**：
   - `holdingsChangedByUserRef` 觸發行事曆重抓（line 1040）
   - `incrementUploadCount` 與 `hasReachedDailyLimit` 一致性
   - `RETRY_MAX / RETRY_COOLDOWN` 重試門檻與冷卻邏輯
   - 雙寫 `pf-holdings-v2` localStorage ↔ `checkup_storage` upsert
3. **Race condition 與 stale closure**：`useEffect` 依賴遺漏、`fetch` 競態、未取消的 in-flight request。
4. **`bun run check:freecheckup-rwd`** + `tsc --noEmit` 跑一次。

**產出**：審計報告（檔案 / 行號 / 風險 / 嚴重度 / 建議修法），存於 `/mnt/documents/portfolio-audit-phase1.md`。

---

## 階段 2：注入 50 檔測試資料 + 加入上限保護

### 2A. 程式變更（最小侵入）
- 在 `src/pages/FreeCheckup.jsx` 加入常數 `MAX_HOLDINGS = 50`。
- **上傳成交截圖時**：解析後若 `holdings.length + 新增筆數 > 50`，直接擋下並顯示 toast：
  > 「持倉最多 50 檔，目前已有 X 檔，請先整理或減少匯入筆數」
- **上傳區 UI** 標示：在「上傳已成交截圖」副標下加一行小字「持倉上限 50 檔」。
- **持倉看板 Hero 副標**：顯示 `X / 50` 持倉數，超過 45 檔時轉橘色提示。
- 同步在 `mergeTradeIntoHoldings / upsertSnapshotHolding` 上游做防呆。

### 2B. 注入腳本
- 建立 `/tmp/seed-50-holdings.js`，產生 50 檔 TWSE 真實代號 + 隨機成本/張數，灌進 `localStorage['pf-holdings-v2']`，含混合 PnL 分布（30 賺 / 15 賠 / 5 持平）與少量缺價標的。

---

## 階段 3：互動 / 壓力測試（瀏覽器）

依序在 1024 / 768 / 414 / 390 / 380 / 320 viewport 操作：

1. **載入壓測**：50 檔同時渲染，量測 FCP / TTI、`browser--performance_profile` 抓 JS heap、DOM nodes、layout count。
2. **報價刷新**：手動觸發報價更新 3 次，觀察 Hero 數字 / 卡片是否抖動、是否有 N+1 fetch。
3. **AI 並發實打**（不限額）：
   - 收盤分析（`checkup-analyze`）
   - 事件預測（`checkup-predict-events`）
   - 行事曆（`checkup-calendar`）
   - 同時觸發，觀察 UI 是否封鎖、token 是否爆、429/503 是否有友善 fallback。
4. **聯動測試**：刪除 / 新增 / 修改持倉 → 行事曆是否重抓、事件 tab 是否更新、知識庫快取是否命中。
5. **錯誤注入**：模擬 `current_prices` 缺失、AI 回傳空字串、JSON parse 失敗 → 觀察 toast 與 retry 行為。
6. **RWD 同步**：跑 `e2e/freecheckup-card.spec.ts` 全套（依 mem 強制 SOP）。

每個情境截圖存 `/tmp/`，僅最終問題截圖留存報告引用。

---

## 階段 4：知識庫品質驗證 + 優化建議交付

1. **知識庫命中率**：撈取本輪 AI 並發測試的 prompt 片段，比對 `checkup_knowledge_items` 是否有對應條目被注入；輸出命中 / 未命中清單。
2. **AI 回應品質抽樣**：50 檔中抽 5 檔（含半導體 / 金融 / ETF / 小型股 / 缺價標的），檢視收盤分析是否言之有物、是否被知識庫拉偏 / 拉正。
3. **優化建議清單**（最終交付物，存 `/mnt/documents/portfolio-optimization-report.md`）：
   - 🐛 Bug（檔案+行號+重現步驟+建議修法）
   - 📱 RWD / 視覺（斷點+截圖+修法）
   - ⚡ 效能（heap / render / fetch 量化數據+優化方向）
   - 🧠 知識庫質量（命中率 / 缺漏主題 / 建議新增條目）
   - 🏗️ 架構（race / stale closure / 雙寫一致性建議）
   - ✅ 已驗證 OK 的功能清單（讓你知道哪些不用動）

---

## 不會做的事
- 不直接修業務邏輯（除了 `MAX_HOLDINGS = 50` 防呆與 UI 標示）。
- 不刪 / 不改你的雲端真實持倉（demo 隔離保護）。
- 不修改 `mem://` 持倉憲法（橘色 PnL、Kore-eda 美學）。

## 完成標準
- 四階段全跑完，產出兩份 `.md` 報告 + 50 檔上限程式碼變更 + 上傳 UI 標示。
- 報告以「檔案+行號+建議片段」形式呈現，可直接餵下一輪改版。
