# R1 CLONE CLOSURE — interim status (in progress)

Scope guarantees this round: **production 0 DDL / 0 DML**, no Edge deploy, no Publish.
All work happened on a disposable clone (`/tmp/r1a`, port 55601).

## Done (machine-verified on the fresh clone)

| Gate | Result |
|---|---|
| Catalog fidelity vs production | **104/104 PASS** |
| Data-shape fidelity | **63/63 PASS** (39 → 63: four fingerprint queries that silently errored in R0 now execute) |
| `001_expand.sql` on production-exact schema | PASS, DDL-only, `trigger_expert_ai_reindex` never fires |
| `002_ledger.sql` / `003_canonical.sql` / `004_projection.sql` | apply clean on production schema |
| Fixture (production-shape) | experts / signals / 3-leg TW chain / US combo all created through the canonical writer |

### Production-adaptation fixes already landed
1. **Non-root cluster** — `setpriv --reuid=1000`; `runuser`/`su` unavailable in sandbox.
2. **`check_function_bodies=off`** in the extracted schema (SQL functions reference each other out of order).
3. **Trigger-function extraction is now auto-derived** from `pg_trigger` for every extracted table — no hand-maintained list (this is what R0 got wrong: `trg_daily_snapshot_normalize_volume` was missing).
4. **`trigger_expert_ai_reindex` blocker resolved without disabling it**: expansion uses only DDL and *generated* columns (`instrument_key`, `logical_effect_id`, `base_currency`), so no row is ever updated during expand and the statement trigger stays armed.
5. **Positional `ROW()` tuple construction removed** from the canonical writer (production `trade_records` has 23 columns in a different order, `status` is the `trade_status` enum). Replaced by field-wise assignment + `app_ledger.insert_trade_row()`, whose column list is derived from `pg_attribute` excluding generated columns.
6. **`instrument_key` single source of truth**: `public.economic_instrument_key(market, instrument)` is used by both the generated column and the canonical writer; the client-supplied key is ignored (D5).
7. **Unit compatibility fail-closed**: `app_ledger.resolve_qty_unit()` mirrors `enforce_unit_consistency` (tw_stock 張/股, us_stock 股, crypto 顆, us_option 口/組, us_future 口) and rejects any incompatible caller unit instead of writing `'share'`.
8. **F3 NULL economic context**: the guard now rejects any touched row with NULL/blank `market`, `currency` or `quantity_unit` — production allows all three to be NULL.
9. **Clone `auth.users` widened** to production shape (`raw_user_meta_data` etc.) because `sync_expert_slug_to_profile` reads it.

## Open blocker (next step, already isolated)

Inserting a row into `public.expert_signals` fails with
`unauthorized_trade_records_mutation: op=INSERT`.

Root cause: the production trigger **`handle_signal_trade()`** is itself a legacy economic
writer — it projects signals into `trade_records` directly. The guard correctly refuses it
(fail-closed, as designed), which proves the guard works, and proves the cutover **cannot**
ship until `handle_signal_trade` (and the other writers in the D-list) are re-pointed at
`app_ledger.canonical_apply_effect`. This is R1-D (writer compatibility) and is the next
item; the remaining deliverables (15 SECURITY DEFINER race closure, 84-key replay manifest,
public projection/embargo/consumer matrix, rollback drill, policy memo) follow it.

**Current verdict: still NO-GO.** No production change was made.

## FX finding (feeds the policy memo)
`public.fx_rates` holds **1 row and has no date column** — there is no historical FX series.
Any TWD-denominated historical NAV for USD experts must be embargoed/fail-closed rather
than computed from today's rate.

## Artifacts
- `db/r1/run_fresh_clone.sh` — one-command disposable clone (initdb → schema → fixture → fidelity gates)
- `db/r1/extract_schema.py`, `db/r1/clone/{00_bootstrap,schema,10_load_fixture}.sql`
- `db/r1/export_fixture.sh` — anonymized production fixture export (read-only)
- `db/r1/{001_expand,002_ledger,003_canonical,004_projection}.sql`, `db/r1/apply_r1.sh`
- `db/r1/tests/11_fixture.sql`, `db/r1/{fidelity,shape_fingerprint}.sql`
