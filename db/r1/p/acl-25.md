# R1-P — ACL 25 disposition (production read-only, 0 touch)

generated: 2026-08-17T05:07:57.889102+00:00

| field | value |
| --- | --- |
| rows total | 28 |
| pattern family (admin/build/publish) | **25** |
| named pre-cutover (subset, also counted above? no — disjoint class) | 3 |
| unclassified | 0 |
| watchset sha256 (frozen) | `4b789a857ffd1f21f0b089d1a192f4f952acb58907c169c233f017fdd465d18c` |
| pinned baseline sha256 | `4b789a857ffd1f21f0b089d1a192f4f952acb58907c169c233f017fdd465d18c` |
| detail sha256 | `29409e83d23c1fde71d415f9ecf420614312d8246e5484f558b56e227280a018` |

Disposition counts: `revoke_anon_public`=28, `keep_typed_safe`=0, `owner_only`=0, `replace_with_wrapper`=0.

**No `keep` disposition exists.** Every one of the 25 pattern-family functions and the 3 named helpers is revoked from `PUBLIC, anon` by the cutover migration `db/r1/p/002_public_contract.sql`. admin / build / publish / economic raw RPC are never kept public by policy. The three named helpers are re-granted to `authenticated, service_role` only, and `T-P98c` proves they still return output for the intended caller; `095_acl25_verify.sql` proves per signature that an ordinary `anon` session has no EXECUTE, produces no row and no output.

Production is NOT changed by this artifact: no GRANT/REVOKE was issued. The counts and hashes above are the frozen pre-cutover baseline (`db/r1/p/093_prod_acl_baseline.sh`).

## Items

### 1. `public.admin_apply_fix_proposal(p_id uuid, p_confirm boolean)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | admin |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | company_admin UI (/company/holdings-fix) |
| data exposed / mutated | mutates trade_records + holdings_fix_proposals (applies an adjudicated correction) |
| pre-cutover risk | anon could apply arbitrary economic corrections to any expert's ledger |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.01` |

### 2. `public.admin_delete_trade_records_by_signal_ids(_signal_ids uuid[])`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | admin |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | company_admin data-repair tooling |
| data exposed / mutated | deletes rows from trade_records |
| pre-cutover risk | anon could destroy an expert's trade history |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.02` |

### 3. `public.admin_delete_trade_records_by_symbol(_expert_id uuid, _symbol_prefix text)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | admin |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | company_admin data-repair tooling |
| data exposed / mutated | deletes rows from trade_records for an expert/symbol prefix |
| pre-cutover risk | anon could destroy an expert's trade history |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.03` |

### 4. `public.admin_generate_fix_proposals(p_category text)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | admin |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | company_admin UI + maintenance cron |
| data exposed / mutated | writes holdings_fix_proposals; reads full cross-expert holdings |
| pre-cutover risk | anon could enumerate every expert's drifted positions |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.04` |

### 5. `public.admin_holdings_consistency_audit()`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | admin |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | company_admin audit page |
| data exposed / mutated | reads cross-expert holdings/trade_records aggregates (no mutation) |
| pre-cutover risk | anon could read raw cross-expert position and quantity data |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.05` |

### 6. `public.admin_list_cron_jobs()`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | admin |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public, cron` |
| grants | postgres:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; PUBLIC:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | company_admin ops page |
| data exposed / mutated | reads cron.job schedule/commands (infrastructure metadata) |
| pre-cutover risk | anon could enumerate internal jobs, secrets in job commands, and cadence |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.06` |

### 7. `public.admin_reject_fix_proposal(p_id uuid, p_note text)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | admin |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | company_admin UI |
| data exposed / mutated | mutates holdings_fix_proposals state |
| pre-cutover risk | anon could suppress adjudication of a known drift |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.07` |

### 8. `public.admin_reset_expert_asset_class(_expert_id uuid, _new_asset_class text)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | admin |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | company_admin UI |
| data exposed / mutated | mutates experts.asset_class (changes economic interpretation) |
| pre-cutover risk | anon could reclassify an expert and corrupt every downstream valuation |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.08` |

### 9. `public.admin_trade_dedupe_sweep(p_dry_run boolean)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | admin |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | company_admin maintenance |
| data exposed / mutated | deletes duplicated trade_records rows |
| pre-cutover risk | anon could trigger mass deletion of ledger rows |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.09` |

### 10. `public.backfill_job_set_done(_id bigint, _status text)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | build |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | PUBLIC:EXECUTE/postgres; postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | service_role worker (edge function) |
| data exposed / mutated | mutates backfill_job_queue state |
| pre-cutover risk | anon could mark queue work complete and starve real backfills |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.10` |

### 11. `public.backfill_job_set_failed(_id bigint, _error text, _retry_at timestamp with time zone)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | build |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | PUBLIC:EXECUTE/postgres; postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | service_role worker (edge function) |
| data exposed / mutated | mutates backfill_job_queue state/retry clock |
| pre-cutover risk | anon could poison the retry schedule |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.11` |

### 12. `public.backfill_legacy_bsr_to_fact(_from date, _to date)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | build |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | service_role migration worker |
| data exposed / mutated | bulk-writes bsr fact tables from legacy rows |
| pre-cutover risk | anon could rewrite chip facts / exhaust DB capacity |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.12` |

### 13. `public.backfill_queue_stats()`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | build |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | PUBLIC:EXECUTE/postgres; postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | company_admin ops dashboard |
| data exposed / mutated | reads queue depth/lag metrics (infrastructure metadata) |
| pre-cutover risk | anon could profile internal workload and vendor quota state |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.13` |

