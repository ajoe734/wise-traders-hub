# Plan v2 Evidence Review — sharkgu signal → model portfolio → performance chain

Read-only。未修改任何 code / DB / trigger / RPC / 資料，未 Publish。

## 0. v1 假設審判

| v1 假設 | 判定 | 證據 |
| --- | --- | --- |
| 「老師確認正式狀態＝未實現50／已實現50」 | **推翻（無獨立來源）** | 唯一來源是聊天截圖敘述（且截圖中老師自述「最多 100 股」與「50 股」並存）。DB 內找不到任何獨立確認欄位／表／簽核紀錄。 |
| 兩筆 add 在 draft 與 publish 各套用一次 | **證實** | `audit_logs` 對 `trade_records` id `9256006e` 的 quantity 變化鏈（見 §1.2）。 |
| `signal_trade_applications` 可證明「只套用一次」 | **推翻** | 165 列中 149 列 `tg_op='BACKFILL'`（事後補寫），只有 16 列是即時 `INSERT`，`UPDATE` 為 0。ledger 對歷史沒有證據力。 |
| drift 為「14 個 symbol，6 個 ≥1000 股」 | **修正** | 重跑不變量後為 **26 個 symbol drift、15 個 ≥1000 股**（§G5）。 |
| 修復方向可用「反轉舊 effect 再套新 effect」 | **不採用** | 破壞加權成本／closed lots／歷史 NAV，改採 append-only correction（§G3）。 |

---

## G1 真值與狀態機

### 1. effect decision matrix（現況 vs 目標）

`handle_signal_trade()` 現況（`pg_get_functiondef` 實讀）：

```text
IF TG_OP='UPDATE' AND OLD.status = NEW.status -> no-op
IF NEW.status NOT IN ('published','pending')  -> no-op
IF NEW.status IN ('published','pending')      -> 改 model portfolio
```

| transition | 現況 | 目標 |
| --- | --- | --- |
| INSERT status=pending（草稿） | **改 portfolio**（缺陷） | 只建 draft，不得改 portfolio |
| pending → published | **再改一次 portfolio**（缺陷來源） | 唯一產生 economic effect 的 transition |
| INSERT status=published | 改 portfolio | 保留 |
| published → published（文字 edit） | no-op（`OLD.status = NEW.status`） | 保留 no-op |
| batch edit（delete+reinsert） | application 被 CASCADE 刪除後可重套 | 禁止；改 correction event |
| recall / taken_down | `handle_signal_takedown()` 另一套數學 | **UNPROVEN**：是否等同反轉交易未論證，v2 不預設等同 |
| delete | FK CASCADE 抹掉冪等證據 | 禁止硬刪 economic effect |

未發布草稿滲入公開持倉：**已證實**（6515 於 2026/08/03 01:35、08/06 03:12 於 pending 狀態即改帳）。

### 2. published/executed 是否允許 retroactive edit

裁決：**不允許改寫已發布的 economic fields**。理由：point-in-time NAV、closed lots、realized P&L、對外已推播內容都已下游依賴。只能 append correction event（見 G3 方案 B）。`recall/taken_down` 在未完成 §G1.1 論證前，**不得**被實作成自動反向交易。

### 3. 6515 裁決

**manual_review。禁止預設 50，禁止改 production。**

- 訊號淨額（每 signal 只套一次）＝ 20+20+20−50 = **10 股**。
- 現行帳本 = 未實現 50 + 已實現 50，來自 double-apply 污染。
- 老師口述「最多 100 股」與現行污染值 100 一致 → 口述可能是**看著被污染的畫面**得出，不具獨立性。
- 可解除 manual_review 的證據門檻（需其一）：
  1. 券商／交割對帳單等系統外部憑證（脫敏後提供成交日、股數、價格）；
  2. 老師以書面確認「以哪一筆訊號為準、哪一筆屬誤植」，並寫入新的 correction signal；
  3. 存在獨立於 `expert_signals` 與 `trade_records` 的第三份快照（目前**查無**）。

