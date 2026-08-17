# Plan v4.1 — 逐項修正（D1–D8）

只讀產出。未改 code / DB / trigger / RPC / 資料 / RLS / ACL / 前端，未 Publish。6515 與 26 筆 drift 未動。
命名更正：**E0 = 只在 ephemeral PG 的建置與測試**；**R0..Rn = production rollout 步驟**。本文只申請 E0。

新增實查（本輪）：

| 項目 | 結果 |
| --- | --- |
| `trade_records` 經濟欄位 | `expert_id, signal_id, instrument, market, currency, quantity(integer!), quantity_unit, entry_price, exit_price, entry_date, exit_date, status, pnl_percent, is_combo, combo_strategy, net_premium, max_loss_per_unit, max_profit_per_unit` |
| `quantity` 型別 | **integer**（非 numeric）⇒ 碎股/crypto 小數 **UNPROVEN**，E0 一律整數，未知型態 fail-closed |
| `handle_signal_trade` 實際 row 影響 | buy=1 INSERT；add=1 UPDATE 或 1 INSERT；trim(部分)=**1 UPDATE + 1 INSERT**；trim(全出)=1 UPDATE；exit=**UPDATE N 列**（`WHERE ... status='open' AND exit_price IS NULL`，無 LIMIT） |
| NAV time series 現況 | **不存在儲存體**。`usePerformance` 走 `calculate_expert_performance(_expert_id uuid)`；`usePeriodPerformance` 於前端用 `trade_records` + `daily_price_snapshots` 現算；`useFactsheetSource` 直讀 `trade_records`；`useExpertHoldingsBundle`/Dashboard 走 `get_expert_capital_status` |
| 報價 as-of 來源 | `daily_price_snapshots(symbol, trade_date, close_price, market, ...)` |
| signals | `published_at` 範圍 2026-05-04 ~ 2026-08-15；`executed_at` 非空 170 / 173 |

---

## D1 一個 event → N 個 mutation

```sql
CREATE TYPE public.mutation_op   AS ENUM ('insert','update','delete');
CREATE TYPE public.mutation_role AS ENUM ('open_position','closed_lot','cash_leg','realized_lot');

CREATE TABLE app_ledger.effect_projection_mutation (   -- LOGGED（見 D4）
  projection_mutation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES app_ledger.economic_effect(event_id),
  mutation_seq  int  NOT NULL CHECK (mutation_seq >= 1),
  op            public.mutation_op   NOT NULL,
  target_table  text NOT NULL CHECK (target_table IN ('trade_records')),
  target_row_id uuid NULL,                 -- update/delete 必填；insert 由 canonical 先產 uuid 後填
  row_role      public.mutation_role NOT NULL,
  before_hash   text NULL,                 -- insert 時 NULL
  after_hash    text NULL,                 -- delete 時 NULL
  qty_delta     integer NOT NULL,
  cash_delta    numeric NULL,
  txid          bigint NOT NULL DEFAULT txid_current(),
  consumed      boolean NOT NULL DEFAULT false,
  consumed_at   timestamptz NULL,
  CONSTRAINT epm_seq_unique UNIQUE (event_id, mutation_seq),
  CONSTRAINT epm_row_required CHECK (op = 'insert' OR target_row_id IS NOT NULL),
  CONSTRAINT epm_hash_shape CHECK (
    (op='insert' AND before_hash IS NULL AND after_hash IS NOT NULL) OR
    (op='update' AND before_hash IS NOT NULL AND after_hash IS NOT NULL) OR
    (op='delete' AND before_hash IS NOT NULL AND after_hash IS NULL))
);
CREATE UNIQUE INDEX epm_one_pending_per_row
  ON app_ledger.effect_projection_mutation (target_row_id, txid)
  WHERE consumed = false AND target_row_id IS NOT NULL;
```

**每種 action 的 exact mutation 組成（由實查的 trigger 行為導出）**

