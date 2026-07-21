## 目標
後台新增一個「Signal 重複持倉稽核」頁面，掃描所有 `trade_records`，找出同一 `signal_id` 對應 >1 筆開倉紀錄（`exit_date IS NULL`）的個案，列出清單並提供一鍵修復。

背景：先前 `handle_signal_trade()` bug 已造成正二等個股出現重複行；雖然已加了 `trade_records_signal_id_open_uniq` partial unique index 擋新資料，但需要一個持續監控頁面確認 unclosed 情況、以及處理 index 建立前殘留或 exit_date 已填不同值的邊界。

## 變更清單

### 1. 後端 RPC（migration）
- `admin_signal_dupe_trades_audit()`：`SECURITY DEFINER`，僅 `company_admin` 可執行。回傳每個有重複的 signal 一筆彙總：
  - `signal_id`, `expert_id`, `expert_display_name`, `instrument`, `symbol`, `action`, `signal_published_at`
  - `dup_count`（該 signal 對應 trade_records 筆數）
  - `open_count`（其中 exit_date IS NULL 的筆數）
  - `trade_ids uuid[]`（依 `created_at` 由舊到新）
  - `has_manual_edit boolean`（任一筆 `updated_at > created_at + interval '5 seconds'` 視為老師有動過）
- `admin_signal_dupe_trades_fix(p_signal_id uuid, p_dry_run boolean default true)`：
  - 保留最舊那筆（`created_at ASC LIMIT 1`）；其他刪除。
  - `has_manual_edit=true` 時，`p_dry_run=false` 仍要求呼叫端 `p_force := true` 才會執行（多一個 `p_force boolean default false` 參數），避免誤刪老師手動改過的紀錄。
  - 回傳 `{ kept_id, removed_ids, would_remove_count, executed boolean }`。
  - 所有刪除寫入 `audit_logs`（action=`signal_dupe_trade_fix`）。

### 2. 前端 `src/pages/company/SignalDupeAudit.tsx`
- ProtectedRoute + `company_admin`。
- 上方：總覽數字（受影響 signal 數 / 重複 trade 總數 / 其中有手動編輯者數）、「重新掃描」按鈕。
- 表格欄位：老師、代碼/標的、action、發佈時間、重複數 / 開倉數、trade_ids（可展開）、狀態（clean / 手動編輯過）、操作。
- 每列「試算修復」（dry run 顯示會刪哪幾筆）與「執行修復」二段式；有手動編輯時執行按鈕須額外勾選「確認強制刪除」。
- 全部修復按鈕：僅對「無手動編輯」批次執行，逐一呼叫 RPC。
- 空狀態：「目前沒有重複的 signal_id」。

### 3. 路由掛載
- `src/App.tsx`：新增 lazy import + `/company/signal-dupe-audit` route。
- 側邊欄（若 `HoldingsConsistency` 有註冊在 layout 選單）同步加入連結，命名「重複持倉稽核」。

## 不做的事
- 不重複實作已有的 `HoldingsConsistency` 五類 drift 檢查——此頁面專攻 `signal_id → trade_records` 一對多。
- 不建 cron，觸發時機由管理員按「重新掃描」；未來要自動化再談。
- 不動 `handle_signal_trade()` 或 partial unique index（已在前次修復處理）。

## 驗證
1. 呼叫 RPC 應回傳 0 列（先前已清乾淨）。
2. 手動 INSERT 一筆重複 trade → 掃描頁應立刻列出、dry-run 顯示會刪 1 筆、執行後回到乾淨狀態、`audit_logs` 有一筆 `signal_dupe_trade_fix`。
3. 有手動編輯的 signal，未勾強制不能執行，勾了才能。
