# R1-D writer inventory

Source: production catalog (read-only) + `supabase/functions` static scan.
DB writers: **15** · Edge writers: **13** · triggers on economic tables: **23**

## DB writers

| ID | signature | owner | secdef | search_path | EXECUTE ACL | writes | callers / attached | disposition |
|---|---|---|---|---|---|---|---|---|
| W04 | `public.admin_apply_fix_proposal(p_id uuid, p_confirm boolean)` | postgres | yes | `search_path=public` | `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}` | expert_signals, holdings_fix_proposals, trade_records | - | REWRITE: correction effect via canonical_apply_effect |
| W05 | `public.admin_delete_trade_records_by_signal_ids(_signal_ids uuid[])` | postgres | yes | `search_path=public` | `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}` | trade_records | - | REWRITE: reversal effects, no raw DELETE |
| W06 | `public.admin_delete_trade_records_by_symbol(_expert_id uuid, _symbol_prefix text)` | postgres | yes | `search_path=public` | `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}` | trade_records | - | REWRITE: reversal effects, no raw DELETE |
| W11 | `public.admin_generate_fix_proposals(p_category text)` | postgres | yes | `search_path=public` | `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}` | holdings_fix_proposals | - | KEEP: proposals table only, no economic write |
| W12 | `public.admin_reject_fix_proposal(p_id uuid, p_note text)` | postgres | yes | `search_path=public` | `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}` | holdings_fix_proposals | - | KEEP: proposals table only, no economic write |
| W10 | `public.admin_reset_expert_asset_class(_expert_id uuid, _new_asset_class text)` | postgres | yes | `search_path=public` | `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}` | expert_signals | - | REWRITE: routed through canonical correction |
| W07 | `public.admin_signal_dupe_trades_fix(p_signal_id uuid, p_dry_run boolean, p_force boolean)` | postgres | yes | `search_path=public` | `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}` | trade_records | - | REWRITE: dedupe via canonical idempotency, no raw DELETE |
| W14 | `public.delete_old_prices()` | postgres | yes | `search_path=public` | `{postgres=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}` | current_prices | - | KEEP: current_prices retention only |
| W03 | `public.handle_signal_takedown()` | postgres | yes | `search_path=public` | `{postgres=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}` | trade_records, user_performances | - | REWRITE: emit reversal effect via canonical_apply_effect |
| W01 | `public.handle_signal_trade()` | postgres | yes | `search_path=public` | `{postgres=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}` | signal_trade_applications, trade_records | expert_signals:on_signal_insert_or_update | REWRITE: thin wrapper -> app_ledger.canonical_apply_effect |
| W09 | `public.realign_instrument_unit(p_expert_id uuid, p_symbol_prefix text, p_new_unit text)` | postgres | yes | `search_path=public` | `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}` | expert_signals, trade_records | - | REWRITE: unit realignment as correction effect |
| W15 | `public.recalc_user_summary_on_perf_delete()` | postgres | yes | `search_path=public` | `{postgres=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}` | user_summaries | user_performances:trg_recalc_summary_on_perf_delete | KEEP: derived summary only, no economic write |
| W02 | `public.save_signal_batch(_expert_id uuid, _batch_id uuid, _signals jsonb, _legs jsonb, _is_editing boolean)` | postgres | yes | `search_path=public` | `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}` | expert_signal_legs, expert_signals, trade_records | - | REWRITE: per-signal loop -> canonical_apply_effect (idempotent by origin_signal_id) |
| W08 | `public.trade_dedupe_sweep(p_dry_run boolean)` | postgres | yes | `search_path=public` | `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}` | trade_records | - | REWRITE: dedupe via canonical idempotency, no raw DELETE |
| W13 | `public.upsert_current_price(p_writer text, p_rows jsonb)` | postgres | yes | `search_path=public` | `{postgres=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}` | current_prices | - | KEEP + NARROW: price whitelist only |

## Edge writers