| action | mutations | 說明 |
| --- | --- | --- |
| `buy`（新標的） | 1：`insert / open_position` | after_hash = 新列 |
| `add`（已有 open） | 1：`update / open_position` | qty_delta=+N，entry_price 為加權後值，兩者都進 after_hash |
| `add`（無 open） | 1：`insert / open_position` | |
| `trim` 部分 | **2**：`update / open_position`（qty_delta=−sell）＋ `insert / closed_lot`（qty_delta=+sell，帶 exit_price/exit_date/pnl_percent） | 兩張 token 同一 event，seq=1,2 |
| `trim`/`sell` 全出 | 1：`update / open_position → closed` | qty_delta=0（數量不變，status 轉 closed）；guard 以 hash 比對而非 qty |
| `exit`（N 個 open 列） | **N**：每列一張 `update / open_position → closed`，seq=1..N | canonical 必須先 `SELECT ... FOR UPDATE ORDER BY id` 固定順序並宣告 N |
| `correction: historical_fill` | 依重播結果 1–2（同 buy/trim 規則） | |
| `correction: quantity_adjustment` | 1：`update / open_position`，`cash_delta IS NULL` | |
| `correction: capital_adjustment` | 1：`insert / cash_leg`（Phase 2 記於 ledger，不動 trade_records） | |

**測試**：以上 8 種各一，斷言「產生的 mutation 張數與 role 完全等於預期」且「全部 consumed」。

---

## D2 token 綁定 op + row PK + before/after hash

```sql
-- canonical hash：固定欄位順序、NULL → '\x00'、numeric 統一 trim_scale + to_char
CREATE OR REPLACE FUNCTION app_ledger.tr_econ_hash(r public.trade_records)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(digest(concat_ws('|',
    coalesce(r.id::text,'\x00'), coalesce(r.expert_id::text,'\x00'),
    coalesce(r.instrument,'\x00'), coalesce(r.market,'\x00'), coalesce(r.currency,'\x00'),
    coalesce(r.quantity::text,'\x00'), coalesce(r.quantity_unit,'\x00'),
    coalesce(to_char(trim_scale(r.entry_price),'FM9999999999990.0999999999'),'\x00'),
    coalesce(to_char(trim_scale(r.exit_price ),'FM9999999999990.0999999999'),'\x00'),
    coalesce(to_char(r.entry_date at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),'\x00'),
    coalesce(to_char(r.exit_date  at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),'\x00'),
    coalesce(r.status::text,'\x00'),
    coalesce(to_char(trim_scale(r.pnl_percent),'FM9999999999990.0999999999'),'\x00'),
    coalesce(r.is_combo::text,'\x00'), coalesce(r.combo_strategy,'\x00'),
    coalesce(to_char(trim_scale(r.net_premium),'FM9999999999990.0999999999'),'\x00'),
    coalesce(to_char(trim_scale(r.max_loss_per_unit),'FM9999999999990.0999999999'),'\x00'),
    coalesce(to_char(trim_scale(r.max_profit_per_unit),'FM9999999999990.0999999999'),'\x00')
  ), 'sha256'), 'hex')
$$;   -- 不含 current_price / price_updated_at / created_at（price-only worker 欄位）

ALTER TABLE public.trade_records
  ADD COLUMN last_event_id uuid NULL,
  ADD COLUMN last_projection_mutation_id uuid NULL;

CREATE OR REPLACE FUNCTION app_ledger.trade_records_economic_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_ledger, public AS $$
DECLARE t record; v_before text; v_after text; v_qty int;
BEGIN
  IF TG_OP='UPDATE' AND app_ledger.tr_econ_hash(NEW) = app_ledger.tr_econ_hash(OLD)
     AND NEW.last_event_id IS NOT DISTINCT FROM OLD.last_event_id
  THEN RETURN NEW; END IF;                       -- price-only 放行

  v_before := CASE TG_OP WHEN 'INSERT' THEN NULL ELSE app_ledger.tr_econ_hash(OLD) END;
  v_after  := CASE TG_OP WHEN 'DELETE' THEN NULL ELSE app_ledger.tr_econ_hash(NEW) END;
  v_qty    := CASE TG_OP WHEN 'INSERT' THEN NEW.quantity
                         WHEN 'DELETE' THEN -OLD.quantity
                         ELSE NEW.quantity - OLD.quantity END;

  SELECT * INTO t FROM app_ledger.effect_projection_mutation m
   WHERE m.consumed = false
     AND m.txid = txid_current()
     AND m.op = lower(TG_OP)::public.mutation_op
     AND m.target_table = 'trade_records'
     AND m.target_row_id = COALESCE(NEW.id, OLD.id)
     AND m.before_hash IS NOT DISTINCT FROM v_before
     AND m.after_hash  IS NOT DISTINCT FROM v_after
     AND m.qty_delta = v_qty
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'economic_write_requires_matching_mutation' USING ERRCODE='P0001';
  END IF;

  UPDATE app_ledger.effect_projection_mutation
     SET consumed = true, consumed_at = now()
   WHERE projection_mutation_id = t.projection_mutation_id;

  IF TG_OP <> 'DELETE' THEN
    NEW.last_event_id := t.event_id;
    NEW.last_projection_mutation_id := t.projection_mutation_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
```

