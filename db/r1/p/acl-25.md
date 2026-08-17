# R1-P — ACL 25 disposition (production read-only, 0 touch)

generated: 2026-08-17T05:34:45.911315+00:00

| field | value |
| --- | --- |
| rows total | 28 |
| pattern family (admin/build/publish) | **25** |
| named pre-cutover (disjoint class, NOT a subset) | 3 |
| unique functions (25 + 3, dedup by canonical key) | **28** |
| canonical keys signature|grantee|privilege | 37 (anon 28 + PUBLIC 9) |
| duplicate canonical keys | 0 |
| named/pattern overlap | 0 |
| unclassified | 0 |
| watchset sha256 (frozen) | `4b789a857ffd1f21f0b089d1a192f4f952acb58907c169c233f017fdd465d18c` |
| pinned baseline sha256 | `4b789a857ffd1f21f0b089d1a192f4f952acb58907c169c233f017fdd465d18c` |
| detail sha256 | `29409e83d23c1fde71d415f9ecf420614312d8246e5484f558b56e227280a018` |

Disposition counts: `owner_service_role_only`=12, `keep_typed_safe_authenticated_guarded`=12, `keep_rls_predicate_helper`=2, `replace_with_wrapper`=2.

**PUBLIC/anon EXECUTE is closed for all 28 unique functions** by `db/r1/p/002_public_contract.sql` (C3/C3b/C3c). admin / build / publish / economic raw RPC / trigger helpers are never kept reachable by an unauthenticated caller. Where `authenticated` keeps EXECUTE, the row carries `keep_justification` + `keep_negative_proof`, and `095_acl25_verify.sql` runs both the negative test (anon, and for guarded targets an ordinary authenticated session) and the positive test (owner / service_role / intended caller still works).

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
| cutover disposition | **keep_typed_safe_authenticated_guarded** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | body raises SQLSTATE 42501 unless has_role(auth.uid(),'company_admin'); the /company UI calls it as an ordinary authenticated session |
| keep negative proof | T-P98e ordinary authenticated session gets 42501 and no row |
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
| cutover disposition | **keep_typed_safe_authenticated_guarded** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | body raises SQLSTATE 42501 unless has_role(auth.uid(),'company_admin'); the /company UI calls it as an ordinary authenticated session |
| keep negative proof | T-P98e ordinary authenticated session gets 42501 and no row |
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
| cutover disposition | **keep_typed_safe_authenticated_guarded** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | body raises SQLSTATE 42501 unless has_role(auth.uid(),'company_admin'); the /company UI calls it as an ordinary authenticated session |
| keep negative proof | T-P98e ordinary authenticated session gets 42501 and no row |
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
| cutover disposition | **keep_typed_safe_authenticated_guarded** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | body raises SQLSTATE 42501 unless has_role(auth.uid(),'company_admin'); the /company UI calls it as an ordinary authenticated session |
| keep negative proof | T-P98e ordinary authenticated session gets 42501 and no row |
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
| cutover disposition | **keep_typed_safe_authenticated_guarded** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | body raises SQLSTATE 42501 unless has_role(auth.uid(),'company_admin'); the /company UI calls it as an ordinary authenticated session |
| keep negative proof | T-P98e ordinary authenticated session gets 42501 and no row |
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
| cutover disposition | **owner_service_role_only** |
| authenticated keeps EXECUTE | False |
| intended caller after cutover | function owner only (no role grant; publish/build/trigger) |
| keep justification | —(revoked) |
| keep negative proof | —(revoked) |
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
| cutover disposition | **keep_typed_safe_authenticated_guarded** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | body raises SQLSTATE 42501 unless has_role(auth.uid(),'company_admin'); the /company UI calls it as an ordinary authenticated session |
| keep negative proof | T-P98e ordinary authenticated session gets 42501 and no row |
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
| cutover disposition | **keep_typed_safe_authenticated_guarded** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | body raises SQLSTATE 42501 unless has_role(auth.uid(),'company_admin'); the /company UI calls it as an ordinary authenticated session |
| keep negative proof | T-P98e ordinary authenticated session gets 42501 and no row |
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
| cutover disposition | **keep_typed_safe_authenticated_guarded** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | body raises SQLSTATE 42501 unless has_role(auth.uid(),'company_admin'); the /company UI calls it as an ordinary authenticated session |
| keep negative proof | T-P98e ordinary authenticated session gets 42501 and no row |
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
| cutover disposition | **owner_service_role_only** |
| authenticated keeps EXECUTE | False |
| intended caller after cutover | service_role edge function / cron |
| keep justification | —(revoked) |
| keep negative proof | —(revoked) |
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
| cutover disposition | **owner_service_role_only** |
| authenticated keeps EXECUTE | False |
| intended caller after cutover | service_role edge function / cron |
| keep justification | —(revoked) |
| keep negative proof | —(revoked) |
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
| cutover disposition | **owner_service_role_only** |
| authenticated keeps EXECUTE | False |
| intended caller after cutover | service_role edge function / cron |
| keep justification | —(revoked) |
| keep negative proof | —(revoked) |
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
| cutover disposition | **replace_with_wrapper** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | signature preserved for the app; the original ungated body moved to <name>_raw (service_role/owner only) behind an entitlement gate |
| keep negative proof | T-P98e ordinary authenticated session gets 42501; T-P98h _raw is not executable by anon/authenticated |
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
| cutover disposition | **owner_service_role_only** |
| authenticated keeps EXECUTE | False |
| intended caller after cutover | service_role edge function / cron |
| keep justification | —(revoked) |
| keep negative proof | —(revoked) |
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
| cutover disposition | **owner_service_role_only** |
| authenticated keeps EXECUTE | False |
| intended caller after cutover | service_role edge function / cron |
| keep justification | —(revoked) |
| keep negative proof | —(revoked) |
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
| cutover disposition | **keep_typed_safe_authenticated_guarded** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | body raises SQLSTATE 42501 unless has_role(auth.uid(),'company_admin'); the /company UI calls it as an ordinary authenticated session |
| keep negative proof | T-P98e ordinary authenticated session gets 42501 and no row |
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
| cutover disposition | **owner_service_role_only** |
| authenticated keeps EXECUTE | False |
| intended caller after cutover | service_role edge function / cron |
| keep justification | —(revoked) |
| keep negative proof | —(revoked) |
| post-migration test | `T-P98b.17` |

