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
