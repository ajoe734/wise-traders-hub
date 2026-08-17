# Plan v3 Evidence Review — sharkgu signal → model portfolio → performance

Read-only。未修改 code / DB / trigger / RPC / 資料，未 Publish。6515 與 26 筆 drift 未動。

## v2 被推翻的裁決

| v2 主張 | v3 判定 | 證據 |
| --- | --- | --- |
| pending = 未成交草稿，不得改 portfolio | **判反了** | `SignalCreateDialog.tsx:821/862` 明寫「T+7 歷史」「本頁內容為一週前之操作回顧」。導師週記記錄的是**已執行**的交易，pending 只是尚未對訂戶公開（embargo）。 |
| published 才是 economic effect 的時點 | **錯誤** | 會把 effective trade date 延後最多 7 天，扭曲 NAV 與 realized P&L。 |
| stable_effect_id 用內容 hash | **撤回** | 內容即 mutable economic fields，改欄位＝換 ID。改用首次建立即分配的 immutable UUID。 |
| 「停掉 on_signal_insert_or_update 即可防復發」 | **不足** | 尚有 8 個 DB writer + 2 個 Edge writer 可直接改 economic 欄位（§B3）。 |
| shadow ledger「只觀測」 | **撤回** | 那是 production write，需 RLS/retention/kill switch。 |
| 建 timestamped snapshot tables 作備份 | **撤回** | 改用 audit_logs + PITR（§B9）。 |

---

## B1 pending 的 domain truth（實讀證據）

### 證據

| 來源 | 內容 |
| --- | --- |
| `SignalCreateDialog.tsx:821` | Badge「T+7 歷史」 |
| `SignalCreateDialog.tsx:862` | 「本頁內容為一週前之操作回顧（T+7），僅供教學用途」 |
| `SignalEditor.tsx:247`、`SignalCreateDialog.tsx:338` | `status = isMentor ? 'pending' : 'published'` — 導師一律先 pending |
| `admin/Signals.tsx:212/228` | 「週一~五撰寫，週五 20:00 統一開放發布」「繞過排程，立即公開」 |
| `publish-weekly-journals/supabasePort.ts:44-48` | 發布時 `status='published'` 並 **覆寫 `published_at = now()`** |
| `expert_signals` 欄位 | 有 `executed_at`（實際成交）、`published_at`（可見時間）、`created_at`；**無** `scheduled_publish_at` |
| `handle_signal_trade()` L139/L168/L187/L210 | trade_records 的 `entry_date`/`exit_date` = `COALESCE(NEW.published_at, NOW())` — **用可見時間當成交時間** |
| 6515 實例 | add 的 `executed_at` = 08/03 01:27、08/06 02:57；`published_at` 被覆寫成 08/07 12:00；trade 的 `entry_date` 停在 07/24 |

### 裁決

`pending` **同時**承載兩種語意：(a) 撰寫中的草稿、(b) 已實際執行但尚未公開的 embargoed trade。**必須拆狀態**，不得共用一字。

四個時間軸分離（目前系統只有兩個半）：

```text
draft_at    = created_at            （撰寫時間，現有）
effective_at= executed_at            （模型交易時間，現有但被忽略）
visible_at  = published_at           （對訂戶公開時間，現行被 publish 覆寫）
recorded_at = 事件寫入 ledger 的時間  （不存在，需新增）
```

重畫後的 state matrix：

| status（目標） | 意義 | economic effect | 對訂戶可見 |
| --- | --- | --- | --- |
| `draft` | 撰寫中，未確認成交 | 無 | 否 |
| `embargoed` | 已成交（有 effective_at），等 T+7 公開 | **有**，以 `effective_at` 為準，只套一次 | 否 |
| `published` | 已公開 | 無新增（只改 visible_at） | 是 |
| `recalled` / `taken_down` | 下架 | **UNPROVEN**，不預設反轉 | 否 |

### Embargo 洩漏（已證實）

`pg_policies` 實讀：

