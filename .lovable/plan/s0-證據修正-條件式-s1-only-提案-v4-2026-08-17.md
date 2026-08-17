# S0 證據修正 + 條件式 S1-only 提案（v4）

不執行、不碰 production、不 deploy/Publish。本文件只修正四個邏輯缺口，並提出可簽核的 S1 邊界。

## 缺口 1 — Flow B 的 rollback 主張要降級並重做

現況事實：`before.fp` / `after.fp` relfilenode `792cab669dd72920c1cdc024b9a87cbe`，`rollback.fp` 為 `532831998f184b446fe3b3600a48e842`。economic `35d397b1…`、public_acl `587122c3…`、legacy_writer_contract `79b3e11b…` 三者三點相同。

修正：
- 主張改寫為「logical data / ACL / writer-contract equivalent」，**移除任何 byte-identical 或 relfilenode 回原值的說法**。
- `db/r1/c/S0/s1_rollback.sql` 目前對四張 base projection table 做 `DROP TABLE CASCADE` 再由 base R1 腳本重建，這是錯的 stage-specific rollback。改為 **只刪 S1 這一輪新增的 object**，baseline 既有 table/function 完全不碰。
- 新增 fingerprint 欄位：`baseline_relfilenode`（只含 baseline 既有 public tables），rollback 後必須與 before 完全相同。
- 以全新 disposable clone 重跑 Flow B（新 run_id），四個 fingerprint（baseline_relfilenode / economic / public_acl / legacy_writer_contract）before = after = rollback 才算通過。

## 缺口 2 — 76-pair / 84-key hash 的來源要重生或撤回

背景盤點顯示原始 E_classify 76-pair 輸出已遺失，主回覆卻引用 basis 與 hash。修正動作二選一，計畫採前者：
- 重新產生 artifact `db/r1/c/S0/manifest_basis.json`，內含：生成 run_id、UTC 時間、pair row count、key row count、full sha256、source SQL 檔與其 sha256、執行資料庫（production read-only）。
- 若重跑無法產生一致結果，**撤回 84/76 basis 的 hash 主張**，S0 該項標記 UNVERIFIED，不得以舊敘述拼湊。
在新 artifact 落地前，`s0_baselines.json.manifests.*` 內的 basis 說明一律標為 `provenance_pending`。

## 缺口 3 — 三個集合必須分開，且 withheld 對齊 36

| 集合 | 定義 | 數量 |
|---|---|---|
| canonical market-aware quantity drift | multiple_apply 17 + signal_only 9 | 26 |
| fail-closed unsafe（不可公開） | 26 + stored_only 6 + incomplete 3 + other 1 | 36 |
| 全 universe | replay-84 全部 key | 84 |

修正：
- public projection 的 withheld predicate 不可只鎖 26；`app_ledger.manifest_disposition` 與 `public.public_projection_withheld` 的寫入條件要覆蓋全部 36，並在 manifest counts 顯示 `unsafe=36 / drift26=26 / match=48`。
- 48 個 match **不等於可公開**：仍要通過 expert-level proof gate（12 位專家目前 ready=0）、derivative gate、FX gate。因此在專家層級全數未 ready 前，實際可公開集合為 **0**，48 只是 key-level 未偵測到數量漂移。這點要寫進 projection 註解與驗收斷言。
- 新增驗收斷言：`withheld_count = 36`、`publishable_after_expert_gate = 0`。

## 缺口 4 — S1 決策：條件式 S1-only（有邊界的風險接受）

Flow B 已證明 S1 對既有經濟資料與 ACL 是 additive，因此不再宣稱「PITR unknown 與 authenticated smoke 阻擋 S1」。改為：

- **PITR unknown**：以 fresh logical backup artifact + clone restore proof 取代，屬有邊界接受。
- **authenticated smoke blocker**：因 S1 不改權限、不改前端，延後到 S2 前必須完成，明寫為風險接受，不視為 S0 綠。
- **S2 仍 NO-GO**（Edge prod bundle hash 未知、E04/E13 無 boot 記錄）。

### S1-only 執行邊界（逐項）

1. **只新增 object，零替換**。目前 `db/r1/d/001_compat.sql` + `db/r1/p/001_projection.sql` 不符合此邊界，必須先切出 `S1-min` 版本：
   - 允許：`app_ledger` schema 內新增 table（`replay_manifest_key`、`effect_key`）、新增 function（`classify_instrument`、`instrument_publishable`、`manifest_key`、`manifest_disposition`、`manifest_immutable`、`fx_rate_as_of`、`embargo_days`）、其 trigger 只掛在新 table 上；新增 `public.public_projection_version`、`public.public_projection_withheld` 兩張新表。
   - **必須從 S1 移到 S2**：`ALTER ROLE ledger_owner BYPASSRLS`、對既有 `public.trade_records` 等既有表的 GRANT/REVOKE、既有 writer 的 `CREATE OR REPLACE`（`publish_signal_effect`、`apply_price_update`、guard triggers）。這些都不是 additive。
   - 零 UPDATE/DELETE、零資料回填；`010_manifest_seed.sql` 只寫入新表 `replay_manifest_key`，視為新表初始內容而非 production 資料異動（此點需使用者確認是否接受）。
2. **單一 transaction**，開頭設 `lock_timeout = 3s`、`statement_timeout = 60s`；失敗即整體 rollback。
3. **執行前最後 drift preflight**：lineage、catalog fingerprint、37 canonical ACL keys / 149 tuples、15 writers / 23 triggers 與 S0 baseline 比對，任一不符即中止。
4. **fresh logical backup artifact + restore proof**：執行當日重生 backup bundle，於全新 clone 完成 restore 驗證（14/14 fidelity）後才可執行 S1。
5. **S1 rollback 只 DROP 新增 objects**，不碰 baseline table/function。
6. **pre / post / rollback 三點比對全等**：economic rows、baseline relfilenode、writer contract、37 canonical ACL keys / 149 tuples、140-probe 權限矩陣。
7. **anon smoke pre/post**：沿用現有 10 條路由清單與 5 個既存 404 基線，post 必須與 pre 完全相同。
8. **S1 完成即停**：S2、cron、Edge、UI、production 資料與歷史一律不碰。

### 能不能前進？

可以，但**只有 S1-min 版本**能在上述邊界內前進；現行三檔原樣套用會違反「零 GRANT/REVOKE、零既有 object replace」。所以核准順序是：先產出 S1-min 與新版 rollback → fresh clone 全綠 → 才提請 production S1 核准。

## 保留的最終目標（S1 不是完成）

- 任意使用者 holdings 的 privacy-safe demand registry（不外洩個別持倉）。
- Hourly slow full-market sweep，取代「開抽屜才回補」。
- 週末 backlog / backup 補跑。
- Drawer 維持 read-only，不觸發寫入。
- 真實 freshness chain（cron → worker → attempt → write 的可追蹤 run_id）與前端如實顯示新鮮度。

S1 的唯一價值是安全地建立相容層。