- `after_hash` 由 canonical 在寫入前以**預期列內容**計算 ⇒ 拿到合法 qty token 卻改錯 entry_price/status/exit_price/pnl，hash 不符 ⇒ raise。
- **deferred reconciliation（全部且只有預期 mutations）**：

```sql
CREATE CONSTRAINT TRIGGER trg_effect_settled
  AFTER INSERT ON app_ledger.economic_effect
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION app_ledger.assert_effect_mutations_settled();
-- assert：expected_mutation_count（event 上的 NOT NULL 欄位，由 canonical 宣告）
--   = (該 event 的 mutation 總數) = (consumed=true 的數量)，且 seq 為 1..N 連續；
--   任何不符 → RAISE 'effect_mutation_set_mismatch'
```

**Negative tests**：正確 qty 但錯 `entry_price` / 錯 `status` / 錯 `pnl_percent` / 改到另一 row id / 只消耗 2 張中的 1 張 / 多做一個未宣告的 UPDATE ⇒ 全部 raise。

---

## D3 ledger append-only

```sql
ALTER TABLE app_ledger.economic_effect
  ADD COLUMN expected_mutation_count int NOT NULL DEFAULT 1 CHECK (expected_mutation_count >= 0);

CREATE OR REPLACE FUNCTION app_ledger.effect_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'effect_delete_forbidden' USING ERRCODE='P0001'; END IF;
  -- payload 全欄位不可變，只有 state 可依合法轉移改動
  IF ROW(NEW.logical_effect_id, NEW.event_version, NEW.supersedes_event_id, NEW.expert_id,
         NEW.origin_signal_id, NEW.market, NEW.instrument, NEW.instrument_key, NEW.action,
         NEW.qty_delta, NEW.qty_unit, NEW.cash_delta, NEW.price, NEW.fees, NEW.fee_model,
         NEW.effective_at, NEW.recorded_at, NEW.provenance, NEW.actor_user_id, NEW.actor_via,
         NEW.expected_mutation_count, NEW.calc_model_version)
     IS DISTINCT FROM
     ROW(OLD.logical_effect_id, OLD.event_version, OLD.supersedes_event_id, OLD.expert_id,
         OLD.origin_signal_id, OLD.market, OLD.instrument, OLD.instrument_key, OLD.action,
         OLD.qty_delta, OLD.qty_unit, OLD.cash_delta, OLD.price, OLD.fees, OLD.fee_model,
         OLD.effective_at, OLD.recorded_at, OLD.provenance, OLD.actor_user_id, OLD.actor_via,
         OLD.expected_mutation_count, OLD.calc_model_version)
  THEN RAISE EXCEPTION 'effect_payload_immutable' USING ERRCODE='P0001'; END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT ((OLD.state='reserved' AND NEW.state IN ('applied','failed'))
         OR (OLD.state='applied'  AND NEW.state='superseded'))
    THEN RAISE EXCEPTION 'effect_illegal_state_transition: % -> %', OLD.state, NEW.state
         USING ERRCODE='P0001'; END IF;
  END IF;
  -- visible_at 只允許 NULL → 非 NULL（一次性 publish）
  IF OLD.visible_at IS NOT NULL AND NEW.visible_at IS DISTINCT FROM OLD.visible_at THEN
    RAISE EXCEPTION 'visible_at_immutable_once_set' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_effect_append_only
  BEFORE UPDATE OR DELETE ON app_ledger.economic_effect
  FOR EACH ROW EXECUTE FUNCTION app_ledger.effect_append_only();

-- head/parent 成對（deferred，不依賴 function 步驟紀律）
CREATE CONSTRAINT TRIGGER trg_effect_head_pairing
  AFTER INSERT OR UPDATE ON app_ledger.economic_effect
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION app_ledger.assert_head_pairing();
-- assert：若 NEW.state='applied' 且 event_version>1，則 parent.state 必須='superseded'；
--         每條 chain 恰一個 applied（partial unique 已保證）；
--         parent 為 'superseded' 時必須存在恰一個 successor（applied 或 superseded）。
```