```text
trade_records / SELECT / role=public / "Anyone can view open trades for active experts"
  USING (status='open' AND expert_id IN (active experts))
```

⇒ 週記還是 pending 時，`handle_signal_trade` 已寫入 open trade_record，**任何未登入訪客都能看到尚未公開的部位**。6515 於 2026/08/03 01:35（pending）即公開變成 40 股。這是 B1 最嚴重的實證缺陷。

對策方向（v3 只提案）：

- 內部 NAV：以 `effective_at` 即時計入。
- 對外 projection：`as_of = now() − embargo_window`，或以 `visible_at IS NOT NULL` 過濾；公開 RLS 必須改為只露出已公開對應的部位。
- 兩者是**不同 projection**，不是同一張表加欄位就算。

---

## B2 logical_effect_id（撤回 hash 設計）

```sql
-- 設計（未實作）
economic_effect (
  logical_effect_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 首次建立分配，永不因內容改變
  event_id         uuid NOT NULL UNIQUE,          -- 每個 version 一列
  event_version    int  NOT NULL CHECK (event_version >= 1),
  supersedes_event_id uuid NULL REFERENCES economic_effect(event_id),
  origin_signal_id uuid NULL,                     -- 只作 provenance，不作身分
  state text NOT NULL CHECK (state IN ('reserved','applied','superseded','failed')),
  ...
  UNIQUE (logical_effect_id, event_version),
  -- 同一 logical id 只能有一個 active 後繼（防 branching）
  EXCLUDE / partial unique: UNIQUE (logical_effect_id) WHERE state = 'applied'
);
```

- **draft 被刪／重建保留 logical id**：`expert_signals` 端新增 `logical_effect_id`（nullable、first-write-wins）；`save_signal_batch` 的 delete+reinsert 必須攜帶原 id。FK 改 `ON DELETE RESTRICT`（現況為 `ON DELETE CASCADE`，實讀確認）。
- **防 cycle**：`supersedes_event_id` 只能指向同一 `logical_effect_id` 且 `event_version` 較小者（CHECK + trigger）。
- **防同一 version 多 active successor**：`UNIQUE (supersedes_event_id) WHERE state='applied'`。
- 不使用任何內容 hash 作身分。

---

## B3 Writer disposition matrix（全部納管）

| writer | 目前可改 | disposition |
| --- | --- | --- |
| `handle_signal_trade()`（trigger） | quantity/cost/status | **route through canonical**（唯一 economic 入口） |
| `handle_signal_takedown()` | quantity/status | **manual-review-only**，直到 recall 語意證明 |
| `save_signal_batch()` | 間接（delete+insert） | route；published 的 economic 欄位改為 **reject**（§B8） |
| `admin_apply_fix_proposal()` | quantity/cost | route through canonical correction API |
| `admin_delete_trade_records_by_signal_ids()` | delete | **disable**（改為 correction event） |
| `admin_delete_trade_records_by_symbol()` | delete | **disable** |
| `admin_signal_dupe_trades_fix()` | merge/delete | **disable** |
| `trade_dedupe_sweep()` | merge/delete | **disable**（新架構下不得偷偷 merge） |
| `realign_instrument_unit()` | quantity/unit | manual-review-only |
| Edge `reconcile-warrant-quantities` | quantity/unit | **disable 或 route** |
| Edge `daily-performance` | price/pnl 欄位 | **price-only whitelist** |
| Edge `stock-price-sync` / `daily-snapshot` / `tw-bsr-*` | price 欄位 | price-only whitelist |
| Edge `publish-weekly-journals` → `syncTradeSignals` | **另一組 projection**：`trade_signals` + `user_performances`（含 close/delete） | 納入 canonical projection，不得獨立寫 |