---

## G2 寫入面與不可變冪等鍵

### 4. Production 寫入路徑實測清單

DB 端（`pg_proc` 掃描，全部 SECURITY DEFINER）：

| object | 寫入 | 觸發時機 | active |
| --- | --- | --- | --- |
| `handle_signal_trade()` | trade_records + signal_trade_applications | trigger `on_signal_insert_or_update` on `expert_signals` | O（啟用） |
| `handle_signal_takedown()` | trade_records | 下架流程 | 啟用 |
| `save_signal_batch()` | expert_signals（delete+insert）→ 間接 trade_records | 週記批次儲存／編輯 | 啟用 |
| `admin_apply_fix_proposal()` | trade_records | 後台修復 | 啟用 |
| `admin_delete_trade_records_by_signal_ids()` / `_by_symbol()` | trade_records | 後台刪除 | 啟用 |
| `admin_signal_dupe_trades_fix()` | trade_records | 後台去重 | 啟用 |
| `trade_dedupe_sweep()` | trade_records | 排程／手動 | 啟用 |
| `realign_instrument_unit()` | trade_records | 單位校正 | 啟用 |

其他 `expert_signals` trigger（皆 enabled=O）：`enforce_signal_capital_limit`、`enforce_signal_recall_same_day`、`enforce_unit_consistency`、`set_expert_signal_market`、`audit_row_change`×3、`trigger_expert_ai_reindex`×3。
`trade_records` trigger：`audit_row_change`×3、`enforce_trade_record_market_currency`、`enforce_unit_consistency`、`enqueue_bsr_first_fetch_on_trade`。

Edge / 前端（非 economic quantity 寫入，除註明者）：

- `supabase/functions/daily-performance/index.ts:141` — update trade_records（價格／績效欄位）。
- `supabase/functions/reconcile-warrant-quantities/index.ts:148` — **update quantity/quantity_unit（economic 欄位，需納入管制）**。
- `stock-price-sync`、`daily-snapshot`、`tw-bsr-*`、`weekly-journal-export`、`publish-weekly-journals/supabasePort.ts`：讀取或價格欄位。
- 前端：`SignalCreateDialog.tsx`、`SignalEditor.tsx`、`admin/Signals.tsx` 走 `save_signal_batch` RPC；`SignalDupeAudit.tsx`、`HoldingsConsistency.tsx` 走 admin RPC。

既有可重用資產：`audit_logs`（已含 before/after/changed/via/actor）、`holdings_fix_proposals`、`admin_holdings_consistency_audit()`、`function_run_logs`。**先整合這些，不另建平行控制面。**

### 5. 冪等鍵缺陷與目標

現況（實讀 `pg_constraint`）：

```text
signal_trade_applications PK (signal_id)
signal_trade_applications FK signal_id -> expert_signals(id) ON DELETE CASCADE
trade_records FK signal_id -> expert_signals(id)   -- 無 ON DELETE 動作
```

缺陷：`save_signal_batch` 編輯時刪 signal → application CASCADE 消失 → 重建後可再套一次；`applied_quantity` 只是「requested」，不是實際 delta；`tg_op` 有 BACKFILL 值代表 ledger 曾被事後補寫。

目標鍵設計（僅設計，未實作）：

- `stable_effect_id`：`(expert_id, portfolio_id, market, normalized_instrument, effective_at, action, requested_qty_base, correction_seq)` 之 deterministic hash，不依賴會被刪除重建的 signal row id。
- `effect_version` + `corrects_effect_id` 自我參照，形成 correction 鏈。
- FK 由 CASCADE 改為 `ON DELETE RESTRICT`（economic effect 不可隨 signal 硬刪）。
- DB unique constraint on `stable_effect_id`（不靠程式 if-check）。
- application state machine：`reserved → applied → superseded/failed`；`reserved` 由 unique 約束保證單一。