### 18. `public.get_expert_capital_status(_expert_id uuid)`

| field | value |
| --- | --- |
| class | named_pre_cutover (named 3, disjoint from the pattern 25) |
| category | economic_raw_rpc |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres; anon:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | authenticated app (expert page, capital banner) |
| data exposed / mutated | returns an expert's capital / funding state (economic raw RPC) |
| pre-cutover risk | anon could read capital state for any expert without entitlement |
| cutover disposition | **replace_with_wrapper** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | signature preserved for the app; the original ungated body moved to <name>_raw (service_role/owner only) behind an entitlement gate |
| keep negative proof | T-P98e ordinary authenticated session gets 42501; T-P98h _raw is not executable by anon/authenticated |
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
| cutover disposition | **keep_typed_safe_authenticated_guarded** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | body raises SQLSTATE 42501 unless has_role(auth.uid(),'company_admin'); the /company UI calls it as an ordinary authenticated session |
| keep negative proof | T-P98e ordinary authenticated session gets 42501 and no row |
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
| cutover disposition | **keep_typed_safe_authenticated_guarded** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | body raises SQLSTATE 42501 unless has_role(auth.uid(),'company_admin'); the /company UI calls it as an ordinary authenticated session |
| keep negative proof | T-P98e ordinary authenticated session gets 42501 and no row |
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
| cutover disposition | **keep_typed_safe_authenticated_guarded** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | body raises SQLSTATE 42501 unless has_role(auth.uid(),'company_admin'); the /company UI calls it as an ordinary authenticated session |
| keep negative proof | T-P98e ordinary authenticated session gets 42501 and no row |
| post-migration test | `T-P98b.21` |

### 22. `public.has_active_subscription_after(_user_id uuid, _published_at timestamp with time zone)`

| field | value |
| --- | --- |
| class | named_pre_cutover (named 3, disjoint from the pattern 25) |
| category | economic_raw_rpc |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres; anon:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | authenticated app (entitlement checks) |
| data exposed / mutated | returns entitlement truth for an arbitrary user id |
| pre-cutover risk | anon could enumerate who is subscribed and when |
| cutover disposition | **keep_rls_predicate_helper** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | used inside RLS policy predicates, which Postgres evaluates as the querying role, so `authenticated` must keep EXECUTE or row visibility breaks open-ended |
| keep negative proof | T-P98f anon has no EXECUTE; T-P98g RLS still hides a non-entitled row |
| post-migration test | `T-P98a.22` |

### 23. `public.is_tester(_user_id uuid)`

| field | value |
| --- | --- |
| class | named_pre_cutover (named 3, disjoint from the pattern 25) |
| category | economic_raw_rpc |
| owner | postgres |
| prosecdef | True |
| search_path | `search_path=public` |
| grants | postgres:EXECUTE/postgres; authenticated:EXECUTE/postgres; service_role:EXECUTE/postgres; sandbox_exec_yqacmrgdjlenbijclngi:EXECUTE/postgres; anon:EXECUTE/postgres |
| offending grantee | anon — EXECUTE granted by postgres |
| actual caller | authenticated app + internal gating |
| data exposed / mutated | returns internal tester flag for an arbitrary user id |
| pre-cutover risk | anon could enumerate internal accounts |
| cutover disposition | **keep_rls_predicate_helper** |
| authenticated keeps EXECUTE | True |
| intended caller after cutover | company_admin or entitled authenticated session + service_role |
| keep justification | used inside RLS policy predicates, which Postgres evaluates as the querying role, so `authenticated` must keep EXECUTE or row visibility breaks open-ended |
| keep negative proof | T-P98f anon has no EXECUTE; T-P98g RLS still hides a non-entitled row |
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
| cutover disposition | **owner_service_role_only** |
| authenticated keeps EXECUTE | False |
| intended caller after cutover | service_role edge function / cron |
| keep justification | —(revoked) |
| keep negative proof | —(revoked) |
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
| cutover disposition | **owner_service_role_only** |
| authenticated keeps EXECUTE | False |
| intended caller after cutover | function owner only (no role grant; publish/build/trigger) |
| keep justification | —(revoked) |
| keep negative proof | —(revoked) |
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
| cutover disposition | **owner_service_role_only** |
| authenticated keeps EXECUTE | False |
| intended caller after cutover | service_role edge function / cron |
| keep justification | —(revoked) |
| keep negative proof | —(revoked) |
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
| cutover disposition | **owner_service_role_only** |
| authenticated keeps EXECUTE | False |
| intended caller after cutover | function owner only (no role grant; publish/build/trigger) |
| keep justification | —(revoked) |
| keep negative proof | —(revoked) |
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
| cutover disposition | **owner_service_role_only** |
| authenticated keeps EXECUTE | False |
| intended caller after cutover | function owner only (no role grant; publish/build/trigger) |
| keep justification | —(revoked) |
| keep negative proof | —(revoked) |
| post-migration test | `T-P98b.28` |