### 14. `public.claim_backfill_jobs(_batch_size integer, _max_priority_score integer)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | build |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | service_role worker (edge function) |
| data exposed / mutated | claims + locks rows in backfill_job_queue |
| pre-cutover risk | anon could steal all queued work and stall ingestion |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.14` |

### 15. `public.enqueue_backfill_jobs(_jobs jsonb)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | build |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | PUBLIC:EXECUTE/postgres; postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | service_role worker / cron |
| data exposed / mutated | inserts into backfill_job_queue |
| pre-cutover risk | anon could flood the queue (DoS + vendor quota burn) |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.15` |

### 16. `public.enqueue_bsr_backfill(p_stock_id text, p_days integer)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | build |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | company_admin UI + chips prefetch worker |
| data exposed / mutated | inserts into backfill_job_queue for a stock |
| pre-cutover risk | anon could flood the queue (DoS + vendor quota burn) |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.16` |

### 17. `public.enqueue_institutional_backfill_universe()`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | build |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | PUBLIC:EXECUTE/postgres; postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | cron (tw-bsr-worker-hourly) |
| data exposed / mutated | enqueues the whole market universe |
| pre-cutover risk | anon could trigger a full-universe fetch storm |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.17` |

### 18. `public.get_expert_capital_status(_expert_id uuid)`

| field | value |
| --- | --- |
| class | named_pre_cutover (subset: named 3) |
| category | economic_raw_rpc |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres; anon:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | authenticated app (expert page, capital banner) |
| data exposed / mutated | returns an expert's capital / funding state (economic raw RPC) |
| pre-cutover risk | anon could read capital state for any expert without entitlement |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98a.18` |

### 19. `public.get_publish_batch_attempts(_limit integer)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | publish |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | company_admin publishing console |
| data exposed / mutated | reads publish attempt log incl. unpublished/embargoed signal ids |
| pre-cutover risk | anon could read pre-embargo publication intent |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.19` |

### 20. `public.get_publish_batch_runs(_limit integer)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | publish |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | company_admin publishing console |
| data exposed / mutated | reads publish run history incl. unreleased batches |
| pre-cutover risk | anon could read pre-embargo publication intent |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.20` |

### 21. `public.get_publish_batch_status()`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | publish |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | company_admin publishing console |
| data exposed / mutated | reads current publish batch state |
| pre-cutover risk | anon could read pre-embargo publication intent |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.21` |

### 22. `public.has_active_subscription_after(_user_id uuid, _published_at timestamp with time zone)`

| field | value |
| --- | --- |
| class | named_pre_cutover (subset: named 3) |
| category | economic_raw_rpc |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres; anon:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | authenticated app (entitlement checks) |
| data exposed / mutated | returns entitlement truth for an arbitrary user id |
| pre-cutover risk | anon could enumerate who is subscribed and when |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98a.22` |

### 23. `public.is_tester(_user_id uuid)`

| field | value |
| --- | --- |
| class | named_pre_cutover (subset: named 3) |
| category | economic_raw_rpc |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres; anon:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | authenticated app + internal gating |
| data exposed / mutated | returns internal tester flag for an arbitrary user id |
| pre-cutover risk | anon could enumerate internal accounts |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98a.23` |

### 24. `public.prune_backfill_job_queue()`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | build |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | PUBLIC:EXECUTE/postgres; postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | cron maintenance |
| data exposed / mutated | deletes rows from backfill_job_queue |
| pre-cutover risk | anon could delete pending ingestion work |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.24` |

### 25. `public.publish_batch_attempts_touch()`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | trigger |
| owner | postgres |
| prosecdef | False |
| search_path | `search_path=public` |
| grants | PUBLIC:EXECUTE/postgres; postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | trigger only (BEFORE UPDATE on publish_batch_attempts) |
| data exposed / mutated | sets updated_at on publish_batch_attempts |
| pre-cutover risk | trigger function must never be directly executable by an anonymous caller |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.25` |

### 26. `public.recover_stale_backfill_jobs(_stale_after interval)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | build |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | cron maintenance |
| data exposed / mutated | resets stale claimed jobs in backfill_job_queue |
| pre-cutover risk | anon could recycle in-flight jobs and cause duplicate ingestion |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.26` |

### 27. `public.tg_holdings_fix_proposals_updated_at()`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | trigger |
| owner | postgres |
| prosecdef | False |
| search_path | `search_path=public` |
| grants | PUBLIC:EXECUTE/postgres; postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | trigger only (BEFORE UPDATE on holdings_fix_proposals) |
| data exposed / mutated | sets updated_at on holdings_fix_proposals |
| pre-cutover risk | trigger function must never be directly executable by an anonymous caller |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.27` |

### 28. `public.trade_dedupe_sweep(p_dry_run boolean)`

| field | value |
| --- | --- |
| class | pattern_admin_build_publish |
| category | build |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; anon:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | service_role maintenance job |
| data exposed / mutated | deletes duplicated trade_records rows |
| pre-cutover risk | anon could trigger mass deletion of ledger rows |
| cutover disposition | **revoke_anon_public** |
| post-migration test | `T-P98b.28` |