| ID | source | writes | economic RPCs | disposition |
|---|---|---|---|---|
| E01 | `supabase/functions/backfill-daily-snapshots/index.ts` | daily_price_snapshots (update/upsert) | - | REPOINT: economic DML must call canonical RPC |
| E02 | `supabase/functions/backfill-snapshots-twse-bulk/index.ts` | daily_price_snapshots (upsert) | - | REPOINT: economic DML must call canonical RPC |
| E03 | `supabase/functions/checkup-research-extract/index.ts` | target_price_history (insert) | - | REPOINT: economic DML must call canonical RPC |
| E04 | `supabase/functions/crypto-price-sync/index.ts` | - | upsert_current_price | KEEP: already goes through an RPC |
| E05 | `supabase/functions/daily-performance/index.ts` | trade_records (update) | - | REPOINT: economic DML must call canonical RPC |
| E06 | `supabase/functions/daily-snapshot/index.ts` | daily_price_snapshots (upsert) | - | REPOINT: economic DML must call canonical RPC |
| E07 | `supabase/functions/line-push-signal/index.ts` | expert_signals (update) | - | REPOINT: economic DML must call canonical RPC |
| E08 | `supabase/functions/publish-weekly-journals/supabasePort.ts` | expert_signals (update), user_performances (delete/insert) | - | REPOINT: economic DML must call canonical RPC |
| E09 | `supabase/functions/reconcile-warrant-quantities/index.ts` | trade_records (update) | - | REPOINT: economic DML must call canonical RPC |
| E10 | `supabase/functions/refresh-targets-weekly/index.ts` | target_price_history (upsert) | - | REPOINT: economic DML must call canonical RPC |
| E11 | `supabase/functions/stock-price-sync/index.ts` | user_performances (upsert), user_summaries (upsert) | upsert_current_price | NARROW: whitelist current_price/price_updated_at only (R1-D §6) |
| E12 | `supabase/functions/us-option-price-sync/index.ts` | - | upsert_current_price | KEEP: already goes through an RPC |
| E13 | `supabase/functions/us-stock-quote/index.ts` | - | upsert_current_price | KEEP: already goes through an RPC |

## Triggers on economic tables

| table | trigger | function |
|---|---|---|
| daily_price_snapshots | daily_snapshot_normalize_volume | trg_daily_snapshot_normalize_volume |
| expert_signal_legs | trg_expert_signal_legs_updated_at | update_updated_at_column |
| expert_signals | enforce_signal_capital_limit_trg | enforce_signal_capital_limit |
| expert_signals | expert_signals_ai_reindex_del | trigger_expert_ai_reindex |
| expert_signals | expert_signals_ai_reindex_ins | trigger_expert_ai_reindex |
| expert_signals | expert_signals_ai_reindex_upd | trigger_expert_ai_reindex |
| expert_signals | on_signal_insert_or_update | handle_signal_trade |
| expert_signals | trg_audit_expert_signals_del | audit_row_change |
| expert_signals | trg_audit_expert_signals_ins | audit_row_change |
| expert_signals | trg_audit_expert_signals_upd | audit_row_change |
| expert_signals | trg_enforce_signal_recall_same_day_del | enforce_signal_recall_same_day |
| expert_signals | trg_enforce_unit_consistency_expert_signals | enforce_unit_consistency |
| expert_signals | trg_set_expert_signal_market | set_expert_signal_market |
| holdings_fix_proposals | audit_holdings_fix_proposals | audit_row_change |
| holdings_fix_proposals | holdings_fix_proposals_updated_at | tg_holdings_fix_proposals_updated_at |
| trade_records | trg_audit_trade_records_del | audit_row_change |
| trade_records | trg_audit_trade_records_ins | audit_row_change |
| trade_records | trg_audit_trade_records_upd | audit_row_change |
| trade_records | trg_enforce_trade_record_market_currency | enforce_trade_record_market_currency |
| trade_records | trg_enforce_unit_consistency_trade_records | enforce_unit_consistency |
| trade_records | trg_trade_records_bsr_first_fetch | enqueue_bsr_first_fetch_on_trade |
| user_performances | trg_recalc_summary_on_perf_delete | recalc_user_summary_on_perf_delete |
| user_performances | trg_user_performances_price_guard | enforce_user_performance_price |

## Table ACL (production, before R1-D)

| table | relacl |
|---|---|
| current_prices | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres,sandbox_exec_yqacmrgdjlenbijclngi=ar/postgres,sandbox_exec=ar/postgres}` |
| daily_price_snapshots | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres,sandbox_exec_yqacmrgdjlenbijclngi=ar/postgres,sandbox_exec=ar/postgres}` |
| expert_signal_legs | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres,sandbox_exec_yqacmrgdjlenbijclngi=ar/postgres,sandbox_exec=ar/postgres}` |
| expert_signals | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres,sandbox_exec_yqacmrgdjlenbijclngi=ar/postgres,sandbox_exec=ar/postgres}` |
| holdings_fix_proposals | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres,sandbox_exec_yqacmrgdjlenbijclngi=ar/postgres,sandbox_exec=ar/postgres}` |
| signal_trade_applications | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres,sandbox_exec_yqacmrgdjlenbijclngi=ar/postgres,sandbox_exec=ar/postgres}` |
| target_price_history | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres,sandbox_exec_yqacmrgdjlenbijclngi=ar/postgres,sandbox_exec=ar/postgres}` |
| trade_records | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres,sandbox_exec_yqacmrgdjlenbijclngi=ar/postgres,sandbox_exec=ar/postgres}` |
| user_performances | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres,sandbox_exec_yqacmrgdjlenbijclngi=ar/postgres,sandbox_exec=ar/postgres}` |
| user_summaries | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres,sandbox_exec_yqacmrgdjlenbijclngi=ar/postgres,sandbox_exec=ar/postgres}` |