**Negative tests**：直接 UPDATE payload（含 provenance / effective_at / expert_id）⇒ raise；`applied→reserved`、`superseded→applied`、`failed→applied` ⇒ raise；DELETE ⇒ raise；parent 未 superseded 就插 applied 新 head ⇒ commit 時 raise。

---

## D4 權限：dedicated owner，撤掉 runtime service_role 的 raw DML

```sql
CREATE SCHEMA app_ledger;
CREATE ROLE ledger_owner NOLOGIN;                 -- 擁有 app_ledger 所有物件與 canonical functions
CREATE ROLE ledger_break_glass NOLOGIN;           -- 專用；非共用 service_role
ALTER SCHEMA app_ledger OWNER TO ledger_owner;
-- economic_effect / effect_projection_mutation OWNER = ledger_owner（LOGGED，非 UNLOGGED）
REVOKE ALL ON ALL TABLES IN SCHEMA app_ledger FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA app_ledger TO authenticated, service_role;
GRANT SELECT ON app_ledger.economic_effect TO authenticated, service_role;   -- RLS 限本人 expert
-- effect_projection_mutation：對所有 runtime role 完全無權限（含 SELECT）
```

| 物件 | anon | authenticated | service_role（runtime Edge） | ledger_break_glass | ledger_owner |
| --- | --- | --- | --- | --- | --- |
| `economic_effect` | – | SELECT(RLS) | SELECT(RLS) | – | ALL（owner） |
| `effect_projection_mutation` | – | – | – | – | ALL（owner） |
| `trade_records` economic DML | – | – | **REVOKE INSERT/UPDATE/DELETE** | – | ALL |
| `trade_records` price-only 欄位 | – | – | `GRANT UPDATE (current_price, price_updated_at, pnl_percent_price_only?)` **UNPROVEN：`pnl_percent` 同時是經濟欄位，E0 決議＝price worker 不得寫 `pnl_percent`，只寫 `current_price`, `price_updated_at`** | – | ALL |
| `trade_records` SELECT | – | SELECT(RLS) | SELECT | – | ALL |
| canonical RPC（`canonical_apply_effect`/`canonical_correct`/`canonical_publish`） | – | EXECUTE | EXECUTE | – | owner |
| `canonical_break_glass(...)` | – | – | **–** | EXECUTE | owner |
| 舊 admin/dedupe/delete RPC | REVOKE | REVOKE | REVOKE | – | – |

- canonical functions 為 `SECURITY DEFINER OWNER TO ledger_owner SET search_path = app_ledger, public`；只有它們能寫 mutation table 與 ledger。
- break-glass 走 `ledger_break_glass`（獨立 DB role，僅由受控維運通道使用，非 Edge 共用 key），強制 `reason`、寫 `audit_logs`、必產 correction event。
- **mutation table retention**：改 LOGGED；每筆成功 transaction 後保留 30 天供對帳，之後由 `ledger_owner` 的 job 刪除 `consumed=true AND consumed_at < now()-30d`；未 consumed 的列不可能跨 transaction 存活（deferred assert）。
- DB owner／postgres 的真正緊急權限獨立列在 runbook，**不冒充應用層 guard**。

**Negative tests**：以 service_role 直接 `INSERT INTO app_ledger.economic_effect` / `INSERT INTO effect_projection_mutation` / `UPDATE trade_records SET quantity=...` ⇒ 三者皆 permission denied；service_role 只改 `current_price` ⇒ 成功。

---

## D5 logical_effect_id 一律 server-generate

