# Plan v4.2 — 逐項修正（E1–E8）

只讀產出。未改 code / DB / trigger / RPC / 資料 / RLS / ACL / Edge / 前端，未 Publish。6515 與 26 筆 drift 未動。
E0 = 只在 ephemeral PG；R0..Rn = production（本文不申請）。

本輪新增實查：

| 項目 | 結果 | 後果 |
| --- | --- | --- |
| `fx_rates` schema | `currency_pair, rate, source, fetched_at, updated_at`；**只有 1 列 `USDTWD 31.99 @2026-08-17`**，**無 rate_date、無歷史** | **歷史 FX as-of 不存在 ⇒ UNPROVEN ⇒ E0 fail-closed gate** |
| `daily_price_snapshots` 對 TW 權證 | 4 筆皆有列但極稀疏：`068003`=12、`071745`=25、`078397`=3、`079052`=5 | 權證估值 coverage 不足 ⇒ 需 stale threshold + fail-closed |
| `daily_price_snapshots` 對 US combo | 只有 underlying（LUNR/RKLB/SNDK 各 12 列），**無 combo 本身報價** | **US combo 估值 UNPROVEN ⇒ fail-closed，不得以 underlying 代替** |
| `current_prices` | 有 `symbol, price, market, currency, updated_at` | 可作 intraday 報價，但仍缺 combo/warrant 保證 |

---

## E1 mutation target 與經濟守恆

**決議（不再兩者都說）**：cash 與 portfolio 都有**實體 internal projection 表**；`capital_adjustment` 產生 1 張 `cash_leg` token，target = `app_ledger.portfolio_cash_ledger`。純 ledger-only 事件（例如僅記錄註解的 correction）以 `expected_mutation_count = 0` 明確表示。

```sql
CREATE TABLE app_ledger.portfolio_cash_ledger (       -- internal，逐幣別
  cash_entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL,
  currency  text NOT NULL CHECK (currency IN ('TWD','USD')),
  entry_kind text NOT NULL CHECK (entry_kind IN
    ('trade_settlement','external_capital_flow','data_correction_adjustment')),
  amount numeric NOT NULL,                            -- 正=入金/賣出所得，負=買進支出
  effective_at timestamptz NOT NULL,
  event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE app_ledger.effect_projection_mutation
  DROP CONSTRAINT epm_row_required,
  ALTER COLUMN target_table TYPE text,
  ADD CONSTRAINT epm_target_table_ck
    CHECK (target_table IN ('trade_records','portfolio_cash_ledger'));
```

每個 target table 各有自己的 canonical hash 與 guard（`app_ledger.cash_econ_hash(row)` + `cash_ledger_guard()`，語意與 §E3 的 trade guard 相同：op + row PK + before/after hash 全比對）。`portfolio_cash_ledger` 亦為 append-only（禁 UPDATE/DELETE，更正以反向分錄）。

### Deferred semantic invariant（張數 + 經濟同時驗）

