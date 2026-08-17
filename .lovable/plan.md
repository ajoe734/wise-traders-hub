# Plan v4 — Final closure plan（signal → model portfolio → performance）

Read-only 產出。未改任何 code / DB / trigger / RPC / 資料，未 Publish。6515 與 26 筆 drift 未動。
以下 SQL 為 **Phase 1 ephemeral 用的可執行 DDL**，不對 production 執行。

---

## 0. Preflight 實查結果（C5 全部解掉）

| 查證項 | 結果 | 影響 |
| --- | --- | --- |
| 同 `expert_id + market + upper(btrim(split_part(instrument,' ',1)))` 的多筆 open | **dup_groups = 0，dup_rows = 0** | partial UNIQUE **可加**，無需 merge、無需 quarantine 這一項 |
| trade_records 分布 | TW/TWD 56 列（56 列含空白分隔名稱，17 列符合 5–6 碼型態）；US/USD 26 列（12 列含空白） | 兩市場皆可解析 |
| TW 權證 open | 4 筆：`068003 國巨統一75購01`、`071745 T50正2台新66購01`、`078397 同欣電富邦64購02`、`079052 樺漢元大64購03`，unit 皆 `張` | 權證 = 6 碼數字，`split_part` 無 collision |
| US 選擇權 combo open | 3 筆：`LUNR 11/8P + 16/19C`、`RKLB 57.5/47.5P + 77.5/87.5C`、`SNDK 950/925P + 1600/1625C`，unit 皆 `組` | **collision 風險成立**：`split_part` 會把 combo 併到 underlying 股票 key（目前尚無同代號現股 open，屬潛在而非現存） |
| 既有 stable instrument id | **不存在**。只有 `stock_names`、`crypto_symbol_map`；`trade_records` 無 instrument id 欄位 | 需自建 instrument key，見 §5 |
| `expert_signals.status` 現況 | `published` 173、`pending` 0 | pending 為短暫狀態；embargo 期間仍會產生公開可見部位（v3 已證） |
| experts role | mentor 11、advisor 1 | advisor T+0 路徑必須回歸（C4） |
| table ACL（`pg_class.relacl`） | `trade_records / expert_signals / trade_signals / user_performances / signal_trade_applications` 對 **anon 與 authenticated 皆為 `arwdDxtm`（全權限）** | **C2 核心缺陷確認**：目前唯一保護是 RLS；privilege 收斂是必要且非小改 |
| SECDEF 函式 EXECUTE | `admin_delete_trade_records_by_signal_ids`、`admin_delete_trade_records_by_symbol`、`admin_trade_dedupe_sweep`、`admin_apply_fix_proposal` 對 **anon 亦可 EXECUTE**；`handle_signal_trade`/`handle_signal_takedown` 僅 postgres/service_role | 需 REVOKE，見 §2 |

UNPROVEN 收斂：

- `recall / taken_down` 語意：仍 UNPROVEN → **Phase 2 只做「停止自動反轉」**，`handle_signal_takedown` 的 economic 反轉改為產生 `manual_review` 待辦，visibility 行為完全不變。model-based test **不隨機產生 recall**（無 oracle 不測）。
- US option combo instrument key：Phase 2 **不支援** combo 拆腿；以完整字串為 key（見 §5），未知型態 fail-closed。

---

## 1. Exact DDL（C1，可在 ephemeral PG 直接執行）

順序：`01_instrument` → `02_ledger` → `03_projection_mutation` → `04_guards` → `05_grants_rls` → `06_public_projection`。