```sql
CREATE OR REPLACE FUNCTION app_ledger.signals_logical_id_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.logical_effect_id := gen_random_uuid();     -- 無條件覆蓋 client 值
  ELSIF NEW.logical_effect_id IS DISTINCT FROM OLD.logical_effect_id THEN
    RAISE EXCEPTION 'logical_effect_id_immutable' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;

-- restore 專用（只有 ledger_owner 擁有、canonical 內部呼叫；讀 OLD row，不看 client payload）
CREATE OR REPLACE FUNCTION app_ledger.restore_signal_logical_id(_new_signal_id uuid, _old_signal_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_ledger, public AS $$
DECLARE v uuid; v_expert uuid; v_new_expert uuid;
BEGIN
  SELECT logical_effect_id, expert_id INTO v, v_expert
    FROM app_ledger.signal_logical_id_archive WHERE signal_id = _old_signal_id;   -- delete 前由 canonical 歸檔
  SELECT expert_id INTO v_new_expert FROM public.expert_signals WHERE id = _new_signal_id;
  IF v IS NULL OR v_expert IS DISTINCT FROM v_new_expert THEN
    RAISE EXCEPTION 'logical_id_restore_denied' USING ERRCODE='P0001'; END IF;
  UPDATE public.expert_signals SET logical_effect_id = v WHERE id = _new_signal_id;  -- 繞過 guard：owner 專用旗標欄位版
END $$;
```

**Negative tests**：client 送 (a) 同 expert 既有 UUID、(b) 他人 expert UUID、(c) 隨機 UUID ⇒ 三者皆被覆蓋為新 UUID；(d) delete→reinsert 經 canonical restore ⇒ 保留原 id 且不產生第二次 effect。

---

## D6 Public projection（補齊 cash / equity / NAV / as-of）

```sql
CREATE TABLE public.public_position_projection (      -- 現況部位
  expert_id uuid NOT NULL, instrument_key text NOT NULL, instrument text NOT NULL,
  market text NOT NULL, quantity integer NOT NULL, quantity_unit text NOT NULL,
  avg_cost numeric NOT NULL, cost_value numeric NOT NULL,
  last_visible_event_id uuid NOT NULL, provenance public.effect_provenance NOT NULL,
  quarantined boolean NOT NULL DEFAULT false, as_of timestamptz NOT NULL,
  PRIMARY KEY (expert_id, instrument_key));

CREATE TABLE public.public_portfolio_state (          -- 現金與資本流
  expert_id uuid PRIMARY KEY,
  starting_capital numeric NOT NULL,
  capital_adjustment_total numeric NOT NULL DEFAULT 0,
  realized_pnl numeric NOT NULL DEFAULT 0,
  cash numeric NOT NULL,                              -- = starting + adj + realized − open_cost
  open_cost numeric NOT NULL,
  last_visible_event_id uuid NOT NULL,
  quarantined_position_count int NOT NULL DEFAULT 0,
  as_of timestamptz NOT NULL);

CREATE TABLE public.public_nav_daily (                -- 可重播 time series
  expert_id uuid NOT NULL, trade_date date NOT NULL,
  cash numeric NOT NULL, market_value numeric NOT NULL,
  equity numeric GENERATED ALWAYS AS (cash + market_value) STORED,
  net_capital_flow numeric NOT NULL DEFAULT 0,        -- capital_adjustment，計算報酬時扣除
  daily_return numeric NULL,                          -- (equity_t − equity_{t−1} − flow_t)/equity_{t−1}
  price_as_of date NOT NULL,                          -- 取自 daily_price_snapshots.trade_date
  price_source text NOT NULL DEFAULT 'daily_price_snapshots',
  replay_watermark bigint NOT NULL,                   -- 見 D8
  quarantined_included boolean NOT NULL DEFAULT false,
  PRIMARY KEY (expert_id, trade_date));
```

**Transactional / recompute semantics**

| 觸發 | 行為 |
| --- | --- |
| `canonical_publish`（visible_at 由 NULL→值） | 同 transaction 內 replay 該 expert 的 visible events → 更新 position/portfolio；並對 `effective_at::date` 起至今的 `public_nav_daily` 標 `dirty`（`replay_watermark` 落後）|
| published correction（新 applied head 且已 visible） | 同上；**歷史 NAV 不改數字**，而是在 `net_capital_flow` 記入更正額並標註「本日含帳務更正」 |
| late publish / backdated `effective_at` | 內部 NAV 從 `effective_at` 起重算；public NAV 從 `visible_at::date` 起才反映（公開曲線不回溯竄改） |
| price worker 更新 | 只影響 `market_value`；由每日 job 依 `daily_price_snapshots` 重算當日列，不觸發 event replay |
| replay 失敗 | 整個 publish transaction rollback（fail-closed，寧可不公開） |

