# 計畫：trade_records 重複防護自動化測試

## 目標
自動驗證：不論 `expert_signals` 被重送、trigger 被重複觸發、或第三方直接插 `trade_records`，同一 `signal_id` 的 open 交易列都只會保留 1 筆。

## 測試檔案
新增 `supabase/tests/trade_records_dedupe_test.sql`（pgTAP 風格純 SQL 腳本，可用 `psql -f` 直接跑，也可掛到 CI）。選 SQL 而非 Playwright 是因為要驗證的是資料庫層的 trigger + unique index + `handle_signal_trade` 邏輯，走 E2E 反而繞遠且慢。

## 涵蓋案例（每個 case 起 SAVEPOINT，跑完 ROLLBACK，不污染資料）

1. **Case A｜trigger 首次插入**
   - `INSERT INTO expert_signals(...)` 一筆買進訊號
   - Assert：`trade_records WHERE signal_id=X AND exit_date IS NULL` count = 1

2. **Case B｜同 signal 重送（UPDATE 觸發 trigger 二次）**
   - 對同一 signal 觸發會呼叫 `handle_signal_trade` 的更新
   - Assert：仍只有 1 筆 open trade_record（驗證上輪加入的存在性檢查有效）

3. **Case C｜直接 INSERT 重複 trade_records 應被 unique index 擋下**
   - 手動 `INSERT INTO trade_records(signal_id=X, exit_date=NULL, ...)` 第二筆
   - Assert：拋出 `unique_violation` (`trade_records_signal_id_open_uniq`)

4. **Case D｜關閉後可再開新倉**
   - 將第一筆 `exit_date` 設為過去日期
   - 再插入新的 open trade_record（signal_id 相同）
   - Assert：允許成功（unique index 只鎖 open 狀態）

5. **Case E｜`admin_signal_dupe_trades_fix` 冪等性**
   - 人為關掉 trigger、硬塞兩筆 open（bypass unique index：暫時 DROP INDEX → INSERT → 重建）以模擬歷史髒資料
   - 呼叫 `admin_signal_dupe_trades_fix(signal_id, p_dry_run:=false, p_force:=false)`
   - Assert：剩 1 筆（保留最舊 `created_at`）、`audit_logs` 有一筆 `action='signal_dupe_trade_fix'`
   - 再呼叫一次 → Assert：0 影響（冪等）

## 執行方式
- 本機/CI：`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/trade_records_dedupe_test.sql`
- 腳本開頭 `BEGIN;`、結尾 `ROLLBACK;`，測試中每個 case 用 SAVEPOINT/ROLLBACK TO 隔離
- 失敗即以 `RAISE EXCEPTION` 中斷並列印 case 名稱

## 技術細節
- 用 `gen_random_uuid()` 建立臨時 expert / profile 假資料（或選現有測試 expert，避免 FK 卡住）
- 需要 service_role 權限來繞過 RLS 直接讀 `trade_records`
- 斷言統一透過 `DO $$ BEGIN IF ... THEN RAISE EXCEPTION 'CASE X FAILED: ...'; END IF; END $$;`

## 交付
- `supabase/tests/trade_records_dedupe_test.sql`（新檔）
- `README` 或註解說明如何在本機執行

不動任何應用程式碼、不改 schema，只新增測試檔。