```sql
-- 01_instrument.sql -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.norm_instrument_key(_market text, _instrument text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    -- US combo/option：整串正規化，禁止併入 underlying
    WHEN upper(coalesce(_market,'TW')) = 'US' AND _instrument ~ '[0-9]+/[0-9.]+[PC]'
      THEN 'US:OPT:' || upper(regexp_replace(btrim(_instrument), '\s+', ' ', 'g'))
    WHEN upper(coalesce(_market,'TW')) = 'US'
      THEN 'US:EQ:'  || upper(btrim(split_part(_instrument, ' ', 1)))
    WHEN upper(coalesce(_market,'TW')) = 'TW'
      THEN 'TW:'     || upper(btrim(split_part(_instrument, ' ', 1)))
    ELSE NULL          -- 未知市場 → NULL → 由 guard fail-closed
  END
$$;

ALTER TABLE public.trade_records
  ADD COLUMN instrument_key text
  GENERATED ALWAYS AS (public.norm_instrument_key(market, instrument)) STORED;

CREATE UNIQUE INDEX trade_records_one_open_per_instrument
  ON public.trade_records (expert_id, instrument_key)
  WHERE status = 'open';          -- preflight 證實現況 0 違反

-- 02_ledger.sql -----------------------------------------------------------
CREATE TYPE public.effect_state AS ENUM ('reserved','applied','superseded','failed');
CREATE TYPE public.effect_provenance AS ENUM ('legacy_unverified_baseline','post_cutover_proven_effect');

CREATE TABLE public.economic_effect (
  event_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_effect_id   uuid NOT NULL,
  event_version       int  NOT NULL CHECK (event_version >= 1),
  supersedes_event_id uuid NULL REFERENCES public.economic_effect(event_id) DEFERRABLE INITIALLY IMMEDIATE,
  expert_id           uuid NOT NULL REFERENCES public.experts(id),
  origin_signal_id    uuid NULL,                       -- provenance only；無 FK cascade
  market              text NOT NULL CHECK (market IN ('TW','US')),
  instrument          text NOT NULL,
  instrument_key      text NOT NULL,
  action              text NOT NULL CHECK (action IN
                        ('buy','add','trim','sell','exit',
                         'historical_fill','quantity_adjustment','capital_adjustment')),
  qty_delta           numeric NOT NULL,                -- 部位增減（股/張已正規化為最小單位）
  qty_unit            text NOT NULL,
  cash_delta          numeric NULL,                    -- quantity_adjustment 時為 NULL
  price               numeric NULL,
  fee_model           text NOT NULL DEFAULT 'not_modeled',
  fees                numeric NULL,                    -- 一律 NULL，禁止填 0
  effective_at        timestamptz NOT NULL,            -- executed_at
  visible_at          timestamptz NULL,                -- published_at；NULL = embargoed
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  state               public.effect_state NOT NULL DEFAULT 'reserved',
  provenance          public.effect_provenance NOT NULL,
  quarantined         boolean NOT NULL DEFAULT false,
  actor_user_id       uuid NULL,
  actor_via           text NOT NULL CHECK (actor_via IN ('authenticated','service_role','break_glass','migration')),
  reason              text NULL,
  calc_model_version  int NOT NULL DEFAULT 1,
  CONSTRAINT effect_version_unique UNIQUE (logical_effect_id, event_version),
  CONSTRAINT effect_v1_no_parent CHECK (
    (event_version = 1 AND supersedes_event_id IS NULL) OR
    (event_version > 1 AND supersedes_event_id IS NOT NULL)),
  CONSTRAINT effect_fees_not_zero CHECK (fees IS NULL OR fees > 0),
  CONSTRAINT effect_key_matches CHECK (instrument_key = public.norm_instrument_key(market, instrument))
);

-- current active head：每條 chain 至多一個 applied
CREATE UNIQUE INDEX effect_one_applied_head
  ON public.economic_effect (logical_effect_id) WHERE state = 'applied';
-- 防 branching：一個被 supersede 的 event 只能有一個後繼
CREATE UNIQUE INDEX effect_one_successor
  ON public.economic_effect (supersedes_event_id) WHERE supersedes_event_id IS NOT NULL;
-- 同 chain / 較小 version / 非自指（cycle 不可能：version 嚴格遞減且 v1 無 parent）
CREATE OR REPLACE FUNCTION public.effect_chain_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
  IF NEW.supersedes_event_id IS NOT NULL THEN
    IF NEW.supersedes_event_id = NEW.event_id THEN
      RAISE EXCEPTION 'effect_self_reference' USING ERRCODE='P0001';
    END IF;
    SELECT logical_effect_id, event_version, state INTO p
      FROM public.economic_effect WHERE event_id = NEW.supersedes_event_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'effect_parent_missing' USING ERRCODE='P0001'; END IF;
    IF p.logical_effect_id <> NEW.logical_effect_id THEN
      RAISE EXCEPTION 'effect_chain_mismatch' USING ERRCODE='P0001'; END IF;
    IF p.event_version >= NEW.event_version THEN
      RAISE EXCEPTION 'effect_version_not_increasing' USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_effect_chain_guard BEFORE INSERT OR UPDATE ON public.economic_effect
  FOR EACH ROW EXECUTE FUNCTION public.effect_chain_guard();
```