**Consumer 對照（現行 → 提議）**

| consumer | 現行來源（實查） | 提議 |
| --- | --- | --- |
| `useExpertHoldingsBundle` / `admin/Dashboard` | `get_expert_capital_status` | 加 `_scope`：internal（本人/admin）／public（anon） |
| `usePerformance` | `calculate_expert_performance` RPC | public scope 改讀 `public_nav_daily` |
| `usePeriodPerformance` | 前端合成 `trade_records` + `daily_price_snapshots` | 改讀 `public_nav_daily`（消除前端重算） |
| `useFactsheetSource` / `factsheetPdf` | 直讀 `trade_records` | 改讀 public projection 三表 |
| `analystDataAccess` / `list_my_holdings`(MCP) / JournalsExport / HoldingsConsistency | `trade_records` | internal，維持 |

**D6 必交的 read-only diff**：見 §「production impact report 查詢規格」第 3–5 項（現行 vs 提議逐 expert 逐欄位差異，不接受「能 render」。）

---

## D7 Legacy 公開口徑 = product decision gate（不由我決定）

事實：`expert_signals` 全部 173 筆 published、`published_at` 介於 2026-05-04 ~ 2026-08-15，皆先於 cutover ⇒ 若全標 `legacy_unverified_baseline` 且排除，**公開績效/排名/factsheet 可能歸零或大幅變動**。

三個選項（Phase 1 只提供數字，不預設選擇）：

| 選項 | 公開行為 | 數字後果（由 impact report 量化） |
| --- | --- | --- |
| L-A 全部排除 | legacy 不計入公開總計 | 多數 expert 公開 equity/return 趨近 starting_capital，排名重洗 |
| L-B 全部計入 + 揭露 | 照舊顯示，加「歷史資料未經逐筆驗證」註記 | 數字不變，誠實度靠揭露 |
| L-C 雙口徑 | 同時顯示 verified 與 including-legacy 兩欄 | 數字不變但 UI 需改；排名需選定主口徑 |

6515 與 26 筆 drift：一律 `manual_review`，**不得**以 50 或 10 猜真值，不進任何公開口徑計算（無論選 L-A/B/C）。

---

## D8 Rollout：同一 gate、monotonic watermark

```sql
CREATE SEQUENCE app_ledger.effect_seq;      -- monotonic bigint
ALTER TABLE app_ledger.economic_effect
  ADD COLUMN effect_no bigint NOT NULL DEFAULT nextval('app_ledger.effect_seq'),
  ADD COLUMN generation int NOT NULL DEFAULT 1;   -- migration generation
CREATE TABLE app_ledger.cutover_state (
  id int PRIMARY KEY DEFAULT 1 CHECK (id=1),
  generation int NOT NULL,
  cutover_effect_no bigint NOT NULL,        -- high-water：此號之後為 canonical 產出
  mode text NOT NULL CHECK (mode IN ('legacy','canonical')),
  rolled_back_at timestamptz NULL);
```

- **R2 單一 transaction 內完成全部**：`DISABLE TRIGGER on_signal_insert_or_update` + 啟用 canonical + **同時**執行 §writer disposition 的全部 DISABLE/REVOKE/ROUTE + price-only 欄位權限收斂 + guard 啟用 + 寫 `cutover_state`。**不保留 7 天旁路**（原 P4 併入 R2）。
- Edge 於 **R1.5** 先行部署（向下相容）。R2 之後只剩觀察期 R3，觀察期不再有舊 writer。
- **Rollback skip 判定（不依 wall clock）**：回 legacy 後，舊 trigger 對每個 signal 檢查 `EXISTS (SELECT 1 FROM economic_effect WHERE logical_effect_id = s.logical_effect_id AND state='applied' AND provenance='post_cutover_proven_effect' AND effect_no > cutover_state.cutover_effect_no AND generation = cutover_state.generation)` ⇒ skip 並記 audit。
- 每步 R0..R3 記錄 pre/post `schema_hash`、`function_hash`、grants/RLS diff、kill-switch readback。

