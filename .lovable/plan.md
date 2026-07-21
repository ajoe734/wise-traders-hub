## 根因（已在 DB 驗證）

`00631L` 兩行的根因不是彥愷手動加倉，而是 **DB trigger `handle_signal_trade()` 遇到 signal UPDATE 時盲插 trade_record**。

證據：
- `trade_records` 有 4 筆重複（`signal_id` 相同、`expert_id/instrument/quantity/entry_price/entry_date` 完全一樣），影響 signals：
  - `f5d1e699…`（彥愷 00631L 元大台灣50正2）
  - `4425d8df…`（TSM）
  - `1798a2ab…`（META）
  - `c36911f3…`（064781 勤誠兆豐5C購01）
- 這 4 筆「複本」的 `created_at` 全部是 **2026-07-17 12:00:04.398381+00**，同一批同一秒 → 出自 pg_cron `publish-weekly-journals`（schedule `0 12 * * 5`）。
- 該 cron 內部會 UPDATE `expert_signals.status`（例如 draft/pending → published）。trigger `on_signal_insert_or_update` → `handle_signal_trade()` 的 `action='buy'` 分支：

```sql
IF NEW.action = 'buy' THEN
  INSERT INTO public.trade_records (...) VALUES (...);
```

**沒有先檢查該 `signal_id` 是否已有 trade_record**，只要 UPDATE 讓 status 進入 `published/pending` 且 `OLD.status <> NEW.status`，就再插一筆。`add`/`sell`/`trim` 分支有 SELECT ... FOR 前置查詢會找到既有列並 UPDATE；只有 `buy` 這條路徑會盲插——所以只有「初始建倉」的 signal 會出現重複。

## 修正計畫

### 1. 資料清理（一次性）
刪除 4 筆較新的重複 trade_records（保留原始 07-15/07-17 較早那筆）：
```
3ef8df45-…  (00631L 彥愷)
84b7717d-…  (META)
703a7ad1-…  (TSM)
e49c111c-…  (勤誠兆豐5C購01)
```
刪除前先確認：這 4 筆都沒被 `daily_snapshot / performance / journals_export` 生成的下游快照鎖定引用（僅是聚合來源，可安全刪）。刪除經 audit trigger 自動記入 `audit_logs`。

### 2. Trigger 修補（根因）
改寫 `handle_signal_trade()` 的 `action='buy'` 分支，在 INSERT 前先看看該 `signal_id` 是否已有 trade_record；有就直接 RETURN，不做事。這與 `add/sell/trim` 的行為一致（都有 SELECT 前置）。

```sql
IF NEW.action = 'buy' THEN
  PERFORM 1 FROM public.trade_records WHERE signal_id = NEW.id LIMIT 1;
  IF FOUND THEN
    RETURN NEW;   -- 已建過，不重複建
  END IF;
  INSERT INTO public.trade_records (...) VALUES (...);
```

同時在 `add` 分支的 fallback INSERT（找不到 open 部位時）也加同樣的 `signal_id` 存在性檢查，避免同一手法從 add 路徑再爆一次。

### 3. 資料庫層防呆（結構性）
新增 partial unique index，確保「同一 signal 只能對應到一筆『初始建倉』trade_record」：
```sql
CREATE UNIQUE INDEX trade_records_signal_id_buy_uniq
  ON public.trade_records (signal_id)
  WHERE signal_id IS NOT NULL AND exit_date IS NULL;
```
（sell/trim 產生的 closed 分割列 `exit_date IS NOT NULL`，不受此索引限制；也不會擋合法的部分賣出。）

若擔心相容性，可改用更保守版本：只針對「status='open' 且 exit_date IS NULL」的第一筆做 unique。

### 4. 回歸測試
- 新增 pgTAP／SQL 測試：
  1. 建立一個 signal (action='buy')，UPDATE status 兩次到 published/pending → 斷言 `trade_records` 只有 1 列。
  2. 重複觸發 add → 斷言累加而非新增。
- 前端 E2E `e2e/holdings-no-duplicate-signal-rows.spec.ts`：在後台建 buy 訊號、模擬 status 變更，前端持倉表格該檔股票只有一列。

### 5. 事後稽核
- 跑 `admin_holdings_consistency_audit()` 重新掃一次，確認清完 4 筆後 UNIT_MIX / DRIFT 沒有其他遺留（本次 4 筆只是初次抽樣，可能還有其他更早的重複；下面第 6 步一併清）。

### 6. 全量重複掃描
在遷移中做一次 idempotent cleanup：
```sql
DELETE FROM public.trade_records t
USING (
  SELECT signal_id, min(created_at) AS keep_at
  FROM public.trade_records
  WHERE signal_id IS NOT NULL
  GROUP BY signal_id
  HAVING count(*) > 1
) d
WHERE t.signal_id = d.signal_id
  AND t.created_at > d.keep_at
  AND t.exit_date IS NULL;  -- 只清 open 端的複本
```
確認影響行數與剩餘一致；audit_logs 自動記錄。

### 技術細節
- 影響檔案：新增 `supabase/migrations/2026072x_fix_handle_signal_trade_dedup.sql`（重寫函數 + 加 partial unique index + cleanup）。
- Trigger 現況：`on_signal_insert_or_update AFTER INSERT OR UPDATE`。保留 AFTER 語意，只改函數內部邏輯。
- 不會影響 `add/sell/trim`：這些路徑本來就有既存列查詢，僅 `buy` 分支被強化。
- Publish cron 未來若再翻動 status，不會再造成複本。