### 6. Transaction 語意

reservation、trade mutation、audit 必須同一 transaction：

```text
BEGIN
  SELECT ... FOR UPDATE (lock key, §G4)
  INSERT INTO effect_ledger (stable_effect_id, state='reserved', ...)
    ON CONFLICT (stable_effect_id) DO NOTHING   -- ROW_COUNT=0 => 已處理，整筆結束
  apply projection mutation
  UPDATE effect_ledger SET state='applied', actual_delta=..., before=..., after=...
  INSERT audit row
COMMIT
```

crash 中斷：未 COMMIT ⇒ reservation 一併回滾，重試從頭是安全的；已 COMMIT ⇒ ON CONFLICT 命中，重試為 no-op。不存在 `reserved` 孤兒（因為 reservation 與 mutation 同 transaction）。

---

## G3 編輯、成本與重播

### 7. 架構選擇：**方案 B（有下游依賴後禁止改 economic fields，只能 append correction event）**

證明簡單 inverse 不安全（以 6515 實例）：08/03 add 使 entry_price 由 6549 → 6364.50，08/06 → 6376.33，08/07 兩次污染 → 6382.25 → 6341.80，08/14 trim 以 6341.80 產生 closed lot 與 realized P&L。若此時反轉任一筆 add，closed lot 的成本基礎與已公告的 realized P&L 都會被追溯改寫，historical NAV 失真。故禁止。

選 B 而非 A 的理由：A（append-only ledger + 全量 replay）長期較純，但需要一次性重建全部歷史 projection，而歷史本身已被污染且缺乏獨立真值，replay 只會忠實重播污染。B 可先凍結歷史、以 correction event 前向修正，並保留日後導入 A 的空間（correction 已是 event 形式）。

`stable_effect_id` 冪等 + correction 鏈使 B 具備「可重播新事件、不可改寫舊事件」的性質。**不接受直接改 current aggregate。**

### 8. actual effect 欄位定義

`requested_qty_base`、`actual_delta_base`、`unit_original` + `unit_conversion_factor`（TW 張=1000 股，per ADR 0003）、`price`、`cost_basis_removed`、`cost_basis_added`、`proceeds`、`fees_tax`（現行模型**無**費用欄位 → 標 UNPROVEN，v2 先記 0 並註記不可用於稅務）、`realized_pnl`、`currency` / `market` / `normalized_instrument`、`effective_at`（executed_at）與 `recorded_at`（now）。

數值型別：全部 `numeric`（DB 端計算），前端只做顯示格式化，**不得**用 JS float 參與金額或數量計算。現況 `expert_signals.quantity` 與 `trade_records.quantity` 為 `integer`（base unit 股）— 小數股／碎股為 **UNPROVEN**，v2 不擴充。

### 9. 錯誤合約

現況缺陷（實讀）：`sell_qty := LEAST(v_trade_qty, existing_record.quantity)` — 靜默截斷。

目標：在 lock 內整筆 `RAISE EXCEPTION`，0 trade mutation、0 completed application。

| 條件 | errcode | message key |
| --- | --- | --- |
| requested > available | `P0001` | `oversell_rejected` + requested/available/instrument |
| 單位與 asset_class 不符 | `P0001` | `unit_mismatch` |
| quantity <= 0 | `P0001` | `invalid_quantity`（現況把 <=0 轉成 1，屬缺陷） |
| 同 expert 多列 open 同 symbol | `P0001` | `ambiguous_open_position`（現況 `ORDER BY created_at DESC LIMIT 1` 靜默取一列） |
| symbol alias / 名稱變更 | `P0001` | `instrument_alias_conflict`（需 normalized instrument 表；目前用 `split_part(instrument,' ',1)`，**UNPROVEN**） |
| 分割／增減資 corporate action | — | **BLOCKED**：系統目前無 corporate action 表，不得以 quantity 直接改寫；先只偵測並告警 |