```sql
CREATE OR REPLACE FUNCTION app_ledger.assert_effect_semantics() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE e record; n int; c int; q_open int; q_closed int; cash_sum numeric;
BEGIN
  SELECT * INTO e FROM app_ledger.economic_effect WHERE event_id = NEW.event_id;

  SELECT count(*), count(*) FILTER (WHERE consumed) INTO n, c
    FROM app_ledger.effect_projection_mutation WHERE event_id = e.event_id;
  IF n <> e.expected_mutation_count OR c <> n THEN
    RAISE EXCEPTION 'effect_mutation_set_mismatch: expected=% actual=% consumed=%',
      e.expected_mutation_count, n, c USING ERRCODE='P0001'; END IF;
  -- seq 必須 1..n 連續
  IF EXISTS (SELECT 1 FROM generate_series(1,n) g
              WHERE NOT EXISTS (SELECT 1 FROM app_ledger.effect_projection_mutation m
                                 WHERE m.event_id=e.event_id AND m.mutation_seq=g))
  THEN RAISE EXCEPTION 'effect_mutation_seq_gap' USING ERRCODE='P0001'; END IF;

  -- (a) 相容性：所有 token 的 expert/currency/market/instrument_key 必須等於 event
  IF EXISTS (SELECT 1 FROM app_ledger.effect_projection_mutation m
              WHERE m.event_id=e.event_id
                AND (m.expert_id <> e.expert_id OR m.currency <> e.currency
                  OR m.market IS DISTINCT FROM e.market
                  OR (m.row_role <> 'cash_leg' AND m.instrument_key IS DISTINCT FROM e.instrument_key)))
  THEN RAISE EXCEPTION 'effect_token_context_mismatch' USING ERRCODE='P0001'; END IF;

  -- (b) 持股守恆：只計 open_position；closed_lot 為 reclassification，不得計入
  SELECT COALESCE(sum(qty_delta) FILTER (WHERE row_role='open_position'),0),
         COALESCE(sum(qty_delta) FILTER (WHERE row_role='closed_lot'),0)
    INTO q_open, q_closed
    FROM app_ledger.effect_projection_mutation WHERE event_id=e.event_id;
  IF q_open <> e.qty_delta THEN
    RAISE EXCEPTION 'open_qty_delta_mismatch: tokens=% event=%', q_open, e.qty_delta
      USING ERRCODE='P0001'; END IF;
  -- partial trim：closed_lot 增量必須等於 open_position 減量的絕對值
  IF e.action IN ('trim','sell','exit') AND q_closed <> 0 AND q_closed <> -q_open THEN
    RAISE EXCEPTION 'closed_lot_reclass_mismatch' USING ERRCODE='P0001'; END IF;

  -- (c) 現金守恆
  SELECT COALESCE(sum(cash_delta) FILTER (WHERE row_role='cash_leg'),0) INTO cash_sum
    FROM app_ledger.effect_projection_mutation WHERE event_id=e.event_id;
  IF e.cash_delta IS NULL THEN
    IF cash_sum <> 0 THEN RAISE EXCEPTION 'unexpected_cash_leg' USING ERRCODE='P0001'; END IF;
  ELSIF cash_sum <> e.cash_delta THEN
    RAISE EXCEPTION 'cash_delta_mismatch: tokens=% event=%', cash_sum, e.cash_delta
      USING ERRCODE='P0001'; END IF;

  -- (d) closed lot 成本/收入/已實現守恆：
  --     closed_lot.after 的 entry_price 必須等於 parent open row 的 before entry_price，
  --     realized = qty × (exit_price − entry_price)，且 cash_leg(trade_settlement)
  --     = qty × exit_price（賣出）或 −qty × entry_price（買進），誤差 = 0（numeric，非 float）。
  PERFORM app_ledger.assert_closed_lot_conservation(e.event_id);
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_effect_semantics
  AFTER INSERT ON app_ledger.economic_effect
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION app_ledger.assert_effect_semantics();
```

（`effect_projection_mutation` 因此新增 `expert_id`、`currency`、`market`、`instrument_key` 欄位，由 canonical 填入並受 (a) 比對。）

**Negative tests（張數正確但經濟錯）**：
1. partial trim 兩張 token，但 closed_lot 誤填 `qty_delta` 為正的持股增加 ⇒ `closed_lot_reclass_mismatch`。
2. open_position 減 30、closed_lot 加 50 ⇒ 同上。
3. buy 帶 `cash_leg` 金額 ≠ qty×price ⇒ `cash_delta_mismatch`。
4. `quantity_adjustment` 附 cash_leg ⇒ `unexpected_cash_leg`。
5. closed_lot 的 `entry_price` 竄改為較低成本以美化 realized ⇒ `assert_closed_lot_conservation` raise。
6. token 的 currency 與 event 不同 ⇒ `effect_token_context_mismatch`。

---

## E2 移除誤擋的 unique

`epm_one_pending_per_row` **刪除**。同列多步由 hash chain 決定順序：guard 比對 `before_hash = tr_econ_hash(OLD)`，因此第二張 token 的 `before_hash` 必須等於第一張的 `after_hash`，天然序列化，不需 unique。

替代保護：`UNIQUE (event_id, mutation_seq)` 保留；另加 `CHECK (op='insert' OR target_row_id IS NOT NULL)`（重新加回，僅對 trade_records/cash_ledger 的 update/delete）。

