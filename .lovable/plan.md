# 週記撰寫全流程 — E2E 深掃 & Bug 排查計劃

目標：把「後台週記」從老師登入到會員側看到訊號的整條鏈路走一遍，涵蓋 4 種資產類型（tw_stock / us_stock / tw_future / us_future）× 4 種交易動作（買/加/賣/教學）× 邊界情境，把散落各層的 bug 一次抓乾淨。

---

## 範圍（不准偷懶清單）

**前端頁面**
- `src/pages/admin/SignalEditor.tsx`（批次編輯器主頁）
- `src/pages/_signalEditor/*`：`TradeCard.tsx` / `CapitalPanel.tsx` / `HoldingsPanel` / `derive.ts` / `validate.ts`
- `src/pages/admin/StartingCapitalCard.tsx`
- `src/pages/admin/ExportRiskDialog.tsx`
- `src/pages/JournalDetail.tsx`（會員側呈現）
- `src/pages/admin/WeeklyJournalExport.tsx`（Markdown 匯出）

**hooks / lib**
- `src/hooks/admin/useSignalEditorData.ts` / `useAdminProfile.ts`
- `src/lib/asset.ts`（`AssetSpec` / `sanitizeAssetQuantityUnit` / `detectDerivativeFromSymbol`）
- `src/lib/currency.ts`
- `src/lib/openNotificationLink.ts`

**Edge Functions**
- `publish-weekly-journals`
- `update-analyst-credentials`
- `expert-ai-index`（若週記觸發向量化）

**DB triggers / RPCs**
- `handle_signal_trade`（單位換算、市場/幣別派生）
- `enforce_signal_capital_limit`（資金與單位一致性）
- `enforce_unit_consistency`（CASE 常數對齊）
- `get_owned_journal_bundle`（老師預覽）
- `admin_reset_expert_asset_class`

---

## 測試矩陣

| 步驟 | 情境 | 檢查點 |
|---|---|---|
| 1. 登入 | 管理員 / 老師本人 / view-as | AdminLayout 側邊欄可滾、`useEffectiveUserId` 正確 |
| 2. 起始資金 | 無訊號 / 已發布訊號 | `StartingCapitalCard` 鎖定條件 |
| 3. 建立草稿 | 4 種資產 × 買/加/賣/教學 | 單位預設、幣別、標的 placeholder 由 `asset_class` 派生 |
| 4. 草稿殘留 | 舊「張」殘留在 us_stock | `sanitizeAssetQuantityUnit` 自動修正 |
| 5. 持倉帶入 | 從 `trade_records` import | 單位不被還原成「張」 |
| 6. 批次驗證 | 單位不符 / 賣超 / 資金不足 / 方向不符 | `validateSignalBatch` 中文錯誤、`ExportRiskDialog` 阻擋 |
| 7. 發布 | 部分成功 / 全失敗 / 空 batch | `publish-weekly-journals` per-signal 錯誤 → 通知含修正連結 |
| 8. Trigger 硬擋 | 直插非法單位 | `enforce_signal_capital_limit` 擋下 |
| 9. 通知點擊 | 內部相對路徑 / 外部下載 | 不再 404、analytics 事件記錄 |
| 10. 老師預覽 | 訂閱者視角 | `get_owned_journal_bundle` RPC 繞過 RLS |
| 11. 會員側呈現 | 教學 signal、learning_points、currency fallback | `JournalDetail` 不查 `expert_signals.currency` |
| 12. Markdown 匯出 | 多老師 / 空老師 / 單位混雜 | JSZip 分檔、風險預警阻擋 |
| 13. 週記匯出前風險 | UNIT_MIX / DIRECTION_OVERSELL | `ExportRiskDialog` 顯示 |
| 14. 邊界值 | 目標價 0、股數 0、超大 quantity、負數 | 顯示與儲存都不變 null／空白 |
| 15. RWD | 編輯器 & JournalDetail 手機斷點（560 / 390 / 380） | 無溢出、字級 ≤ 22px |

---

## 執行方式

**A. 靜態掃描（無寫入）**
1. `rg` 找出所有直接讀 `expert_signals.currency` / 硬編「張」/ 未經 `AssetSpec` 的單位常數。
2. `supabase--read_query` 檢查目前 experts、近 30 天 signals 是否有跨資產類單位漂移殘留。
3. `supabase--linter` 跑一次找 RLS / SECURITY DEFINER / grants 漏洞。
4. 讀 `supabase/config.toml` 確認排程未壞。

**B. Playwright E2E（新增 spec）**
- `e2e/journal-authoring-full-flow.spec.ts`：以測試專家（4 asset_class × USD/TWD）走 3→7→11 的全鏈路，含 view-as 覆蓋。
- `e2e/journal-authoring-boundary.spec.ts`：目標價 0、股數 0、賣超、單位混雜、資金爆表。
- `e2e/journal-authoring-mobile.spec.ts`：560/390/380 斷點視覺回歸。
- 重用既有 `e2e/helpers/drawer-overflow-annotate.ts` 產出失敗註記。

**C. Integration（Vitest）**
- 擴充 `src/test/integration/1.37-us-asset-unit-single-source.test.ts` → 增加 tw_future / tw_stock「口 vs 張」交叉。
- 新增 `src/test/integration/journal-publish-partial-failure.test.ts`：mock edge function，驗證通知 payload。

**D. Edge Function 測試**
- `supabase--test_edge_functions` 對 `publish-weekly-journals` 跑：全成功、部分失敗、單位漂移、資金爆、無 batch。
- 檢視 `edge_function_logs` 找過去 24h 內任何 500 / 400 / trigger 例外。

**E. DB 深掃**
- `read_query` 掃：
  - 有 `quantity_unit` 與 `asset_class` 不符的舊資料筆數
  - `expert_signals.currency` 為 NULL 但仍被查詢的路徑
  - `notifications.link` 中殘留絕對 `signed_url` 內部連結
  - `expert_slug` 未同步的 profiles

---

## 交付物

1. **Bug 清單**（依嚴重度分級 P0/P1/P2）：檔案:行 + 觸發條件 + 建議修法。
2. **新增測試檔**：上述 A/B/C/D/E 產出的 spec 與 vitest 檔。
3. **DB 清整 SQL**：若掃到殘留漂移資料，附冪等 migration。
4. **回歸 checklist**：合併到 `mem://qa/journal/full-authoring-checklist`（新記憶）。

---

## 明確不做（避免範圍蔓延）

- 不改 UI 視覺設計（除非發現溢出等 P0 bug）。
- 不新增功能欄位。
- 不動 `src/integrations/supabase/client.ts` / auto-gen 檔。

批准後我會依序：先跑 A/E 靜態＋DB 深掃 → 列出 P0 → 補 B/C/D 測試 → 修 bug → 全量回歸。
