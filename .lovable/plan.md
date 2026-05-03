# 持股健檢 — Step 1：資料正確性與穩定性（P0）

按上一輪盤點，先把「會壞資料／會耗額度／會掉雲端」的 5 項一次補完。Step 2–4 之後再做。

---

## 1. Quota 預檢守門
**檔案**：`src/checkup/hooks/useTradeCaptureRuntime.js`

- `parseShot` / `parseAllShots` 進入點：先讀 `hasQuota`，無額度直接 `flashSaved('🔒 本期 AI 解析額度已用完，請升級方案後再試', 4000)` 並中止，不進 HEIC 轉檔/壓縮/送 edge。
- `parseUploadById` 內保留 `applyQuotaFromResponse(data)` 寫回最新 quota（已有，保留）。

## 2. 全 AI Edge 的 quota 一致性審查
**檔案**：`supabase/functions/checkup-{analyze,brain,research,predict-events,report,research-extract,parse}/index.ts` 共 7 隻 + `_shared/checkupQuota.ts`（已存在）

逐一確認：
1. 每隻在主邏輯前呼叫 `consumeCheckupQuota(req, 'xxx')`，失敗 → `quotaErrorResponse(...)`。
2. 成功 response 必須帶 `quota: quotaResult.quota`（前端 `applyQuotaFromResponse` 才能同步）。

如有遺漏（特別是 `checkup-research-extract`、`checkup-mops-revenue` 這幾隻可能會 LLM 但沒接），補上。對純資料抓取（無 LLM）的 `checkup-twse / sparkline / institutional / mops-announcements` **不**接 quota。

## 3. tradeLog 刪除回滾的兩個 bug
**檔案**：`src/checkup/lib/tradeLogOps.js`、`src/checkup/components/log/LogPanel.jsx`

### 3a. 賣出回滾的 cost
- 目前刪「賣出」如果該 code 已被全賣（`splice` 過），補回時會用 `trade.price` 當 cost——錯。
- 改為：把 `tradeLog`（同 code、`action='買進'`、`date<=trade.date`）依時間倒序找，**重算加權均價**作為新 cost；找不到才 fallback `price`。
- `reverseTradeOnHoldings` 簽名改為 `(rows, trade, { quotes, tradeLog })`，向後相容（不傳 tradeLog 走舊路徑 + console.warn）。

### 3b. 「中間刪除」用 replay 重算
- 在 LogPanel 刪除路徑改為：
  1. 先把該筆從 tradeLog 移除得 `nextLog`
  2. 從**乾淨 holdings 起點**重放 `nextLog` 重算 holdings
- 新 helper：`replayTradeLog(emptyHoldings, sortedTradeLog, quotes)` → 內部依時間正序套用 buy/sell。
- 確認 confirm modal 文案更新為「系統會用所有交易紀錄重新計算持倉」（不再說近似回滾）。

### 3c. 單元測試
新增 `src/checkup/lib/__tests__/tradeLogOps.test.js`：
- 全賣後刪賣出 → cost 來自買進均價
- 中間插入加碼後刪首筆 → 重放結果與直接套用剩下兩筆一致

## 4. submitMemo 的原子性 + undo 完整快照
**檔案**：`src/checkup/hooks/useTradeCaptureRuntime.js`

- `setHoldings` 包 try/catch；若 throw，**不執行** `setTradeLog`，並 toast `❌ 寫入失敗，未變動`。
- `lastSubmitRef` 同時存 `prevTradeLog`（不只 `prevHoldings`）；`undoLastSubmit` 還原**兩者**完整快照。
- `setTimeout` 釋放 lock 從 800ms → 1500ms（大張 OCR 解析後送出較慢，避免使用者手快重點）。

## 5. syncEngine 失敗重試佇列
**檔案**：`src/checkup/lib/syncEngine.js`

新增「pending queue」：
- localStorage key：`checkup-pending-syncs-v1`，存 `[{ action, data, ts }]`，cap 50 筆。
- `scheduleCloudSave` 失敗時 push 到 queue。
- 新增 `flushPendingSyncs()`：
  - 在 `setContext`（切 portfolio / login）時呼叫
  - 在 `window.addEventListener('online')` 時呼叫
  - 序列重送、成功後從 queue 移除；失敗保留並停止本輪
- `getStatus()` 額外回傳 `pendingQueueSize`，供 UI 之後選擇顯示「N 筆待同步」。

---

## QA（Step 1 收尾）

1. `bunx vitest run src/checkup/lib/__tests__/tradeLogOps.test.js`（新增）
2. `bunx vitest run`（既有測試不可退化）
3. `bunx playwright test e2e/freecheckup-card.spec.ts`（持倉看板視覺）
4. 手動：上傳→刪除→撤回；模擬離線送出後上線觀察 pending queue flush（Console: `syncEngine.getStatus()`）。

---

## 不在 Step 1 範圍

- UI 體感（解析進度、重試按鈕、edit qty/price）→ Step 2
- Demo CTA、log 增強、錯誤碼字典、缺價影子表 → Step 3
- Hook 抽離、RWD 回歸補強、a11y、lightbox、文案 → Step 4

確認後我就進入實作。