**Correction transaction（concurrent 只有一個成功）**

```sql
-- canonical_correct(_head_event_id uuid, ... ) 內部：
--   1) SELECT ... FROM economic_effect WHERE event_id=_head_event_id AND state='applied' FOR UPDATE;
--      找不到 → RAISE 'effect_head_stale'
--   2) pg_advisory_xact_lock(hashtext(expert_id::text), hashtext(instrument_key));
--   3) UPDATE economic_effect SET state='superseded' WHERE event_id=_head_event_id AND state='applied';
--   4) INSERT 新 row (logical_effect_id 相同, event_version=head.version+1,
--        supersedes_event_id=_head_event_id, state='applied');
--   5) 依 delta 更新 projection（§2 的 projection_mutation 機制）
-- 兩個 concurrent correction：其一被 (1) 的 FOR UPDATE 擋住 → 醒來時 state 已非 'applied'
--   → 'effect_head_stale' 失敗；即使繞過，effect_one_successor 與 effect_one_applied_head
--     兩個 partial unique index 也會在 commit 前擋下第二筆。
```

**expert_signals.logical_effect_id（first-write-wins、client 不可指定）**

```sql
ALTER TABLE public.expert_signals ADD COLUMN logical_effect_id uuid;
CREATE UNIQUE INDEX expert_signals_logical_effect_uniq
  ON public.expert_signals (logical_effect_id) WHERE logical_effect_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.signals_logical_id_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- client 送什麼都忽略；只有 canonical 以 session role = service_role/definer 呼叫
    -- 的 restore 路徑可帶入既有 id（必須同 expert 且尚未有 applied effect）
    IF NEW.logical_effect_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.economic_effect e
                      WHERE e.logical_effect_id = NEW.logical_effect_id
                        AND e.expert_id = NEW.expert_id)
      THEN NEW.logical_effect_id := gen_random_uuid(); END IF;
    ELSE
      NEW.logical_effect_id := gen_random_uuid();
    END IF;
  ELSE
    IF NEW.logical_effect_id IS DISTINCT FROM OLD.logical_effect_id THEN
      RAISE EXCEPTION 'logical_effect_id_immutable' USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
```

**draft delete/reinsert server-side 保存**：`save_signal_batch` 改為不 delete；若必須重建，canonical 在同一 transaction 內先把舊列的 `logical_effect_id` 讀進暫存並於 reinsert 時由**伺服器端**帶回（client payload 的該欄位一律丟棄）。`economic_effect.origin_signal_id` 不設 FK cascade，signal 被刪不影響 ledger。

---

## 2. Privilege / RLS matrix（C2，取代 GUC guard）

GUC 方案**作廢**。改為「權限 + 不可偽造的 transaction-local mutation token」。

### 2.1 Table privileges（Phase 2 目標狀態）

| 表 | anon | authenticated | service_role |
| --- | --- | --- | --- |
| `trade_records` | **REVOKE ALL**（僅 public projection view 可讀） | **SELECT only** | ALL |
| `expert_signals` | REVOKE ALL | SELECT + UPDATE(僅文字欄位，見 §4 B8 trigger) | ALL |
| `economic_effect` | REVOKE ALL | **SELECT only**（RLS 限本人 expert） | ALL |
| `effect_projection_mutation` | REVOKE ALL | REVOKE ALL | ALL |
| `trade_signals` / `user_performances` | REVOKE ALL | SELECT only | ALL |
| canonical RPC（`canonical_apply_effect`、`canonical_correct`、`canonical_publish`） | REVOKE | GRANT EXECUTE | GRANT EXECUTE |
| `admin_delete_trade_records_*`、`admin_trade_dedupe_sweep`、`admin_apply_fix_proposal`、`trade_dedupe_sweep` | **REVOKE（現況 anon 可執行）** | REVOKE | REVOKE（改由 break-glass RPC） |

現況 `arwdDxtm` for anon/authenticated 已由 preflight 證實；收斂為上表是 Phase 2 的必要工作。

