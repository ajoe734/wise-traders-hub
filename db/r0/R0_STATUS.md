# R0 PRE-FLIGHT 中間結論（production 唯讀 + disposable clone）

判定：**NO-GO**（不得進 production rollout）。本輪 0 筆 production DDL/DML、無 deploy、無 Publish。

## 已完成且有證據
- **A baseline**：PG 17.6、economic table/constraint/trigger/RLS/ACL 指紋、15 個 SECURITY DEFINER 經濟函式（owner=postgres, search_path=public）、38 個 cron、14 個 view（`payment_providers_safe` 缺 security_invoker，另案處理）。
- **B clone fidelity**：disposable PG 17.9（port 55501）。**104/104 結構指紋 + 39/39 資料形狀指紋與 production 完全相同**（`db/r0/evidence/shape_*.txt`），fixture 已去識別化（user_id 雜湊、理由欄位遮蔽）。
- **C ownership gate（PASS）**：clone 上真的 `CREATE ROLE ledger_owner NOLOGIN`；app_ledger schema/8 表/序列/13 函式/enum **23 物件全部 owner=ledger_owner，違規 0**；5 個 SECURITY DEFINER 皆 `search_path=""` 且以 ledger_owner 執行；anon/authenticated/service_role 對 `trade_records` 與三張 ledger 表的 INSERT/UPDATE/DELETE/TRUNCATE **全部 0 筆授權**，僅保留 service_role 的 `current_price/price_updated_at` 欄位級 UPDATE 與 authenticated SELECT。
  - production capability 證據：migration runner = `postgres`，具 `rolcreaterole` → 策略可部署。額外必要條件：`GRANT CREATE ON SCHEMA public TO ledger_owner`，且 public.* 上的 TRIGGER/REVOKE/GRANT 必須由 postgres 執行（已在 `db/r0/build_cutover.py` 自動分流）。
- **D writer 盤點**：實際經濟寫入端點已列出（`daily-performance`、`stock-price-sync`、`reconcile-warrant-quantities`、`publish-weekly-journals/supabasePort`、`SignalCreateDialog`、`admin/Signals`、`SignalEditor(save_signal_batch)`、`SignalDupeAudit` 三個 admin RPC、`realign_instrument_unit`、`calculate_expert_performance`）。路由定案表尚未逐項凍結。
- **E shadow replay（production 唯讀，84 key）**：`match 48`／`multiple_apply 17`／`signal_only_no_trade 9`／`stored_only_no_signal 6`／`incomplete 3`／`other_drift 1`。成因分類：`unit_ambiguous 24`、`market_ambiguous 8`、`consistent_shape 44`。6515 穎崴：stored open 50 vs replay 10（維持 manual_review，未修改）。

## 阻擋 GO 的 exact blocker
1. **E0 測試套件無法在 production-exact schema 跑綠**：套用 expand 後仍 `assert 39/61`、`negative 43/67`，主要失敗集中在 E3/E4 append-only 與 E7 fail-closed（`no error raised`）、以及 `get_expert_capital_status` 未納入 clone 抽取範圍。E0 的 138/138 只在簡化 baseline 成立。
2. **expand 必須先關閉非經濟觸發器**（`trigger_expert_ai_reindex` 走 pg_net 會讓整筆 migration 中止），此步驟需正式納入 migration 並定 lock/timeout/rollback。
3. **D 的 race closure、F 的 public projection/cache/embargo、G 的完整 dry-run、H 的 policy memo 尚未完成。**

## 產出物
`db/r0/{extract_schema.py,fidelity.sql,export_fixture.sh,build_cutover.py,E_replay.sql,E_classify.sql,shape_fingerprint.sql}`、`db/r0/clone/{schema.sql,00_bootstrap.sql,10_load_fixture.sql,20_ownership_gate.sql,30_ownership_assert.sql,40_expand.sql}`、`db/r0/evidence/*`。
