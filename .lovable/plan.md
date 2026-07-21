## 目標

`trade_records` 與 `expert_signals` 的每次 INSERT / UPDATE / DELETE 都自動寫入 `audit_logs`，可在 `/company/audit-logs` 追誰、何時、改了什麼；不依賴呼叫端（前台元件、Edge Function、匯入腳本、管理員手動操作）自行 log。

## 方案

DB trigger 一次到位，捕捉「所有寫入路徑」。無論走 RLS、service_role、Edge Function、SQL 手動修，皆會被記錄，符合「不准偷懶、窮舉範圍」。

### 1. Migration：稽核觸發器

- 新增 `SECURITY DEFINER` 函式 `public.audit_row_change()`（`SET search_path = public`），bypass `audit_logs` RLS，寫入欄位如下：
  - `actor_id`：`auth.uid()`，若無（service_role/cron）則 `NULL`。
  - `action`：`{table}.{TG_OP}`，例如 `trade_records.DELETE`、`expert_signals.UPDATE`。
  - `target_type`：TG_TABLE_NAME。
  - `target_id`：`COALESCE(NEW.id, OLD.id)`。
  - `detail` JSON：
    - `op`, `table`, `via`（`auth.role()`：`authenticated`/`service_role`/`anon`）
    - `expert_id`（若欄位存在）
    - INSERT：`after = row_to_json(NEW)`
    - DELETE：`before = row_to_json(OLD)`
    - UPDATE：`before`, `after`, `changed` = 兩者 diff 過的欄位陣列（跳過 `updated_at`）
- 三個 trigger（AFTER INSERT / UPDATE / DELETE FOR EACH ROW）掛到 `public.trade_records` 與 `public.expert_signals`，共 6 個 trigger。
- 追加 RLS policy 「service role can insert audit logs」給 `service_role`，避免將來 non-SECURITY-DEFINER 寫入路徑受阻（現行 policy 只允許 company_admin）。
- 保守：不對 `audit_logs` 加額外 index（已足夠；未來如果查詢慢再補 `(target_type, created_at desc)`）。

### 2. UI：`/company/audit-logs` 過濾器擴充

- `TARGET_LINK` 已含 `expert_signals`，補上 `trade_records` → `/company/analysts`（暫連分析師列表）。
- `describe()` 增加對新 action 的說明：
  - `trade_records.INSERT/UPDATE/DELETE` → 顯示 `detail.after.symbol`、`action`、`quantity`、`quantity_unit`、`via`。
  - `expert_signals.INSERT/UPDATE/DELETE` → 顯示 `instrument`、`action`、`status`、`via`。
  - UPDATE 附加 `changed=[...]` 摘要。
- `formatActionLabel` / `formatTargetType`（`src/lib/auditLog.ts`）補繁中對應：
  - `trade_records.INSERT` = 「新增交易紀錄」等 9 種。
  - target `trade_records` = 「交易紀錄」。
- 過濾下拉：`target_type` 選單加入 `trade_records`、`expert_signals`（若目前是靜態清單）。

### 3. 驗證（一次跑完，不挑樣本）

- Migration 完成後：
  - `SELECT tgname FROM pg_trigger WHERE tgrelid IN ('trade_records'::regclass, 'expert_signals'::regclass)` 確認 6 個 trigger 存在。
  - 用 `insert` 工具在測試 expert 上跑 INSERT/UPDATE/DELETE 各一筆 trade_records + expert_signals，`SELECT * FROM audit_logs WHERE target_type IN (...) ORDER BY created_at DESC LIMIT 12` 驗證：actor_id、via、changed 都正確；DELETE 有 before snapshot。
- 前端：`bunx tsgo --noEmit`；`/company/audit-logs` 手動確認新條目可篩選、描述顯示正確。

## 技術細節

- **不用 CHECK constraint**：符合規範，全部走 trigger。
- **PII / 大小**：`trade_records`、`expert_signals` 每列都非 blob，`row_to_json` 大小可接受；UPDATE 的 `changed` 陣列用 `SELECT array_agg(key) FROM jsonb_each(before) b JOIN jsonb_each(after) a USING(key) WHERE b.value IS DISTINCT FROM a.value` 排除 `updated_at`。
- **RLS**：SECURITY DEFINER 直接 INSERT 進 `audit_logs`，不受 policy 限制；因此觸發器對任何角色都會寫入成功（包含前台會員發訊號、mentor 自寫 trade、service_role cron）。
- **不改業務邏輯**：只加觀測，觸發器 AFTER，不會擋主表寫入；即使 audit 寫失敗也不 rollback（函式內用 `BEGIN ... EXCEPTION WHEN OTHERS THEN ... END` 吞例外 + `RAISE WARNING`，避免業務被稽核拖累）。
- **保留期**：`audit_logs` 目前無自動 purge；本次不動，之後若量太大再另加 cron。

## 交付檔案

- Migration（新）：建立函式 + 6 triggers + policy。
- `src/lib/auditLog.ts`：擴充 action / target 中文對照。
- `src/pages/company/AuditLogs.tsx`：`TARGET_LINK`、`describe()`、過濾選單。