### 2.2 不可偽造的 integrity 機制（exact）

```sql
CREATE UNLOGGED TABLE public.effect_projection_mutation (
  projection_mutation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL UNIQUE REFERENCES public.economic_effect(event_id),
  expert_id    uuid NOT NULL,
  market       text NOT NULL,
  instrument_key text NOT NULL,
  qty_delta    numeric NOT NULL,
  cash_delta   numeric NULL,
  txid         bigint NOT NULL DEFAULT txid_current(),
  consumed     boolean NOT NULL DEFAULT false
);

-- economic mutation guard：任何改動經濟欄位的 UPDATE/INSERT/DELETE 必須配對一張未消耗的 token，
-- 且 token 的 expert/market/instrument_key/qty_delta 必須與 OLD→NEW 完全吻合。
CREATE OR REPLACE FUNCTION public.trade_records_economic_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d numeric; t record;
BEGIN
  IF TG_OP='UPDATE' AND NOT (
      NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.quantity_unit IS DISTINCT FROM OLD.quantity_unit
   OR NEW.entry_price IS DISTINCT FROM OLD.entry_price OR NEW.exit_price IS DISTINCT FROM OLD.exit_price
   OR NEW.status IS DISTINCT FROM OLD.status OR NEW.exit_date IS DISTINCT FROM OLD.exit_date
   OR NEW.instrument IS DISTINCT FROM OLD.instrument)
  THEN RETURN NEW; END IF;                    -- price-only worker 放行（§5 白名單欄位）

  d := CASE TG_OP WHEN 'INSERT' THEN NEW.quantity
                  WHEN 'DELETE' THEN -OLD.quantity
                  ELSE NEW.quantity - OLD.quantity END;

  SELECT * INTO t FROM public.effect_projection_mutation
   WHERE consumed = false AND txid = txid_current()
     AND expert_id = COALESCE(NEW.expert_id, OLD.expert_id)
     AND instrument_key = COALESCE(NEW.instrument_key, OLD.instrument_key)
     AND qty_delta = d
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'economic_write_requires_canonical_event' USING ERRCODE='P0001';
  END IF;
  UPDATE public.effect_projection_mutation SET consumed = true
   WHERE projection_mutation_id = t.projection_mutation_id;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_tr_economic_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.trade_records
  FOR EACH ROW EXECUTE FUNCTION public.trade_records_economic_guard();

-- transaction 結束前，未消耗的 token 一律視為錯誤（防「開 token 不用」與 replay）
CREATE CONSTRAINT TRIGGER trg_mutation_settled
  AFTER INSERT ON public.effect_projection_mutation
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.assert_mutation_consumed();
```

- token 只能由 canonical function 產生（`effect_projection_mutation` 無 anon/authenticated 權限、canonical 為 DEFINER）。
- `event_id UNIQUE` ⇒ **同一 event 一生只能套一次**（reuse old event_id 直接違反 UNIQUE）。
- `expert_id` 由 event 帶入並比對 `trade_records.expert_id` ⇒ cross-tenant event_id 失敗。
- `txid_current()` 綁定 ⇒ 跨 transaction replay 失敗。
- 不使用任何 GUC；`set_config` 無法偽造 token（無寫權限）。

### 2.3 break-glass

`admin_break_glass_write(_expert_id, _payload jsonb, _reason text)`：僅 `service_role` 可 EXECUTE，強制 `_reason` 非空、寫 `audit_logs`（actor、reason、before/after）、同時產生一筆 `provenance='post_cutover_proven_effect'` 的 correction event。**禁止 raw UPDATE**。company_admin 一律走 `canonical_correct`。

### 2.4 Negative tests（必須全紅→綠）

1. `select set_config('app.canonical_write','on',true)` 後直接 UPDATE quantity ⇒ raise。
2. 重複使用已 applied 的 `event_id` ⇒ UNIQUE 違反。
3. 用 expert A 的 event_id 去改 expert B 的列 ⇒ raise。
4. 直接呼叫 `admin_delete_trade_records_by_symbol` / `trade_dedupe_sweep`（anon 與 authenticated）⇒ EXECUTE denied。
5. authenticated 直接 `INSERT INTO trade_records` ⇒ permission denied。
6. 產生 token 但不寫 projection ⇒ commit 時 deferred constraint raise。