**測試**：同一 transaction 內 `buy → add → trim`（同 instrument）；兩個不同 event 依序改同一 row；結果必須與逐 event 分開 replay 完全相同（逐欄位比對）。

---

## E3 price-only fast path 改為明確 whitelist

```sql
CREATE OR REPLACE FUNCTION app_ledger.trade_records_economic_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t record; v_before text; v_after text; v_qty int; v_o jsonb; v_n jsonb;
BEGIN
  IF TG_OP='UPDATE' THEN
    v_o := to_jsonb(OLD) - 'current_price' - 'price_updated_at';
    v_n := to_jsonb(NEW) - 'current_price' - 'price_updated_at';
    IF v_o = v_n THEN RETURN NEW; END IF;   -- 唯一 fast path：其餘所有欄位（含
                                            -- signal_id / last_event_id /
                                            -- last_projection_mutation_id / pnl_percent）皆須不變
  END IF;
  ... （其餘同 v4.1，並改為 schema-qualified 呼叫 app_ledger.tr_econ_hash）
```

- `tr_econ_hash` 補入 **`signal_id`**；`last_event_id` / `last_projection_mutation_id` 不進 hash，但由上面的 full-row 比較保護，且只能由 guard 自己設定（guard 於 token 命中後覆寫 NEW 值，client 給什麼都被覆蓋）。
- 欄位級 GRANT 與 trigger 一致：`GRANT UPDATE (current_price, price_updated_at) ON public.trade_records TO service_role;`（無其他欄位 UPDATE 權）。`updated_at` 欄位 **不存在於 trade_records**（實查確認），故不列入。
- `cash_delta` 封閉：由 §E1 invariant (c) 與 cash_ledger guard 的 after_hash 雙重比對。

**Negative tests**：只改 `signal_id`、只改 `last_projection_mutation_id`、只改 `last_event_id`、改任一未納入 hash 的新欄位、同時改 `current_price` 與 `quantity` ⇒ 全部 raise；只改 `current_price` + `price_updated_at` ⇒ 通過。

---

## E4 append-only 改為 jsonb 全欄位比較

```sql
CREATE OR REPLACE FUNCTION app_ledger.effect_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE o jsonb; n jsonb;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'effect_delete_forbidden' USING ERRCODE='P0001'; END IF;
  o := to_jsonb(OLD) - 'state' - 'visible_at' - 'state_changed_at';
  n := to_jsonb(NEW) - 'state' - 'visible_at' - 'state_changed_at';
  IF o <> n THEN RAISE EXCEPTION 'effect_payload_immutable' USING ERRCODE='P0001'; END IF;

  IF NEW.state IS DISTINCT FROM OLD.state
     AND NOT ((OLD.state='reserved' AND NEW.state IN ('applied','failed'))
           OR (OLD.state='applied'  AND NEW.state='superseded'))
  THEN RAISE EXCEPTION 'effect_illegal_state_transition: % -> %', OLD.state, NEW.state
       USING ERRCODE='P0001'; END IF;

  IF NEW.visible_at IS DISTINCT FROM OLD.visible_at THEN
    IF OLD.visible_at IS NOT NULL THEN
      RAISE EXCEPTION 'visible_at_immutable_once_set' USING ERRCODE='P0001'; END IF;
    IF NEW.state <> 'applied' THEN
      RAISE EXCEPTION 'publish_requires_applied_state' USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;
```

- 重複 publish **idempotent no-op**：`canonical_publish` 先檢查 `visible_at IS NOT NULL` ⇒ 直接 return（不 UPDATE、不 replay、不報錯）。
- `quarantined` **移出 economic_effect**（否則等於 raw toggle）。改為獨立 append-only 表：

```sql
CREATE TABLE app_ledger.effect_review_event (
  review_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_effect_id uuid NOT NULL,
  review_state text NOT NULL CHECK (review_state IN ('manual_review','cleared','quarantined')),
  reason text NOT NULL, actor_user_id uuid NULL, actor_via text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
-- current state = 最新一列（view app_ledger.effect_review_current）
```

