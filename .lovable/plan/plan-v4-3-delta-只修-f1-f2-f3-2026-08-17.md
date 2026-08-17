# Plan v4.3 — delta（只修 F1／F2／F3）

只讀產出。未改 code / production / 6515 / 26 drift / 前端 / RLS / ACL / Edge，未 Publish。以下僅取代 v4.2 對應段落，其餘 v4.2 內容不變。

Disposable PG 能力實查（本輪已驗）：sandbox 內有 `postgres 17.9` / `initdb` / `pg_ctl`（`/bin`），可 initdb 建立完全獨立、與 connected production 無關的 ephemeral cluster。E0 將在此執行，不觸碰 production。

---

## F1 — active pointer 改為 per-expert（定案）

Global `id=1` pointer 廢除。

```sql
CREATE TABLE public.public_projection_active (
  expert_id uuid PRIMARY KEY,
  active_version bigint NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now());

CREATE VIEW public.public_position_active AS
  SELECT p.* FROM public.public_position_projection p
  JOIN public.public_projection_active a
    ON a.expert_id = p.expert_id AND a.active_version = p.projection_version;
-- public_portfolio_active / public_nav_active 以完全相同的 join 定義
```

- `projection_version` 仍取自全域 `app_ledger.projection_version_seq`（單調、跨 expert 唯一），但**只對受影響 expert** 寫新版並切換其 pointer；其他 expert 的 pointer / rows 一個位元都不動。
- 前端與 factsheet 一律讀 `public_*_active` view（禁止直接讀 base table 或自行帶 version）。
- 序列化：`canonical_publish` 開頭 `PERFORM pg_advisory_xact_lock(hashtextextended('proj:'||expert_id::text, 0));` 同 expert 序列化、不同 expert 並行。切換 pointer 用 `INSERT ... ON CONFLICT (expert_id) DO UPDATE`，且加 `WHERE public_projection_active.active_version < EXCLUDED.active_version`（版本單調，防舊版覆蓋新版）。
- 舊版保留 N=3，由 owner job 清；清理不得刪除任何 pointer 指向的版本。

**必測**
1. 只 publish A：B 的 `active_version`、rows count、`md5(全表快照)` 完全不變（逐 expert hash 斷言）。
2. A replay 於 commit 前失敗：A 與 B 的 pointer 與 rows 皆維持舊版（A 仍可完整讀）。
3. A、B 同時 publish（兩 session）：互不阻塞、互不覆蓋，各自 pointer 正確。
4. 同 expert 兩個 concurrent publish：第二個等鎖，最終 `active_version` = 較大者，無交錯資料。
5. 舊版清理後 active 版本仍完整可讀。

---

## F2 — correction / cash / return 精確分離（修正矛盾）

### 分類與 cash 影響（exact）

| correction 類型 | cash ledger | cash equation | daily_return（as-reported） |
| --- | --- | --- | --- |
| `quantity_adjustment` / cost-only（`cash_delta IS NULL`） | **不得寫任何 cash leg** | cash **不變**；只改 `open_cost` / `avg_cost` | 該日 `daily_return = NULL`，`completeness='partial'`，`correction_flag=true` |
| `historical_fill`（補登遺漏的真實成交） | **必須**有 `entry_kind='trade_settlement'` cash leg | 按 §E1 (c)(d) 守恆：買 = −qty×price，賣 = +qty×price（含 fees） | 視同該成交當日的正常交易，**照常計入 return**（不是 correction） |
| `equity_bridge`（可證明的期初餘額／對帳差額） | `entry_kind='data_correction_adjustment'` | cash 變動 | 從分子**扣除** bridge 金額以中和；`correction_flag=true` |

三者的 `reason` 與 `provenance` 必填且互斥（`effect_provenance` 擴充 `historical_fill` / `equity_bridge` / `quantity_adjustment`），**不得**以 `external_capital_flow` 冒充。

### as-reported（exact 定義）

```text
numerator_t = equity_t − equity_{t−1} − external_flow_t − data_correction_adjustment_t
daily_return_t = numerator_t / equity_{t−1}

若當日存在 quantity_adjustment / cost-only correction（cash 未變但 equity 因成本/持股修正而跳動）：
  daily_return_t := NULL, completeness := 'partial', correction_flag := true
若僅存在 equity_bridge：以上式中和後照常輸出數值，correction_flag := true
歷史（t−1 以前）一律不改寫
```

### restated

從最早受影響交易日起，以更正後 effect 完整 replay 到今天，覆寫該區間 NAV（新 `projection_version`），`daily_return` 全部重算，不使用中和項。

`public_nav_daily` 新增 `correction_flag boolean NOT NULL DEFAULT false`、`correction_kind text NULL`、`reporting_basis text NOT NULL CHECK (reporting_basis IN ('as_reported','restated'))`。兩套並存、同 fixture 各自斷言。

**必測（逐欄 expected values，三種 correction 各一組）**
- quantity_adjustment：`cash` 前後相等（斷言完全相同的 numeric）、`open_cost` 依修正變動、`equity` 跳動、`daily_return IS NULL`、`completeness='partial'`、無任何 cash ledger 列新增。
- historical_fill（買 100@10）：`cash −1000`、`open_cost +1000`、`equity` 不變（現金換庫存）、`daily_return` 正常計算、cash ledger 恰 1 列 `trade_settlement`。
- equity_bridge（+5000）：`cash +5000`、`equity +5000`、`daily_return` 中和後等於無 bridge 情境的值（斷言兩 fixture 數值相等）、cash ledger 恰 1 列 `data_correction_adjustment`。
- restated 對照：同三組 fixture 下歷史 return 被重算且與 as-reported 不同，斷言差異位置與筆數。

