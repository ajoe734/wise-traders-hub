# S0 PREFLIGHT STATUS — NOT GREEN

Production touch: **read-only** (SELECT / catalog / logs / browsing). No DDL, no DML, no deploy, no Publish.
**S1 仍未批准。**

Denominator = 9 gates. TOTAL: **5 PASS / 2 PARTIAL / 2 BLOCKER**.

| Gate | Result | Evidence |
|---|---|---|
| S0-1 lineage (422 remote vs 418 repo, ±10s drift, uuid-suffix, empty-name rows) | PASS | `lineage_query.json`, `s0_preflight.py`; 412 matched / 5 remote-only pre-repo / 5 duplicate-applied / 1 applied-not-recorded (`20260812211500_bsr_claim_token_slot`, `claim_bsr_queue_jobs` already carries `token_slot`) |
| S0-2a backup tier / PITR / retention / last recoverable point | **BLOCKER** | Not readable by any available tool. `supabase--project_info` and `lovable supabase info` return instance size (Mini) only — no backup tier, no PITR flag, no retention, no recovery point. Must be answered by the user/platform before S1. |
| S0-2b stage-specific backup artifact | PASS | `backup/MANIFEST.json` — 28 function definitions (`functions.sql`), 37 canonical ACL keys / 28 unique signatures with live `proacl` (`acl_keys.json`), 11 affected tables with columns/indexes/constraints/policies/grants/RLS (`catalog_affected.json`), 72 cron jobs (`cron_config.json`), catalog fingerprint anchor; every file sha256'd |
| S0-2c restore rehearsal on a fresh disposable clone | **BLOCKER (not run)** | Depends on S0-2a decision about what is actually restorable; artifact-only replay is prepared but the rehearsal has not been executed, so it must not be counted green |
| S0-3 schema/data/pointer/hash baseline | PASS | `s0_baselines.json`, `baseline_sha256=5efc0d9c…`; trade_records 82 rows / 5 experts / 21 open / md5 `4f1f1f9c…`; expert_signals 173 (all `published`) md5 `7d94e81e…`; projection pointer **absent** (expected pre-S3); columns/policies/triggers sha256 pinned |
| S0-4 exec env (long tx / blocked locks) | PASS | 0 transactions >60s, 0 blocked locks |
| S0-5 writer + trigger inventory | PASS | 15 DB writers, 23 triggers verified against live `pg_proc`/`pg_trigger` |
| S0-5b edge inventory (per-function detail) | PARTIAL | `edge_inventory.json` — 13/13 named with repo path, repo bundle sha256, `_shared` import hashes; deployment identity from `edge_boot_events` for 11/13; **E04 crypto-price-sync** and **E13 us-stock-quote** have no boot record at all (BLOCKER-level gaps inside this gate); numeric platform version observable for only 1/13 because `function_edge_logs` retention on this tier is ~1h; **no authoritative `deployed_at` and no production bundle hash is exposed to this agent**, so repo↔prod bundle equality cannot be proven |
| S0-6 freshness contradiction | PASS (resolved, verdict NOT_FRESH) | `freshness_trace.json`. The two earlier readings were **both correct**: chips-guardian auto-flaps the switches. Stable root chain: FinMind BSR HTTP 400 → `data_source_health.finmind_bsr` circuit **open** → guardian disables `chips_backfill`/`chips_keepwarm` → worker admission returns `circuit_open` / `kill_switch_off` → **0 attempt logs, 0 BSR writes in 24h**; last write `2026-08-15 15:07Z`, latest trade_date `2026-08-14`; queue done 9956 / failed 1573 / pending 76; universe: `stock_names` 74 rows (US 17 + 57 unlabelled), **TW master universe still empty**, prefetch targets 20, user holding entries 38 |
| S0-7 baseline smoke | PARTIAL | `smoke/evidence/smoke_anon.json` + screenshots: anon × 10 routes × {production, unpublished Preview} = 20 probes, all HTTP 200, Preview clean; production shows a literal "404" string + 1 console error on `/performance`, `/journals`, `/checkup`, `/auth`, `/account` (recorded as pre-cutover baseline, not introduced by this work). **admin / subscriber / plain identities not yet captured** — each needs an approved `lovable auth-session` mint |

## Blockers before S1 may even be proposed
1. **S0-2a** — backup tier / PITR enabled / retention / last recoverable point are unknown and unreadable here.
2. **S0-2c** — restore rehearsal on a fresh disposable production-shape clone has not been executed.
3. Inside S0-5b — E04 / E13 have no observable production deployment identity; no authoritative `deployed_at` or prod bundle hash exists for any function.
4. Inside S0-7 — 3 authenticated identity baselines outstanding.

## Verdict
**S0 is NOT green. R1-P remains clone-only PASS. Production remains NO-GO. S1 / any production mutation / deploy / Publish is NOT approved.**