**Negative tests**：對 `economic_effect` 每一個非 whitelist 欄位（逐欄迴圈產生測試：`event_id, logical_effect_id, event_version, supersedes_event_id, expert_id, origin_signal_id, market, instrument, instrument_key, action, qty_delta, qty_unit, currency, cash_delta, price, fees, fee_model, effective_at, recorded_at, provenance, actor_user_id, actor_via, reason, expected_mutation_count, calc_model_version, effect_no, generation`）各做一次 direct UPDATE ⇒ 全部 raise。非法 state 轉移 4 種、重複 publish、publish 非 applied ⇒ 各一測試。

---

## E5 logical ID：禁止 delete/reinsert（採最安全做法）

- 已產生 economic effect（存在 `state IN ('applied','superseded')` 的 event）的 signal：**禁止 DELETE**。

```sql
CREATE OR REPLACE FUNCTION app_ledger.forbid_delete_applied_signal() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM app_ledger.economic_effect e
              WHERE e.logical_effect_id = OLD.logical_effect_id
                AND e.state IN ('applied','superseded'))
  THEN RAISE EXCEPTION 'signal_delete_forbidden_after_effect' USING ERRCODE='P0001'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_forbid_delete_applied_signal
  BEFORE DELETE ON public.expert_signals
  FOR EACH ROW EXECUTE FUNCTION app_ledger.forbid_delete_applied_signal();
```

- `save_signal_batch` 改 **in-place UPDATE**（不 delete+reinsert）。
- 未產生 effect 的 draft 被刪 ⇒ 新 draft 取得**新** `logical_effect_id`（可接受）。
- `restore_signal_logical_id` **刪除，不實作**（避免可偽造 bypass）。
- migration backfill（既有 173 signals 補 `logical_effect_id`）必須在安裝 immutability guard **之前**於同一 migration 內完成，順序：`ADD COLUMN → backfill UPDATE → SET NOT NULL → CREATE TRIGGER`。

**測試（真的執行 SQL）**：client 送同 expert 既有 UUID / 他人 UUID / 隨機 UUID ⇒ 全被 server-generate 覆蓋；delete 已 applied 的 signal ⇒ raise；delete 純 draft ⇒ 成功且新 draft 得新 id；backfill 順序在 ephemeral 實跑一次驗證。

---

## E6 SECURITY DEFINER 與角色能力

- 所有 SECURITY DEFINER 函式一律 `SET search_path = ''`，內部**全部 schema-qualify**（`public.xxx` / `app_ledger.xxx` / `pg_catalog.xxx`）。
- 每個函式建立後緊接：`REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC;` 再精準 `GRANT`。
- **RLS 誠實標示**：`service_role` **bypass RLS**（BYPASSRLS）。前版「service_role SELECT 受 RLS 限本人」為錯誤陳述，本版更正：service_role 可讀全部；防護靠**撤銷 DML 與 mutation table 全部權限**，不是靠 RLS。
- **`CREATE ROLE ledger_owner` 在 Supabase hosted 是否可行：UNPROVEN**（本輪未在 production 嘗試，也不會嘗試）。E0 gate：在 disposable environment 以「與 hosted 等價的權限模型」實跑；若不可行，替代方案為
  **owner = `postgres`（hosted 預設 migration 角色）+ 對 anon/authenticated/service_role 全面 REVOKE**，安全性差異（postgres 亦為 Edge 不可用角色）於報告中明列。二選一由 E0 實測結果決定，不預設。
- **proacl read-back tests**：對 `canonical_apply_effect`、`canonical_correct`、`canonical_publish`、`canonical_break_glass` 逐一斷言 `proacl` 不含 `=X/`(PUBLIC)，且 grantee 集合完全等於預期。
- **search_path shadow-object negative test**：在 `pg_temp` 或先於 `public` 的 schema 建立同名 `tr_econ_hash` / `trade_records`，斷言 definer 函式**不受影響**（因 `search_path=''` + schema-qualify）。

---

## E7 多幣與衍生品估值

**決議：base_currency + 逐幣分帳並存。** internal 與 public 皆逐 currency 分帳；另提供以 `base_currency`（expert 設定，實查現有 `experts.currency`）換算的合計，換算必須帶 FX as-of。