**DB-level guard**（設計）：`trade_records` 加 BEFORE UPDATE/DELETE trigger，若 `changed ∩ {quantity, quantity_unit, entry_price, exit_price, status, exit_date}` 非空，則要求 session 內 `current_setting('app.canonical_write', true) = on`，該旗標只由 canonical function 設定；否則 `RAISE EXCEPTION`。SECURITY DEFINER 亦受此 trigger 約束（trigger 在資料列層，DEFINER 不繞過），且每次寫入強制留 `audit_logs`。

---

## B4 資本守恆（accounting equation）

由 `get_expert_capital_status()` 實讀導出**現行**模型：

```text
available_cash = starting_capital + realized_pnl − open_cost
realized_pnl   = Σ closed: quantity × (exit_price − entry_price)      -- 無費用
open_cost      = Σ open:   quantity × entry_price
open_market    = Σ open:   quantity × current_price
equity         = available_cash + open_market
```

雙邊 effect：

| action | cash leg | position leg |
| --- | --- | --- |
| buy / add | −qty×price | +qty，重算加權成本 |
| trim / sell | +qty×price | −qty，產生 closed lot 與 realized |
| exit | +qty×price | 全數平倉 |
| correction: `historical_fill`（補記歷史成交） | 依成交金額調整 | 調整部位與成本 |
| correction: `quantity_adjustment`（純股數校正，非交易） | **不動 cash** | 調整部位；差額進 `equity_adjustment` |
| correction: `capital_adjustment`（本金校正） | 調整 cash | 不動部位 |

三類 correction 必須分開，不可混為一種。

- **fees/tax**：現行模型無此欄位 → 記 `NULL` + `calculation_model_version` + `fee_model='not_modeled'`。**不得記 0**。
- **歷史 NAV 不回寫**：correction 只影響 `recorded_at` 當日起的 series；當日 return 需扣除 correction 造成的非市場變動（`return = (equity_t − equity_{t−1} − net_adjustment_t) / equity_{t−1}`），並在 UI 標註「本日含帳務更正」。

---

## B5 併發原語（撤回 v2 的「設計完成」）

空列競態成立：新 instrument 尚無 open row，`SELECT ... FOR UPDATE` 鎖不到列，兩 effect 可同時讀 0 並互相覆寫。

現況實讀：

- `%portfolio%` 表：**0 個**；portfolio 概念不存在，只有 `experts.starting_capital / currency / asset_class`。
- 現有 `advisory` lock 使用：**0 處**。
- instrument master：只有 `stock_names`、`crypto_symbol_map`；`handle_signal_trade` 用 `split_part(instrument,' ',1)` 當識別，無 unique 約束。

選定：**transaction-scoped advisory lock**（`pg_advisory_xact_lock(key1 int4, key2 int4)`），不新建平行控制面。

```text
key1 = hashtext(expert_id::text)
key2 = hashtext(market || ':' || normalized_symbol)
```

- collision policy：hash 碰撞只會造成**額外序列化**（保守、不會錯帳），可接受；為降低誤鎖，canonical function 內在取得 advisory lock 後**仍**對命中的 open rows 加 `FOR UPDATE`。
- `normalized_symbol` = `upper(btrim(split_part(instrument,' ',1)))`；同時提案對 `trade_records` 加 `UNIQUE (expert_id, normalized_symbol) WHERE status='open'`（先以唯讀查詢驗證現況是否已違反，再決定是否可加 → 目前 **UNPROVEN**）。
- deterministic lock order：一律以 `(market, normalized_symbol)` 字典序取鎖 ⇒ 任兩 transaction 的鎖序列都是同一全序的子序列 ⇒ **不可能形成環，不會 deadlock**。測試斷言為「**不出現 deadlock**」，而非以觸發 deadlock 為成功。

---

## B6 Cutover compatibility matrix