---

## 3. Internal vs Public projection + consumer matrix（C3）

**選擇：獨立 published projection 表**（不是同表加欄位、不是 RLS 切列）。理由：`trade_records` 是 embargoed+published 混合後的 current aggregate，無法安全切。

```sql
CREATE TABLE public.public_position_projection (
  expert_id uuid NOT NULL REFERENCES public.experts(id),
  instrument_key text NOT NULL,
  instrument text NOT NULL,
  market text NOT NULL,
  quantity numeric NOT NULL,
  quantity_unit text NOT NULL,
  avg_cost numeric NOT NULL,
  realized_pnl numeric NOT NULL DEFAULT 0,
  last_visible_event_id uuid NOT NULL REFERENCES public.economic_effect(event_id),
  provenance public.effect_provenance NOT NULL,
  quarantined boolean NOT NULL DEFAULT false,
  as_of timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (expert_id, instrument_key)
);
-- 更新時機：只在 event 的 visible_at 由 NULL → 非 NULL（canonical_publish）時，
--   於同一 transaction replay 該 chain 的 visible events 一次寫入。
-- 沒有 cache：projection 表本身即快取；無背景 job、無 TTL、無 invalidation 競態。
-- 若 replay 失敗 → 整個 publish transaction rollback（fail-closed，寧可不公開）。
```

RLS/grant：`anon, authenticated SELECT`，`quarantined = false` 才對外顯示數字；`quarantined = true` 顯示「帳務待確認」且不計入總計。

### Consumer matrix

| consumer | 讀哪個 projection | 備註 |
| --- | --- | --- |
| public expert page（`/expert/:slug` 未登入） | **public** | 現行讀 `trade_records`（anon 政策）→ 改讀 public projection |
| 績效圖 / 排行榜（公開） | **public** | NAV 以 visible events replay |
| factsheet / PDF 下載（公開連結） | **public** | 與頁面同源 |
| weekly export（老師本人 / admin） | **internal** | 含 embargoed |
| `get_expert_capital_status()` | **internal**，但新增 `_scope text default 'internal'`；anon 呼叫強制 `public` | 現況 anon 可 EXECUTE，必須分流 |
| 週記管理 / SignalEditor（老師本人） | internal | |
| admin performance / 稽核頁 | internal + 雙口徑（verified / quarantined） | |
| 訂閱者頁（已訂閱） | public（+ 其訂閱可見範圍） | 不得看到 embargoed |

**Legacy baseline 對外處理（誠實原則）**：`legacy_unverified_baseline` 的部位在 public projection 標 `quarantined=true`，UI 顯示「帳務待確認」、數字以次級樣式呈現，**不計入公開總計**；公開頁同時揭露 verified 與 quarantined 兩個口徑。不得把污染 baseline 當 verified。

**測試**：embargoed effect 套用後 internal NAV 改變、public quantity/NAV **不變**；`canonical_publish` 後 public **一次**更新到位；匿名 RLS 收斂後公開頁仍可正常渲染（無空白、無 403）。

---

## 4. Writer disposition final（C4，無「或」）

| writer | 最終處置 |
| --- | --- |
| `handle_signal_trade()` trigger | **DISABLE**，功能移入 `canonical_apply_effect` |
| `handle_signal_takedown()` | **改為 manual_review-only**：不再反轉部位，只寫待辦；visibility 行為不變 |
| `save_signal_batch()` | **ROUTE**：不再 delete+reinsert 已 applied 的 signal；economic 欄位變更回 `requires_correction_event` |
| `admin_apply_fix_proposal()` | **ROUTE** 至 `canonical_correct` |
| `admin_delete_trade_records_by_signal_ids()` | **DISABLE**（REVOKE + 函式體改 raise） |
| `admin_delete_trade_records_by_symbol()` | **DISABLE** |
| `admin_signal_dupe_trades_fix()` | **DISABLE** |
| `admin_trade_dedupe_sweep()` / `trade_dedupe_sweep()` | **DISABLE** |
| `realign_instrument_unit()` | **DISABLE**，改由 `canonical_correct(action='quantity_adjustment')` |
| Edge `reconcile-warrant-quantities` | **ROUTE**（二選一已定）。依據：4 筆權證 open 皆 `unit='張'`、6 碼代號、instrument_key 無 collision ⇒ 改呼叫 `canonical_correct(action='quantity_adjustment', cash_delta=NULL)`，部位數字結果與現行一致，僅多一筆 event。回歸測試對這 4 筆做 before/after 逐列比對。 |
| Edge `daily-performance` / `stock-price-sync` / `daily-snapshot` / `tw-bsr-*` | **price-only whitelist**：僅允許 `current_price`、`pnl`、`pnl_percent`、`updated_at`；guard 對非經濟欄位直接 RETURN（§2.2 已實作），不會誤擋 |
| Edge `publish-weekly-journals` → `syncTradeSignals`（寫 `trade_signals` + `user_performances`） | **ROUTE**：改為 `canonical_publish` 的下游 projection，不得獨立 close/delete |