---

## G4 併發與 rollout

### 10. Lock

lock key = `(portfolio_id, market, normalized_instrument)`；`portfolio_id` 目前不存在（以 `expert_id` 一對一代用，需在 schema 明確化，標 UNPROVEN）。
多 symbol batch：對 lock key 以 `(market, normalized_instrument)` 字典序 **deterministic order** 取鎖。
isolation：`READ COMMITTED` + 明確 `SELECT ... FOR UPDATE`；序列化衝突／deadlock（`40001`/`40P01`）以指數退避重試至多 3 次，重試仍靠 `stable_effect_id` 收斂。
測試：兩 session 同 symbol 併發、兩 session 交叉多 symbol（deadlock 觸發）各一。

### 11. Staged migration / cutover

```text
S0 只加觀測：effect ledger 影子寫入（不改 projection），比對現行 trigger 結果，只告警
S1 schema 相容：新欄位 nullable、新表獨立；舊 client 不受影響
S2 feature flag(kill switch 表已存在 system_kill_switches) 切換 economic write path
S3 停用舊 trigger：ALTER TABLE ... DISABLE TRIGGER on_signal_insert_or_update（同一 migration 內啟用新 path，避免 dual-write）
S4 觀察期；forward rollback = 反向 flag + 重新啟用舊 trigger（不回滾資料，靠 correction event 前向修正）
```

double-apply 防護：S2 期間 **新舊 path 皆先查 `stable_effect_id`**，因此即使短暫並存也不會 double-apply。

### 12. 前端 cutover 順序

**污染帳未 reconciled 前，不得把 authoritative bundle 擴散到更多頁面。** 順序：
(a) 先在週記頁把 `computeHoldingSummary` 的輸出標為「訊號淨額（非正式持倉）」或隱藏；
(b) reconciliation 完成、drift = 0 或全數 manual_review 隔離後；
(c) 才切成 `useExpertHoldingsBundle` 單一資料源。

附帶證據：`src/pages/admin/Signals.tsx:84` 以 `computeHoldingSummary(filtered, searchQuery)` 計算，輸入是**已套 UI filter 的清單**（含 pending 草稿），故該數字會隨畫面篩選改變 — 本身即不可作為持倉真值。

---

## G5 drift、修復與防復發

### 13. Drift 量測（snapshot 2026-08-17T00:50Z，唯讀）

不變量（僅用於**偵測**，不作為真值）：

```sql
signal_net(expert,sym) = Σ published signals: (buy|add:+qb, sell|trim:-qb)
  qb = CASE WHEN market='TW' AND unit='張' THEN quantity*1000 ELSE quantity END
trade_open(expert,sym) = Σ trade_records.quantity WHERE status='open'
drift <=> signal_net <> trade_open
```

結果：**77 對，26 個 drift，其中 15 個 |diff| ≥ 1000**。

| 類別 | count | 匿名化樣本（expert 以 md5 hash 表示） |
| --- | --- | --- |
| 大額權證／ETF 類（|diff| ≥ 10000） | 8 | `28f3…d761bc`：062787、707414、069559、071111、064781、071939、068736、709803 |
| 中額（1000–9999） | 7 | `f855…09a59b`：00631L、6202、1815、4939、1514、4755、6285 |
| 小額（< 1000） | 11 | `f855…`：4576、4971、3693、3363、3081；`714c…ccce93`：SPCX、META；`5e72…dd60`：GOOG、GLW、AMD；`f855…`：**6515** |

**重要限制（誠實聲明）**：此不變量是「兩份都可能受污染的表互比」，只能證明**不一致存在**，不能導出真值。真值需外部憑證（券商對帳、老師書面確認），因此所有 26 筆預設 **manual_review**，v2 不主張任何一筆可 auto-fix。宣稱「可獨立導出真值」屬 **UNPROVEN**。

### 14. Repair 前置（尚未執行）