| 階段 | DB | Edge/App | old trigger | new path | old client 行為 | 風險 |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | 加新表＋guard trigger（**預設關閉**，fail-closed 旗標 `economic_write_mode='legacy'`） | 未部署 | 啟用 | 未啟用 | 不變 | 無 |
| P1 | ledger 開始由 old trigger **同一 transaction** 內附帶記錄（不是旁路 shadow） | 未部署 | 啟用（改寫版：寫帳＋寫 ledger） | — | 不變 | ledger 為 production write |
| P2 | 單一 migration 內：`economic_write_mode='canonical'` + `ALTER TABLE expert_signals DISABLE TRIGGER on_signal_insert_or_update` + 啟用 canonical function | 同版本 deploy 於 P2 前完成且向下相容 | 停用 | 啟用 | old client 仍呼叫 `save_signal_batch`，該 RPC 內部改走 canonical | 唯一切換點在同一 DB transaction，無 dual-write 視窗 |
| P3 | 觀察 7 天 | — | 停用 | 啟用 | — | — |
| P4 | disable 舊 writer（§B3 disable 清單） | — | — | — | — | — |

- flag 儲存於既有 `system_kill_switches`（已存在），**default = legacy（fail-closed：讀不到 flag 一律當 legacy，不啟用新寫入）**。
- rollback window：P2→P3 期間可反向 migration 重新 `ENABLE TRIGGER` + flag 回 legacy；**資料不回滾**，靠 correction event 前向修正。
- ledger 的 RLS（expert 只讀自己）、retention（不設自動刪除，屬帳務證據）、load（每筆 signal 1 列，量級同 `signal_trade_applications` 165 列）、PII（不存人名／email，只存 uuid 與數值）、kill switch（同上 flag）。
- ACL：canonical function `SECURITY DEFINER SET search_path = public`；`REVOKE EXECUTE FROM public/anon`，只 `GRANT` 給 `authenticated`（RLS 於函式內以 `auth.uid()` 驗證）與 `service_role`。

---

## B7 Legacy quarantine

- ledger 列必須帶 `provenance ∈ {legacy_unverified_baseline, post_cutover_proven_effect}`。
- P1 匯入的既有部位一律 `legacy_unverified_baseline`（依據：165 列 applications 中 **149 列為 `tg_op='BACKFILL'`**，僅 16 列即時 INSERT，0 列 UPDATE ⇒ 舊 ledger 無證據力）。
- 強不變量（quantity/cost/cash 守恆、單次套用）只對 `post_cutover_proven_effect` 保證；legacy 只做**偵測與告警**。
- 26 筆 drift 全部標 `quarantined`。UI 顯示規則：capital status 與週記／績效頁對隔離中的 symbol 顯示「帳務待確認」標記，數字以次級樣式呈現，不得混入「已驗證」總計；總計需同時揭露 `verified` 與 `quarantined` 兩個口徑。
- 升級路徑：取得獨立確認（券商對帳／老師書面 correction signal）後，以 correction event 升級為 proven，不得批次自動升級。

---

## B8 Published edit 必須 fail

- 可修改（whitelist）：`reason_summary`、`reason_detail`、`risk_notes`、`learning_points`、`teaching_topic`、`overall_summary`。
- **immutable once effect applied**：`action`、`quantity`、`quantity_unit`、`price_hint`、`executed_at`(effective_at)、`instrument`、`market`。
- 機制：`expert_signals` BEFORE UPDATE trigger — 若存在 `state='applied'` 的 effect 且上述欄位有變動 ⇒ `RAISE EXCEPTION` errcode `P0001`, key `economic_field_immutable`（附欄位名與 logical_effect_id）。**不是 silent no-op**（現行 `handle_signal_trade` 在 `OLD.status = NEW.status` 時 silent return，即為缺陷）。
- `save_signal_batch(_is_editing=true)` 必須停止對 published signals 的 delete+reinsert；改為 whitelist UPDATE，economic 變更一律回 `requires_correction_event`。
- 前端 error mapping：`economic_field_immutable` → 顯示「已公開的交易內容不可修改，請建立更正紀錄」，並導向 correction 流程；`oversell_rejected`、`unit_mismatch`、`ambiguous_open_position` 各自對應既有 toast 文案層。

---

## B9 備份與 threat model

