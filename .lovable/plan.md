## 目標

把「062787 貿聯群益5A購02：signal 20 張 vs trade 50029 股，行使比例 ≠ 1000，需人工核對」這條殘留，改成**外部資料自動對帳**。責任不推給人工。

## 現況根因（已驗證）

- `checkup-warrant-sync` 目前只抓 `symbol / name / parent_code / expire_date`，**沒抓「行使比例」**，所以下游沒有權威來源可驗算「N 張 = M 股」。
- `warrant_expiry` 表沒有 `exercise_ratio` 欄位。
- `handle_signal_trade` trigger 對權證仍套用「1 張 = 1000 股」預設，遇到非 1000 行使比例（如 062787 = 2500 或 1250 等）就會出現 signal 20 張 → trade 50029 股這種偏差。
- 目前處理方式是「標記待人工覆核」——這就是偷懶的地方。

## 計劃（4 步，全自動）

### 1. 擴充權證主檔：加入行使比例
- migration：`warrant_expiry` 增加欄位
  - `exercise_ratio numeric(10,4)`（每 1 張權證可換多少股標的）
  - `strike_price numeric(12,4)`（順手補，未來履約價事件會用到）
  - `call_put text`（購/售）
- 保留 `service_role` 寫入、`authenticated` 讀取的既有 grants；不動 RLS 語意。

### 2. 擴充抓取器：TWSE 權證每日結果 CSV 補欄位
- `supabase/functions/checkup-warrant-sync/index.ts`
  - parser 增加 `get("行使比例")`、`get("履約價")`、`get("認購/認售", "型態")`。
  - TWSE `dailyResult` 這支 CSV 已含這幾欄，不用新 endpoint。
  - upsert 一併寫入新欄位；欄位缺失時保留舊值（`onConflict:'symbol'` + `ignoreDuplicates:false`，缺欄用 `null` 只在首次寫入時填）。
- 加一支 fallback：對「dailyResult 抓不到、但持倉裡有」的權證，改打 TWSE `zh/warrant/singleWarrant?stkNo=<code>` 補行使比例（單檔查詢，不打爆）。

### 3. 自動對帳 job：`reconcile-warrant-quantities`（新 edge function）
- 觸發：`checkup-warrant-sync` 成功後 chain 呼叫；同時排一支 daily cron（收盤後 15:00 Asia/Taipei）。
- 邏輯：
  1. 撈所有 `trade_records`，`instrument` 代號為 6 碼權證且 `expert_signals.quantity_unit='張'`。
  2. 對每筆 join `warrant_expiry.exercise_ratio`。
  3. 計算 `expected_shares = signal.quantity * exercise_ratio`。
  4. 若 `trade.quantity != expected_shares`（容差 ±1 股）→ 自動修正 `trade_records.quantity`，並寫 `audit_log`（reason: `warrant_ratio_reconcile`, before/after）。
  5. 若 `warrant_expiry.exercise_ratio IS NULL` → 觸發 singleWarrant fallback 補抓；補不到才降級為「告警通知管理員」（不是預設路徑）。
- 062787 這筆會在第一次跑就自動修正到與 signal 20 張一致。

### 4. Trigger 強化：發佈時擋掉偏差
- `handle_signal_trade` 補：權證代號（6 碼且 `warrant_expiry` 有紀錄）發佈時強制用 `exercise_ratio` 算 shares，不再假設 1000。
- 若 `exercise_ratio` 尚未同步 → raise notice + fallback 1000，但同時 enqueue 一筆 `warrant_expiry` sync 任務，等 reconcile job 收尾。

## 技術細節

**新 schema：**
```sql
ALTER TABLE public.warrant_expiry
  ADD COLUMN IF NOT EXISTS exercise_ratio numeric(10,4),
  ADD COLUMN IF NOT EXISTS strike_price numeric(12,4),
  ADD COLUMN IF NOT EXISTS call_put text CHECK (call_put IN ('call','put') OR call_put IS NULL);
CREATE INDEX IF NOT EXISTS idx_warrant_expiry_ratio_null
  ON public.warrant_expiry(symbol) WHERE exercise_ratio IS NULL;
```

**新增檔案：**
- `supabase/functions/reconcile-warrant-quantities/index.ts`
- `supabase/functions/reconcile-warrant-quantities/index_test.ts`（Deno 單元測試：ratio=2500 / 1250 / null 三情境）
- `e2e/warrant-ratio-reconcile.spec.ts`（走 062787 端到端）

**修改檔案：**
- `supabase/functions/checkup-warrant-sync/index.ts`（parser + fallback）
- `supabase/migrations/<new>.sql`（欄位 + trigger 更新）
- `supabase/config.toml`（新增 cron `15 15 * * 1-5`）

**驗收：**
1. 跑一次 `reconcile-warrant-quantities` → 062787 trade quantity 自動對齊 signal，`audit_log` 有一筆 `warrant_ratio_reconcile`。
2. Deno test 三情境全綠。
3. E2E：模擬一筆 ratio=2500 的權證訊號 → publish 後 trade quantity = 張數 × 2500，無需人工介入。
4. `warrant_expiry` 表 `exercise_ratio IS NULL` 的筆數 = 0（或僅剩 TWSE CSV 也未提供的異常檔）。

## 影響範圍

- 純後端 + 資料層。前端不動。
- 現有 `handle_signal_trade` 對非權證（4 碼台股 / 美股 / 期貨）行為完全不變。
- Reconcile job 只寫 `trade_records.quantity`，不動 `signal.quantity`（單一資料源仍是 signal 的張數）。

準備好就開工。