```sql
CREATE TABLE public.public_position_projection (
  projection_version bigint NOT NULL,      -- 見 E8
  expert_id uuid NOT NULL, instrument_key text NOT NULL, instrument text NOT NULL,
  market text NOT NULL, currency text NOT NULL,
  quantity integer NOT NULL, quantity_unit text NOT NULL,
  avg_cost numeric NOT NULL, cost_value numeric NOT NULL,
  valuation_price numeric NULL,            -- NULL = 無可用報價
  price_as_of date NULL, price_source text NULL,
  valuation_status text NOT NULL CHECK (valuation_status IN ('valued','stale','unpriced','unsupported')),
  market_value numeric NULL,               -- unpriced/unsupported ⇒ NULL，禁止 0
  fx_rate numeric NULL, fx_as_of timestamptz NULL, fx_source text NULL,
  provenance public.effect_provenance NOT NULL,
  PRIMARY KEY (projection_version, expert_id, instrument_key));

CREATE TABLE public.public_portfolio_state (
  projection_version bigint NOT NULL, expert_id uuid NOT NULL, currency text NOT NULL,
  starting_capital numeric NOT NULL,
  external_capital_flow_total numeric NOT NULL DEFAULT 0,
  data_correction_adjustment_total numeric NOT NULL DEFAULT 0,
  realized_pnl numeric NOT NULL DEFAULT 0, open_cost numeric NOT NULL,
  cash numeric NOT NULL, market_value numeric NULL,
  equity numeric NULL,                     -- 任一部位 unpriced ⇒ NULL（fail-closed）
  incomplete_reason text NULL,
  PRIMARY KEY (projection_version, expert_id, currency));

CREATE TABLE public.public_nav_daily (
  projection_version bigint NOT NULL, expert_id uuid NOT NULL, currency text NOT NULL,
  trade_date date NOT NULL, cash numeric NOT NULL, market_value numeric NULL,
  equity numeric NULL,
  external_capital_flow numeric NOT NULL DEFAULT 0,
  data_correction_adjustment numeric NOT NULL DEFAULT 0,
  daily_return numeric NULL,               -- 只扣 external_capital_flow
  price_as_of date NULL, fx_as_of timestamptz NULL,
  completeness text NOT NULL CHECK (completeness IN ('complete','partial','unavailable')),
  PRIMARY KEY (projection_version, expert_id, currency, trade_date));
```

**Accounting equation（逐 currency，全部 numeric，PG 內計算，禁 JS float）**

```text
cash_c   = starting_capital_c + external_flow_c + data_correction_c + realized_c − open_cost_c
equity_c = cash_c + market_value_c              （market_value_c 任一為 NULL ⇒ equity_c = NULL）
equity_base = Σ_c equity_c × fx(c → base, as_of)   （任一 fx 缺 ⇒ equity_base = NULL）
return  = (equity_t − equity_{t−1} − external_flow_t) / equity_{t−1}
          -- data_correction 不進 return 分子；restated 口徑另計（見 E8）
```

**日曆與 stale**：TW 用 `tw_market_holidays` 決定前一可用交易日；US 以 `daily_price_snapshots(market='US')` 實際有資料日為準。`price_as_of` 落後 > 5 個交易日 ⇒ `stale`；> 20 ⇒ `unpriced`。

**Fail-closed（依實查）**：

| 標的 | 現況 | 處置 |
| --- | --- | --- |
| TW 權證 4 筆 | dps 列數 3/5/12/25，極稀疏 | 依 stale threshold 判 `stale` 或 `unpriced`；不得補 0 |
| US combo 3 筆 | **無 combo 報價**，只有 underlying | `valuation_status='unsupported'`，`market_value=NULL`，**不得用 underlying 代替** |
| FX | `fx_rates` **只有一列現值、無歷史** | 歷史 NAV 的 FX **UNPROVEN** ⇒ 跨幣合計 `equity_base=NULL`，只出逐幣數字，直到補齊 FX 歷史來源 |

impact report 需列：各 expert 的 unpriced/unsupported 部位數、受影響 equity 比例、跨幣 expert 名單。

---

## E8 Versioned atomic public projection + 更正語意