- **不新建 timestamped snapshot tables**。備份依序採用：既有 `audit_logs`（已含 before/after/changed/via/actor，6515 全鏈可還原）→ Supabase PITR/自動備份 → 必要時受控加密 export（不落 production 表）。
- threat model：
  - tenant isolation：ledger RLS `expert_id IN (select id from experts where user_id = auth.uid())`；company_admin 另有政策；**anon 無任何 grant**。
  - SECURITY DEFINER：全部 `SET search_path = public`，`REVOKE EXECUTE FROM public, anon`。
  - actor attribution：canonical function 記錄 `auth.uid()` 與 `via`（authenticated / service_role），service_role 呼叫需帶顯式 actor 參數。
  - 禁止 expert A 讀寫 expert B：所有 canonical API 以 `expert_id` 對照 `auth.uid()` 驗證，company_admin 例外需寫 audit。
  - 附帶修正：現行 `trade_records` 對 `public` role 開放 open/closed 讀取（§B1 洩漏），需在 embargo projection 一併收斂。

---

## B10 交付與驗收

### Red tests（先紅、證明失敗原因，再綠）

1. T+7 clock：`effective_at`(executed_at) vs `visible_at`(published_at) 分離；NAV 以 effective 計、對外 projection 以 visible 計；斷言 6515 的 add 應落在 08/03、08/06 而非 08/07。
2. embargo 洩漏：匿名 client 讀 `trade_records` 不得看到尚未公開的部位。
3. 單次套用：draft → embargoed → published → 重試 publish，effect 恰一次。
4. 旁路 guard：逐一呼叫 §B3 的 8 個 DB writer + 2 個 Edge writer 直接改 quantity ⇒ 全部必須 raise。
5. cash/NAV 守恆：每個 action 與三類 correction 後 `cash + market_value = equity` 成立；fees 為 NULL 不得被當 0 計入。
6. empty-row race：兩 session 對同一新 instrument 同時 buy，結果必為序列化後的正確總量，無 lost update。
7. deterministic lock order：多 symbol batch 併發，斷言**無 deadlock**。
8. published economic edit ⇒ raise；文字 edit ⇒ 成功且 0 effect。
9. delete+reinsert 保留 logical_effect_id，不產生第二次 effect。
10. legacy quarantine：`legacy_unverified_baseline` 列不得觸發強不變量失敗，但必須出現在告警清單。
11. model-based：隨機 buy/add/trim/sell/edit/retry/recall 序列，projection == 由 events replay。

### Phase acceptance

- **Phase 1**：以上全部在 ephemeral DB green。不碰 production。
- **Phase 2**：只上 prevention（guard trigger + canonical path + immutability + embargo projection）。**不碰 26 筆歷史、不碰 6515。**
- **Phase 3**：history dry-run 另開票，附每列 before/after/reason/confidence/row hash，經你審核後才談修復。

### Scope / 狀態

只限 sharkgu 的 signal → model portfolio → performance chain。不動 payment / dashboard / holding-checkup。0 Publish。
Preview session：**BLOCKED**（未取得彥愷可用 session，不造帳號、不以 demo 冒充）。

## Gate 狀態

| Gate | 狀態 |
| --- | --- |
| B1 domain truth | PROVEN（含 embargo 洩漏實證）；`recall` 語意仍 UNPROVEN |
| B2 logical id | 設計完成（immutable UUID，非 hash） |
| B3 disposition | PROVEN 清單 + disposition 完成 |
| B4 accounting | 由現行 RPC 實讀導出；fees/tax = not_modeled |
| B5 concurrency | 選定 advisory lock；`UNIQUE(expert, symbol) WHERE open` 可行性 UNPROVEN |
| B6 cutover | matrix 完成，切換點單一 transaction |
| B7 quarantine | 完成（149/165 BACKFILL 為依據） |
| B8 published edit | 完成 |
| B9 security | 完成；trade_records public RLS 需收斂 |
| B10 tests/phases | 未執行 |

停等審核。未經批准不實作、不修資料、不 Publish。