### Blast-radius / compatibility matrix

| 情境 | 回歸斷言 |
| --- | --- |
| mentor T+7：draft → embargoed → published | effect 恰一次；effective_at = executed_at；public 只在 publish 後變動 |
| advisor T+0（1 位 advisor）：INSERT 即 published | 單一 transaction 內 apply + publish，effect 恰一次，public 立即更新 |
| 其他 10 位 mentor | 既有 open 部位數量/成本 before==after（純 prevention，不改歷史） |
| TW 市場（56 列）／US 市場（26 列） | instrument_key 全部非 NULL；partial UNIQUE 不衝突 |
| TW 權證 4 筆 | reconcile route 後數量不變 |
| US option combo 3 筆 | key 為 `US:OPT:...`，不與 underlying 合併 |
| publish-weekly-journals | 既有排程可跑完，signals 標 published，projection 更新 |
| weekly export（Markdown/ZIP） | 內容與 pre-cutover 對照一致 |
| public expert page | anon 收斂後仍可讀，數字來自 public projection |
| admin performance | 雙口徑顯示，不 crash |
| factsheet PDF | 走 public projection，數字與公開頁一致 |
| price-only workers | 全部不被 guard 擋（negative test 反向驗證） |

**禁止 hard-code sharkgu UID**：所有測試以 fixture 建 expert（1 advisor + 2 mentor），production UID 不出現在 code 或 test。

---

## 5. Instrument 支援範圍（Phase 2 fail-closed）

- 支援：`TW:<code>`（含 6 碼權證）、`US:EQ:<ticker>`、`US:OPT:<完整字串>`。
- 不支援：crypto、futures、未知 market ⇒ `norm_instrument_key` 回 NULL ⇒ canonical raise `unsupported_instrument`，signal 進 `manual_review`，**不寫任何 projection**。
- combo 不拆腿：Phase 2 以整串為單位，拆腿列為 Phase 4 議題。

---

## 6. Rollout + rollback watermark（C6）

| 步驟 | 動作 | 原子性 / 檢核 |
| --- | --- | --- |
| **P0** | 建表、guard trigger（`economic_write_mode='legacy'`，讀不到 flag 一律 legacy = fail-closed，guard 只記錄不阻擋） | 單一 migration；pre/post 記錄 `schema_hash`（`md5(所有相關 table DDL)`）、`function_hash`（`md5(pg_get_functiondef)`）、grants/RLS diff、kill-switch readback |
| **P1** | 改寫 `handle_signal_trade`：在**同一 transaction** 內寫帳＋寫 ledger（provenance=`legacy_unverified_baseline` 的既有部位一次性匯入亦在此步） | 無 dual-write 視窗；ledger 為 production write，含 RLS |
| **P1.5** | 先 deploy Edge（canonical-aware 且向下相容 legacy 路徑） | Edge 先於 DB 切換；此狀態下新舊皆可運作 |
| **P2** | 單一 migration：`DISABLE TRIGGER on_signal_insert_or_update` + 啟用 canonical + flag→`canonical` + **寫入 `cutover_watermark`（`event_id` 高水位 + `now()`）** | 唯一切換點在同一 DB transaction |
| **P3** | 觀察 7 天（§7 reconciliation） | 每日報表 |
| **P4** | 執行 §4 的 DISABLE / REVOKE 清單 | 單一 migration |