- 三張 public 表皆帶 `projection_version bigint`（來自 `app_ledger.projection_version_seq`）。
- `canonical_publish` 或每日重算：在**同一 transaction** 內把受影響 expert 的 position + portfolio + **整段受影響 NAV 區間**寫成新 version（staging 即同表新 version），最後 atomic 切換：

```sql
CREATE TABLE public.public_projection_active (
  id int PRIMARY KEY DEFAULT 1 CHECK (id=1),
  active_version bigint NOT NULL, activated_at timestamptz NOT NULL DEFAULT now());
-- 前端一律先讀 active_version，所有查詢帶該 version（或走 view public_*_active）
-- 失敗/延遲 ⇒ active_version 不動 ⇒ 公開頁維持上一完整版本，絕不混讀
-- 舊 version 保留 N=3 份供回退，其餘由 owner job 清除
```

commit 前不切換 ⇒ 不會出現「持股新、績效舊」。

**更正語意分離（不再把 correction 塞進 capital flow）**

| 類型 | 欄位 | 是否影響 return |
| --- | --- | --- |
| `external_capital_flow` | 真實入出金 | 從分子扣除（標準 TWR） |
| `data_correction_adjustment` | 帳務更正（quantity/cost 修正） | **as-reported**：不改歷史、不進 return，僅當日揭露；**restated**：整段區間重播後 return 改變 |

**Product decision gate**：as-reported vs restated 為你的決策，Phase 1 只提供兩套數字與**兩套測試**（同一 fixture 下分別斷言歷史 return 不變 / 已重播）。

---

## E0 acceptance（只在 ephemeral PG）

先紅後綠，涵蓋 §E1–E8 全部 negative/transactional tests，另加：

- E1 六個「張數對但經濟錯」測試；cash_ledger append-only。
- E2 同 transaction 多步與逐 event replay 等價。
- E3 五個 whitelist negative tests。
- E4 逐欄位（27 欄）immutability 測試 + 重複 publish idempotent。
- E5 四個 logical id 測試 + delete 禁止 + backfill 順序實跑。
- E6 proacl read-back + shadow-object + `CREATE ROLE` 能力測試（決定 owner 方案）。
- E7 多幣：TWD/USD 分帳、unpriced/unsupported 為 NULL 不為 0、FX 缺歷史時 `equity_base=NULL`。
- E8 versioned activate：replay 失敗時 active_version 不變、公開頁讀到完整舊版；as-reported / restated 兩套。
- 併發、blast radius（advisor T+0、11 mentor、TW 權證、US combo、publish-weekly-journals、export、factsheet），全部 fixture，**不 hard-code production UID**。

E0 通過條件：全綠 + `schema_hash`/`function_hash`/grants diff 記錄 + production 零觸碰。

---

## Production impact report（仍只讀，沿用 v4.1 八項）並新增

9. 逐 expert 的 currency 組合與跨幣人數；
10. unpriced / unsupported / stale 部位清單與其占 equity 比重；
11. FX 歷史缺口對哪些日期的 NAV 造成 `unavailable`。

---

## UNPROVEN → E0 fail-closed gate

1. **FX 歷史**：`fx_rates` 無日期維度、僅 1 列 ⇒ 跨幣歷史 NAV 不可算 ⇒ `equity_base=NULL`。
2. **US combo 估值**：無 combo 報價 ⇒ `unsupported`。
3. **TW 權證報價完整度**：dps 3–25 列，判 stale/unpriced。
4. **Supabase hosted `CREATE ROLE`/`OWNER TO` 能力**：未測，E0 決定 owner 方案。
5. **`trade_records.quantity` 為 integer**：碎股/crypto 小數不支援，fail-closed。
6. **`pnl_percent` 由誰寫**：E0 決議經濟路徑獨佔、price worker 停寫，需你確認此行為變更。
7. **`recall / taken_down` 語意**：仍無 domain evidence，只停止自動反轉，model-based test 不含 recall。
8. **`calculate_expert_performance` 內部演算法**：未逐行審，public NAV 對照待 impact report 實測。

---

## STOP

未經再次審核：不得改 code、production、6515、26 筆 drift、前端、RLS/ACL/Edge，不得 Publish，不得進 R0。
本次僅提交 Plan v4.2 供審核。