- 交付 dry-run diff：每個 (portfolio, instrument) 的 before / proposed after / reason / confidence / 依據 row id / row hash。
- 可恢復備份：repair 前對 `trade_records`、`expert_signals`、ledger 建 timestamped snapshot 表；rollback = 由 snapshot 生成 correction event（不硬改）。
- repair 必須 idempotent、append-only audit、第二次 run 產生 0 diff。
- **未經你審核 dry-run，禁止任何資料修復。** 目前狀態：dry-run 尚未產出。

### 15. 持續 reconciliation（非破壞性）

- 檢查：effect ledger ↔ trade projection ↔ capital status ↔ UI bundle，四層 quantity/cost 相等。
- 排程：每日台北 20:30（發布後）＋每週一 07:00 全量。
- threshold：任一 symbol 不一致即告警；|diff| ≥ 1000 或涉及 closed lot 者升級。
- 行為：**只告警 + 標記隔離，絕不自動猜測改帳。**
- owner/runbook：後台 `/company/holdings-consistency` 既有頁面延伸；runbook 寫入 `docs/`。

---

## G6 測試與驗收

### 16. 測試

- 列舉案例：buy/add/add/trim 逐步 before/after；pending→published 只套一次；文字 edit no-op；經濟欄位 correction；oversell 拒絕；unit mismatch；quantity<=0；exit。
- **model-based / differential state-machine test**：隨機生成 buy/add/trim/sell/edit/retry/recall 序列，斷言 projection == 由 immutable events 全量 replay 的結果。
- 併發：兩 session race、deadlock retry、partial failure、transaction rollback。
- migration compatibility：S2 新舊 path 並存下不 double-apply。
- 流程：先 red 並記錄失敗原因，再 green。

### 17. 驗收證據鏈

`stable_effect_id → application/version → immutable event → trade projection(open+closed) → capital status → 週記 UI / 績效 UI`，逐層 quantity / cost / realized P&L 相等。重跑 publish、文字 edit、經濟欄位 correction、refresh 各一次皆不得產生重複 effect。

### 18. Authenticated Preview

需以彥愷（sharkgu，UID `13926bcc…`）有權限帳號驗證，不得用 demo、不得造資料。
目前狀態：**BLOCKED — 尚未取得該帳號可用 session**。不冒充 PASS。

### 19. Scope freeze

只限 sharkgu 的 signal → model portfolio → performance chain。不動 payment / dashboard / holding-checkup。0 Publish。

---

## Gate 狀態總表

| Gate | 狀態 |
| --- | --- |
| G1.1 matrix | PROVEN（現況缺陷已證） |
| G1.2 retroactive policy | 已裁決；recall 等同反轉 = UNPROVEN |
| G1.3 6515 | **manual_review**（獨立確認來源 = 無） |
| G2.4 writer inventory | PROVEN |
| G2.5 冪等鍵 | 缺陷 PROVEN；新鍵為設計，未實作 |
| G2.6 transaction | 設計完成 |
| G3.7 架構 | 選定方案 B，理由已證 |
| G3.8 effect 欄位 | fees/tax、碎股 = UNPROVEN |
| G3.9 錯誤合約 | LEAST 截斷 PROVEN；corporate action = BLOCKED |
| G4.10 lock | portfolio_id 不存在 = UNPROVEN |
| G4.11 cutover | 設計完成 |
| G4.12 前端順序 | 已定序 |
| G5.13 drift | 26 / 15（≥1000），真值 = UNPROVEN |
| G5.14 dry-run | **尚未產出，禁止修復** |
| G5.15 reconciliation | 設計完成 |
| G6.16 tests | 未執行 |
| G6.17 證據鏈 | 未執行 |
| G6.18 Preview | **BLOCKED** |
| G6.19 scope freeze | 遵守中 |

停在此處等待你的審核。未經批准不進行任何實作、資料修復或 Publish。
