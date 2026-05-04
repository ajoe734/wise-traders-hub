# 配額計算重新設計

## 目標規則（單一真相）

| 使用者動作 | Edge Function | kind | 扣點 |
|---|---|---|---|
| 上傳成交截圖（每張） | `checkup-parse` | `parse` | **+1** |
| 收盤分析（按一次按鈕） | `checkup-analyze` | `daily-analysis` | **+1** |
| 事件分析（按一次按鈕） | `checkup-predict-events` | `predict-events` | **+1** |
| 策略大腦進化（內部 follow-up） | `checkup-analyze` (`kind:'brain-update'`) | — | **0** |
| 研究室深度研究 | `checkup-research` | `deep-research` | **+1**（維持現狀）|
| 研究室系統審查 | `checkup-research` | `system-review` | **+1**（維持現狀）|
| 研究室資料抽取 | `checkup-research-extract` | `research-extract` | **+1**（維持現狀）|

> 同一個按鈕點兩次就扣兩次；批次解析多張截圖視為「多次動作」。

---

## 後端調整

### 1. `supabase/functions/checkup-analyze/index.ts`
- 已有 `isBrainUpdate` 分支但 kind 仍叫 `'analysis'`。改為：
  - 主分析使用 `consumeCheckupQuota(req, 'daily-analysis')`，取代現行的 `'analysis'`，使資料庫 `checkup_usage.kind` 與前端規格對齊。
  - `brain-update` 維持現有「驗 JWT、不扣配額、防濫用 10 分鐘窗」邏輯（已正確，無需動）。
- 確保 response payload 一律包含 `quota: quotaSnapshot`（已 OK）。

### 2. `supabase/functions/checkup-predict-events/index.ts`
- 維持 `consumeCheckupQuota(req, 'predict-events')`，response 已含 `quota`（line 537）。**無變更**。

### 3. `supabase/functions/checkup-parse/index.ts`
- 維持 `consumeCheckupQuota(req, 'parse')`，response 已含 `quota`。**無變更**。

### 4. 研究室三支 (`checkup-research`, `checkup-research-extract`)
- 維持現狀：`deep-research` / `system-review` / `research-extract` 各扣 1（依使用者上輪未明確選 A/B/C 之前）。
- 若稍後決定改 B（免費），只需把 3 個 `consumeCheckupQuota` 呼叫拿掉。

### 5. `_shared/checkupQuota.ts`
- 不變；保留 `kind` 為純標籤用途（之後可在 admin overview 依 kind 分群）。

---

## 前端調整 — `src/pages/FreeCheckup.jsx`

### A. 移除誤導的本地 increment
- **Line 2381**：刪除 `incrementUploadCount(); // 計入今日 AI 配額`  
  → 收盤分析已由 `checkup-analyze` 後端原子扣點，前端再 increment 是雙重計算的錯覺（雖然 `incrementUploadCount` 現在實作其實是 `refreshQuota()`，但語意混淆）。
- **Line 2821**：刪除 `incrementUploadCount(); // 記錄今日上傳次數`  
  → 上傳成交的扣點已由 `checkup-parse` 完成，前端不再呼叫。

### B. 統一改用 response-driven 同步
所有 3 個入口的 `callEdge` 結果回來後立即呼叫：
```js
if (data?.quota) applyQuotaFromResponse(data);
```
- Line 2751 已正確（parse 入口）。
- 在 line ~1455 (`predict-events` 成功回來後) 補一行同步。
- 在 line ~2378 (`checkup-analyze` 成功回來後) 補一行同步，取代被刪除的 `incrementUploadCount()`。

### C. `CheckupModeContext.jsx`
- `incrementUploadCount` 標記為 deprecated（保留為 no-op 包裝 `refreshQuota`，避免外部呼叫者炸掉），並在 JSDoc 註明「請改用 `applyQuotaFromResponse(data)`」。
- 移除 hook destructure 中對 `incrementUploadCount` 的依賴（line 441）。

---

## 驗證

1. **Edge function 測試**：
   - 對 `checkup-analyze` 連續呼叫 2 次（一次主分析、一次 brain-update），確認 `checkup_usage` 只新增 1 列且 `kind='daily-analysis'`。
   - 對 `checkup-predict-events` 點 2 次 → `checkup_usage` 新增 2 列 `kind='predict-events'`。
   - 對 `checkup-parse` 上傳 3 張 → 新增 3 列 `kind='parse'`。
2. **前端**：
   - `bunx vitest run src/test/unit/freecheckup-i18n.test.ts src/test/unit/freecheckup-mobile-card-overflow.test.ts`（必跑回歸）。
   - 手動 QA：免費版（quota=1）依序試 3 個入口，每按一次右上角配額即時 -1。
3. **配額耗盡**：第 2 次點同一動作要拿 429 + `QUOTA_EXCEEDED` 並彈出升級窗。

---

## 待你決定

研究室 3 支 (`deep-research` / `system-review` / `research-extract`) 在這次重構保持「各扣 1」(預設 A)。如果你要改 B（全部免費）或 C（先不動，獨立議題）請回我，我會在實作時一併處理。
