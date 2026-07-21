# Suggested Fixes 工作流

在 `/company/holdings-consistency` 加上「產生建議 → 逐筆確認 → 套用寫入」流程，所有資料變更都要管理員明確確認才會執行，並全數寫入 `audit_logs`。

## 資料模型

新增資料表 `public.holdings_fix_proposals`：
- `drift_category`（UNIT_MIX / UNIT_A_NE_B / DRIFT_A_VS_B / HIDDEN_ACTIONS / ORPHAN_PENDING / ORPHAN_TRADE / ORPHAN_SIGNAL）
- `expert_id`, `expert_slug`, `symbol`, `instrument`
- `severity`（high / medium / low）
- `summary`（人類可讀描述）
- `proposed_action`（enum：`normalize_unit` / `adjust_trade_quantity` / `close_trade_record` / `create_trade_record` / `publish_signal` / `cancel_signal` / `manual_review`）
- `payload jsonb`（每種 action 的參數，例如 `{ target_unit: '張', signal_ids: [...] }`）
- `preview jsonb`（before/after 對照，前端渲染用）
- `status`（`pending` / `applied` / `rejected` / `superseded`）
- `generated_by`, `generated_at`
- `reviewed_by`, `reviewed_at`, `review_note`
- `applied_by`, `applied_at`, `apply_result jsonb`
- `signature text unique`（`drift_category|expert_id|symbol|payload_hash`，避免同一輪重複產生）

Grants：`authenticated` SELECT/INSERT/UPDATE、`service_role` ALL。RLS 僅允許 `company_admin` 讀寫。

## RPC（皆 SECURITY DEFINER + `has_role(auth.uid(), 'company_admin')` 檢查）

1. `admin_generate_fix_proposals(p_category text default null)`
   - 呼叫既有 `admin_holdings_consistency_audit()` 抓 drift。
   - 依類別對應 `proposed_action` 與 payload：
     - `UNIT_MIX` / `UNIT_A_NE_B` → `normalize_unit`（以 `trade_records` 最新單位為 canonical，列出要改寫的 signal id）
     - `DRIFT_A_VS_B` → `adjust_trade_quantity`（新舊 quantity）
     - `ORPHAN_PENDING` → `cancel_signal`（>7 天 pending）
     - `ORPHAN_TRADE`（賣光但仍 open）→ `close_trade_record`
     - `ORPHAN_SIGNAL`（賣單但無 trade record）→ `manual_review`
     - `HIDDEN_ACTIONS` → `manual_review`
   - 以 `signature` upsert，重新產生時舊 pending 標成 `superseded`。
   - 回傳新增筆數與 pending 總數。

2. `admin_apply_fix_proposal(p_id uuid, p_confirm boolean)`
   - `p_confirm` 必須為 true，否則直接 raise，防止誤觸。
   - 只處理 `status = 'pending'`。
   - 依 `proposed_action` 執行對應 update：
     - `normalize_unit`：UPDATE `expert_signals` SET `quantity_unit` = target；若 payload 指定 `also_scale`（例如 1 張 = 1000 股）則同步 recompute quantity。
     - `adjust_trade_quantity`：UPDATE `trade_records`。
     - `close_trade_record`：SET status=closed、`closed_at=now()`。
     - `cancel_signal`：SET status='cancelled'。
     - `manual_review`：直接 raise，強迫走人工。
   - 全部在單一 transaction，寫 `apply_result` 與 `applied_by/at`，並透過既有 `audit_row_change` trigger 落入 `audit_logs`。
   - 失敗回滾並將 `apply_result` 記錯誤訊息。

3. `admin_reject_fix_proposal(p_id uuid, p_note text)` — 標記 rejected。

## 前端

在 `src/pages/company/HoldingsConsistency.tsx` 新增第二個 Tab「建議修復」：

- 頂部按鈕：`產生／重新產生建議`（呼叫 `admin_generate_fix_proposals`，顯示 toast 統計）。
- 分頁子 tab：pending / applied / rejected / manual_review。
- 每張卡片顯示：類別 badge、severity、老師/標的、summary、before → after 對照（從 `preview`）。
- 兩顆動作按鈕：`套用修復`、`忽略`。
  - `套用修復` 一律先開 `<AlertDialog>`，顯示「將寫入 X 筆 expert_signals / trade_records」的最終確認，勾選「我已檢查 preview」才 enable 確認按鈕。
  - 確認後帶 `p_confirm=true` 呼叫 RPC。
  - `manual_review` 類別隱藏套用按鈕，只允許忽略或指派人工處理。
- 套用後樂觀更新狀態並顯示 apply_result。

新增 `src/lib/holdingsFixProposals.ts` 集中包裝三支 RPC。

## 安全與稽核

- RPC 全部 SECURITY DEFINER + 角色檢查，`revoke ... from public`。
- `audit_row_change` trigger 已存在，會自動記錄 `expert_signals` / `trade_records` 的變動，含 `changed_by = auth.uid()`。
- `holdings_fix_proposals` 自身也套 `audit_row_change` trigger，追蹤 review／apply 動作。
- 沒有 `p_confirm=true`、非 pending、非 admin 一律 raise，前端無法繞過。

## 技術細節

- Migration：新表 + grants + RLS + policies + 三支 RPC + audit trigger。
- 更新 `src/App.tsx`／`CompanyLayout.tsx`：既有 `/company/holdings-consistency` 頁面內加 tab，不需要新增路由。
- 不動 `admin_holdings_consistency_audit()` 內部邏輯，proposal generator 呼叫它作為單一來源。
- 週記匯出前 `ExportRiskDialog` 未來可再讀取 pending proposals 提示「有 N 筆待處理建議」，本輪不做。