---

## F3 — NOT NULL / IS DISTINCT FROM / review chain

### mutation context 欄位（exact）

```sql
ALTER TABLE app_ledger.effect_projection_mutation
  ALTER COLUMN event_id      SET NOT NULL,
  ALTER COLUMN mutation_seq  SET NOT NULL,
  ALTER COLUMN target_table  SET NOT NULL,
  ALTER COLUMN target_row_id SET NOT NULL,     -- 所有 op（含 insert，UUID 由 canonical 預配）
  ALTER COLUMN op            SET NOT NULL,
  ALTER COLUMN row_role      SET NOT NULL,
  ALTER COLUMN expert_id     SET NOT NULL,
  ALTER COLUMN currency      SET NOT NULL,
  ALTER COLUMN qty_delta     SET NOT NULL,
  ADD CONSTRAINT epm_seq_pos      CHECK (mutation_seq >= 1),
  ADD CONSTRAINT epm_role_ck      CHECK (row_role IN ('open_position','closed_lot','cash_leg')),
  ADD CONSTRAINT epm_cash_ck      CHECK ((row_role='cash_leg') = (target_table='portfolio_cash_ledger')),
  ADD CONSTRAINT epm_cashdelta_ck CHECK ((row_role='cash_leg') = (cash_delta IS NOT NULL)),
  ADD CONSTRAINT epm_cash_qty_ck  CHECK (row_role <> 'cash_leg' OR qty_delta = 0),
  ADD CONSTRAINT epm_market_ck    CHECK (row_role='cash_leg' OR market IS NOT NULL),
  ADD CONSTRAINT epm_ikey_ck      CHECK (row_role='cash_leg' OR instrument_key IS NOT NULL),
  ADD CONSTRAINT epm_before_ck    CHECK ((op='insert') = (before_hash IS NULL)),
  ADD CONSTRAINT epm_after_ck     CHECK ((op='delete') = (after_hash IS NULL));
```

`assert_effect_semantics` 的 (a) 改為全 `IS DISTINCT FROM`：

```sql
IF EXISTS (SELECT 1 FROM app_ledger.effect_projection_mutation m
            WHERE m.event_id = e.event_id
              AND (m.expert_id IS DISTINCT FROM e.expert_id
                OR m.currency  IS DISTINCT FROM e.currency
                OR (m.row_role <> 'cash_leg' AND
                    (m.market IS DISTINCT FROM e.market
                  OR m.instrument_key IS DISTINCT FROM e.instrument_key)))) THEN ...
```

guard 端：`insert` 時斷言 `NEW.id = token.target_row_id`（預配 UUID 必須一致），否則 `RAISE 'insert_token_row_mismatch'`。

### review chain（deterministic）

```sql
ALTER TABLE app_ledger.effect_review_event
  ADD COLUMN review_no bigint NOT NULL,
  ADD CONSTRAINT ere_unique UNIQUE (logical_effect_id, review_no);
-- review_no 由 canonical 以 SELECT coalesce(max(review_no),0)+1 ... FOR UPDATE 於
-- pg_advisory_xact_lock(hashtextextended('review:'||logical_effect_id::text,0)) 內取得

CREATE VIEW app_ledger.effect_review_current AS
  SELECT DISTINCT ON (logical_effect_id) *
  FROM app_ledger.effect_review_event
  ORDER BY logical_effect_id, review_no DESC;
```

- append-only trigger：`UPDATE`/`DELETE` 一律 raise。
- `REVOKE ALL ON app_ledger.effect_review_event FROM anon, authenticated, service_role;` 僅 owner + SECURITY DEFINER canonical 可寫。
- transition matrix（以 current state 判斷，非法者 raise `illegal_review_transition`）：

| from \ to | manual_review | cleared | quarantined |
| --- | --- | --- | --- |
| (none) | 允許 | 拒絕 | 允許 |
| manual_review | 拒絕（重複） | 允許 | 允許 |
| cleared | 允許 | 拒絕 | 允許 |
| quarantined | 允許 | 拒絕（須先 manual_review） | 拒絕 |

**必測**
1. 每個 NOT NULL / CHECK 各一筆違規 insert ⇒ 全 raise（含 cash_leg 帶 instrument_key、非 cash_leg 缺 market、insert 帶 before_hash 等）。
2. token 的 `expert_id`/`currency`/`market`/`instrument_key` 設為 NULL 企圖繞過 (a) ⇒ 現在被 NOT NULL/CHECK 或 IS DISTINCT FROM 擋下。
3. insert token 的 `target_row_id` 與實際 insert 的 id 不同 ⇒ `insert_token_row_mismatch`。
4. 同 `logical_effect_id` 併發兩筆 review ⇒ `review_no` 不重複、view 結果確定；相同 `created_at` 亦確定。
5. transition matrix 12 格逐格測試（合法通過、非法 raise）。
6. review event UPDATE/DELETE ⇒ raise；以 `service_role` 直接寫 ⇒ permission denied。

---

## E0 申請範圍（唯一申請項）

只申請在 **sandbox 內以 `initdb` 建立的 disposable ephemeral PostgreSQL 17.9 cluster** 執行 build + tests（v4.2 的 E0 全部測試 + 本 delta 的 F1/F2/F3 測試），先紅後綠，輸出 schema/function/grants hash 與測試報告。

若該 disposable cluster 無法提供與 Supabase 等價的行為（例如 role/擴充/權限模型無法對齊），立即 **STOP / BLOCKED** 並回報，**不得**以 connected production 當測試環境。

任何情況下不得：改 production、改 6515、改 26 筆 drift、改前端、改 ACL/RLS/Edge Function、執行 Publish、進入 R0。