**Failure-state matrix**

| 狀態 | 處置 |
| --- | --- |
| R1.5 Edge 新、DB 舊 | Edge 走相容路徑，可久留 |
| R2 migration 失敗 | 單一 transaction rollback，維持 legacy，無中間態 |
| R2 成功、Edge 部署失敗 | 舊 Edge 呼叫的 RPC 內部已 route，行為正確；補 deploy |
| 回滾後 Edge 仍新 | canonical RPC 回 `mode_legacy_rejected`，Edge fallback |

---

## Production impact report — 只讀查詢規格（Phase 1 交付，不改任何資料）

1. **legacy 分類**：逐 expert 統計 published signals 數、`executed_at` 缺漏數（已知 3 筆）、對應 trade_records 列數。
2. **drift 清單**：現有 26 筆 symbol 的 signal-derived qty vs `trade_records.quantity`（沿用既有稽核查詢），輸出 expert/symbol/diff/是否 manual_review。
3. **holdings diff**：`trade_records`(open) vs 依 visible events 重播結果，逐列 before/after quantity、avg_cost、cost_value。
4. **equity/return diff**：逐 expert `get_expert_capital_status()` 現值 vs 提議 public projection 的 cash / market_value / equity / 期間報酬。
5. **ranking diff**：現行排行榜順序 vs L-A / L-B / L-C 三種口徑下的順序（同一表格三欄）。
6. **factsheet diff**：`useFactsheetSource` 取得的欄位逐項對照提議 projection。
7. **instrument key 覆蓋**：全表 `norm_instrument_key` 非 NULL 比率、NULL 樣本、`US:OPT:` 命中列。
8. **權限現況快照**：`pg_class.relacl` + `proacl`（已知 anon/authenticated 為 `arwdDxtm`），作為 R2 diff 基準。

全部為 `SELECT`；輸出為報告，不寫回資料庫。

---

## E0 acceptance（**只在 ephemeral PG**）

建 migration + tests，先紅後綠，涵蓋：

- D1：8 種 action 的 mutation 張數/role/seq 正確且全部 consumed。
- D2：hash 綁定 6 個 negative tests；`last_event_id` / `last_projection_mutation_id` 正確落地；deferred set-equality assert。
- D3：payload immutable、非法 state transition、DELETE、head/parent 未成對 4 類 negative tests。
- D4：service_role raw INSERT token / event / trade_records 三者 denied；price-only UPDATE 通過。
- D5：四個 logical_effect_id 測試。
- D6：publish 前後 internal vs public 差異；backdated effective_at；late publish；correction；price worker 重算；NAV 恆等式 `cash + market_value = equity`。
- D8：rollback skip 依 `provenance + generation + effect_no + logical_effect_id`，不重播。
- 併發：correction head 競態（`effect_head_stale`）、空列 race、多 symbol batch 無 deadlock、`exit` 多列同 event 的 N-token 正確性。
- blast radius：advisor T+0、mentor T+7、11 位 mentor fixture、TW 權證 4 筆型態、US combo 3 筆型態、publish-weekly-journals、weekly export、factsheet。
- 全部使用 fixture，**不 hard-code 任何 production UID**。

E0 通過條件：全綠 + `schema_hash`/`function_hash`/grants diff 全記錄 + production 完全零觸碰。

---

## UNPROVEN（不以假設補洞）

1. `trade_records.quantity` 為 integer ⇒ 碎股/crypto 小數處理未定，E0 僅整數，其餘 fail-closed。
2. `pnl_percent` 同時被 price worker 與經濟路徑寫入 ⇒ E0 決議由經濟路徑獨佔，price worker 停寫；**需你確認是否接受此行為變更**。
3. `recall / taken_down` 語意：仍無 domain evidence ⇒ 只停止自動反轉，visibility 不變，model-based test 不含 recall。
4. `calculate_expert_performance` 內部演算法尚未逐行審（僅確認被 `usePerformance` 使用）⇒ public NAV 對照需在 impact report 第 4 項實測後才能定論。

---

## STOP

未經再次審核：**不得進 R0**，不得改 production、6515、26 筆 drift、前端、RLS/ACL、Edge，不得 Publish。
本次僅申請批准 **E0（ephemeral only）**。停等審核。
