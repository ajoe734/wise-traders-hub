## 目標
分市場的發布時窗 + 老師「提前開放發布」按鈕。

## 規則（台灣時間 UTC+8）
| 市場 | 撰寫視窗 | 統一發布時刻 |
|---|---|---|
| 台股 (`tw_stock` / `tw_futures`) | 週一 08:00 ~ 週五 20:00 | 週五 20:00 |
| 美股 (`us_stock` / `us_futures` / `crypto`) | 週一 08:00 ~ 週六 08:00 | 週六 08:00 |

- 兩派共用「週一 08:00 前不開放」與「週日全天不開放」規則。
- 判斷依據：`experts.asset_class`（`SignalEditor` 已載入）。無 asset_class 時退回台股規則（現況多數）。

## 提前發布按鈕
- 位置：`/mentor-admin/signals` 頁 header，`+ 發布新週記` 旁新增 `⚡ 提前開放本週發布`。
- 顯示條件：`role='mentor'` 且該老師本週 `pending` 週記 ≥ 1 且尚未到自動發布時刻。
- 點擊：呼叫既有 `publish-weekly-journals` Edge Function，帶 `{ expert_id, force: true }` 只發布該老師本週的 pending。
- 二次確認 Dialog：「本週共 N 筆將立即公開，發布後 24 小時內僅能收回當日訊號」。
- 成功後 toast + 重新載入列表。

## 檔案異動
**Frontend**
- `src/lib/publishingWindow.ts`
  - `isPublishingWindowOpen(assetClass?)` 支援市場參數，回傳市場專屬 reason 文案。
  - 新增 `getNextPublishMoment(assetClass)` 供 UI 顯示（台股：下週五 20:00；美股：下週六 08:00）。
- `src/pages/admin/Signals.tsx`
  - 傳入 `expert.asset_class` 呼叫 window 判斷。
  - subtitle 依市場動態顯示「週五 20:00 統一開放發布」或「週六 08:00 統一開放發布」。
  - 加入「提前開放本週發布」按鈕 + `ConfirmDialog`。
- `src/pages/admin/SignalEditor.tsx`：同步傳 asset_class 給 `isPublishingWindowOpen`。
- `src/pages/_adminSignals/useSignalRowViewModel.ts`：canRecall 邏輯不動。

**Backend**
- `supabase/functions/publish-weekly-journals/index.ts`
  - 支援 `body: { expert_id?, force?: boolean }`，force + expert_id 時只發布該老師 pending 週記、繞過時窗檢查。
  - 保留原本 cron 批次入口（無參數）行為。
- cron 排程：
  - 現有週五 20:00 批次 → 僅處理台股老師。
  - 新增週六 08:00 批次 → 僅處理美股老師（依 `experts.asset_class` 過濾）。
  - 使用 `supabase--insert` 更新 pg_cron。

**測試**
- 更新 `src/test/unit/1.29-publishing-window.test.ts`：新增台股/美股/邊界（週五 19:59、週五 20:00、週六 07:59、週六 08:00、週日）測試共 ~12 case。
- 新增 `src/test/unit/early-publish-eligibility.test.ts`：按鈕顯示條件矩陣。

## 邊界與風險
- **時區**：全部以 Asia/Taipei 判斷；`publishingWindow.ts` 已用 UTC+8 手算，維持相同做法避免 SSR 差異。
- **DST**：台灣無 DST；美股雖有但這裡以「台灣週六 08:00」為錨點，不受美股 DST 影響。
- **force publish 濫用**：Edge Function 限定僅 mentor 本人或 admin；`expert_id` 必須對應呼叫者的 `expert.owner_id` 或 admin role。
- **重複發布**：force 路徑同樣過濾 `status='pending'`，避免重推已發布訊號。
- **cron 併發**：新增週六 job 不會與週五 job 重疊；`processed_webhook_events` 保險 idempotent。
- **UI 誤導**：按鈕在已無 pending 或已過發布時刻時 disable，附 tooltip 說明原因。

## 執行順序
1. `publishingWindow.ts` + 單元測試（純函式，零風險）
2. Edge Function 支援 force 模式 + 權限守門
3. cron 排程更新（週五台股、週六美股）
4. UI：subtitle 文案 + 提前發布按鈕
5. 手動 QA：切換 asset_class 各觀察一輪
