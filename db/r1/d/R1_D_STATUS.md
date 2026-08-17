# R1-D WRITER COMPAT + RACE CLOSURE — STATUS: **NO-GO (in progress)**

Clone: `r1d1` @ port 55801 (production-shape, catalog 104/104 PASS, shape PASS).
No production DDL/DML, no Edge deploy, no publish. Zero-touch maintained.

## Done
- `db/r1/d/writer-inventory.{json,csv,md}` — 15 DB writers, 13 Edge writers, 23 triggers,
  generated from the production catalog by `build_inventory.py`.
- `001_compat.sql` applied clean:
  - `app_ledger` schema/tables/functions owned by **ledger_owner** (NOLOGIN, no members,
    BYPASSRLS to preserve legacy definer semantics).
  - Guards switched to SECURITY INVOKER + `current_user = 'ledger_owner'` + unforgeable
    mutation token. No GUC/header/application_name bypass anywhere.
  - `effect_key` idempotency table + DB-derived `derive_logical_effect_id()`.
  - `lock_expert()` advisory xact lock (same-expert serialization).
  - `canonical_apply_signal` / `publish_signal_effect` / `canonical_reverse_signal`
    (executed_at = economics, status = visibility only; missing context → manual_review).
  - `apply_price_update()` whitelist (`current_price`, `price_updated_at` only).
- `002_cutover.sql` applied clean: 11 legacy economic writers rewritten as thin wrappers
  over canonical; raw DML grants revoked from anon/authenticated/service_role.
- `090_verify.sql` first run on clone: **33 tests, 26 pass, 7 fail**.

## Open failures (must be green before GO)
1. `enqueue_bsr_first_fetch_on_trade` needs `public.tw_bsr_daily` / `tw_bsr_sync_queue`
   in the clone — added to `extract_schema.py`, clones must be rebuilt.
2. `app_ledger.economic_effect` has no `signal_id` column — test queries must join via
   `effect_key`.
3. `td` fixture schema not readable after `SET LOCAL ROLE` — needs `GRANT USAGE`.
4. `T-W03-neg-empty-signals` must set the JWT sub before asserting `empty_signals`.
5. `T-ACL-7/8` are invalid inside a superuser session; must assert
   `pg_has_role(...,'ledger_owner','USAGE') = false` and re-test in real psql sessions.
6. `trade_dedupe_sweep` fails the coverage gate (wrapper does not yet call `app_ledger.*`
   on the dry-run path).

## Not yet built
`091_concurrency.sh` (two real psql sessions), `099_rollback.sql`,
`run_two_fresh_clones.sh`, `failure-ledger.csv` (R1 blocker + 46 R0 failures),
three-stage deployment order/rollback memo.

**Verdict: NO-GO.** Not all inventory writers are green; work continues on the clones.

## Run 2026-08-17 — two fresh clones (r1dA:55901 / r1dB:55902), deterministic

Status: **NO-GO**（同一輪持續進行中）

固定入口已全部建立：`failure-ledger.csv`（11 筆本輪逐筆失敗 + R0 46 筆）、`090_verify.sql`、
`091_concurrency.sh`、`095_hashes.sql`、`098_data_purge.sql`、`099_rollback.sql`、
`run_two_fresh_clones.sh`、`writer-inventory.json`。

### 已綠（兩座 clone 完全一致）
- schema errors 0；090_verify 53 tests / 46 pass。
- **B 段不可偽造性有實證**：guard 不讀 current_setting / application_name / JWT / pg_temp
  （T-B08 靜態 body assert）；token 是 `app_ledger.effect_projection_mutation` 的 row，
  只有 ledger_owner 可寫，runtime role 連 SELECT 都被拒（T-B09~B13）。
- **091 用真實非 superuser 連線**（anon / authenticated / service_role 各自 psql 連線）：
  raw DML、SET ROLE ledger_owner/wrapper_owner、EXECUTE canonical、偽造 token
  共 15 項全部 denied。
- S1 同 expert 序列化（pg_locks 觀察到未 granted 的 advisory lock）、S2 不同 expert 並行
  （elapsed < 2.6s vs serial 3.0s）、S4 pending→published 不重複套用、S4c reconcile vs publish 無重複列。

### 仍紅（11 筆，逐筆在 failure-ledger.csv）
1. 核心根因一筆：signal INSERT 路徑產生 projection 但沒有寫 `effect_key` / `economic_effect`
   → 連帶 T-W01-happy、T-W01-retry x2、S3 x2、S4b 共 6 個紅燈。
2. `T-W01-neg-direct-delete` guard 未對 DELETE fail closed。
3. `T-W11` 非 dry-run 缺重複群組 fixture。
4. `T-COV-0` / `T-COV-1`：assert 尚未對齊兩層 owner 設計，4 個 KEEP writer 未列 disposition。
5. `S6` 價格白名單對未知 key 沒有 fail closed。
6. rollback hash：catalog.columns / functions / acl 三行不同（099 未撤 001_expand 欄位與 ACL）。

### Production
本輪全程 0 DDL / 0 DML / 0 deploy / 0 Publish；所有工作都在 disposable clone，
兩座皆已 destroy（`/tmp/r1dA`、`/tmp/r1dB` 不存在）。