**Rollback watermark（防重播）**

```sql
CREATE TABLE public.cutover_watermark (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cutover_at timestamptz NOT NULL,
  rolled_back_at timestamptz NULL,
  last_legacy_event_id uuid NULL
);
```

回滾程序：`flag→legacy` + `ENABLE TRIGGER` + 寫 `rolled_back_at`。舊 `handle_signal_trade` 在改寫版中**必須**先檢查：若 signal 的 `logical_effect_id` 已存在 `state='applied'` 的 event 且 `recorded_at > cutover_at`，則 **skip（不重播）**並記 `audit_logs`。這使「回 legacy 後不重播 P2 已套用 effects」由資料判定而非人工紀律。資料不回滾，錯誤以 correction event 前向修正。

**Failure-state matrix（migration 與 Edge 非原子）**

| 狀態 | 現象 | 處置 |
| --- | --- | --- |
| Edge 已新、DB 仍 legacy（P1.5） | Edge 走相容路徑 | 正常，可久留 |
| DB 已 P2、Edge 部署失敗 | Edge 舊碼呼叫 `save_signal_batch` | 該 RPC 內部已 route，仍正確；立即補 deploy |
| P2 migration 中途失敗 | transaction rollback | 保持 legacy，無中間態 |
| 回滾後 Edge 仍新 | Edge 呼叫 canonical RPC 但 flag=legacy | canonical 回 `mode_legacy_rejected`，Edge fallback 舊路徑 |

---

## 7. 防復發監控（C7）

- **Reconciliation job（非破壞、0 auto-fix）**：每日 08:30 Taipei（交易窗內）比對四層 —
  `Σ events(applied, visible/all)` ↔ `trade_records` ↔ `public_position_projection` ↔ `get_expert_capital_status()` ↔ UI 端 summary。
- 產出寫 `system_alerts`；`legacy_unverified_baseline` 與 `post_cutover_proven_effect` **分開統計**，legacy 只告警不阻擋。
- stale / failure：job 逾 26 小時未成功 → `system_alerts` severity=high；連續 3 次失敗觸發 kill-switch readback 檢查。
- Runbook：`docs/runbooks/economic-ledger.md`（告警分類、如何開 correction event、break-glass 條件、回滾步驟）。
- 明確不做：任何 auto-fix、auto-merge、auto-delete。

---

## 8. Red test list 與 Phase 1 ephemeral acceptance

先紅（並斷言失敗原因字串），再綠：

1. T+7 clock：effective_at vs visible_at 分離；NAV 內部以 effective 計。
2. embargo 洩漏：匿名讀不到未公開部位（public projection 不變）。
3. 單次套用：draft→embargoed→published→重試 publish，effect 恰一次。
4. 旁路 guard（§2.4 六項 negative tests）。
5. 資本守恆：`cash + market_value = equity`；三類 correction 各自正確；fees 為 NULL 不得當 0。
6. empty-row race：兩 session 同時對新 instrument buy ⇒ 序列化正確、無 lost update。
7. deterministic lock order（`(market, instrument_key)` 字典序）⇒ **無 deadlock**。
8. published economic edit ⇒ `economic_field_immutable`；文字 edit ⇒ 成功且 0 effect。
9. delete+reinsert 保留 `logical_effect_id`，不產生第二次 effect；client 指定他人 UUID 被伺服器丟棄。
10. legacy quarantine：baseline 列不觸發強不變量、但出現在告警與公開頁「待確認」口徑。
11. correction concurrency：兩 session 同時 correct 同一 head ⇒ 僅一成功，另一得 `effect_head_stale`。
12. instrument fail-closed：未知 market/型態 ⇒ `unsupported_instrument`，無 projection 寫入。
13. price-only workers 不被誤擋。
14. blast radius（§4 matrix 全列）。
15. model-based：隨機 buy/add/trim/sell/edit/retry 序列（**不含 recall**）⇒ projection == events replay。

**Phase 1 acceptance**：以上全部在 ephemeral PG green；`schema_hash` / `function_hash` / grants diff 全部記錄；production、6515、26 筆 drift **完全未動**，0 Publish。

Preview session：BLOCKED（未取得彥愷可用 session，不造帳號、不以 demo 冒充）。

停等審核。批准後只做 Phase 1。
