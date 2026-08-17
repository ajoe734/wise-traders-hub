# Stage B — Edge rehearsal failure ledger

Append-only. Every failed or aborted Edge rehearsal run is recorded here, with its
sanitized artifacts, exit code and root cause. A run that produces no `EDGE SUMMARY`
line is a FAIL, never a skip.

---

## EF-01 — B10 aborted at `admin_auth`

| field | value |
| --- | --- |
| run_id | `B10-20260817T151758Z-21921` |
| start / end (UTC) | 2026-08-17T15:17:58.640Z / 2026-08-17T15:18:19.046Z |
| exit code | `1` |
| checks executed / planned | 31 / 44 |
| failures | 14 (13 assertion failures + missing-summary FAIL) |
| clone destroyed | yes |
| production touch | none (PG* unset; loopback ports only) |
| artifacts | `db/r1/c/SB/artifacts/B10-failed/` |
| `rehearsal.log` sha256 | `c9d2e42ad739d6332279227145c183e0df663f9bcdeab21e04cb3eff1a4da31c` |
| in-log `log_sha256_pre_result` | `64fd24b110c8ed04949035a39c039a1ce5920ef9272e73430c6253c60a4028ee` |

### The 14 failures

1. `EB-11` worker did NOT short-circuit on admission_gate_closed
2. `EB-12` worker payload reports admission decision=open
3. `EB-13` provider WAS called while gate open (0 calls)
4. `EB-15` enqueue payload reports decision=open
5. `EB-21` worker halted on exact terminal signature
6. `EB-22` single atomic block+terminalize RPC succeeded
7. `EB-23` gate transitioned blocked
8. `EB-24` DB gate is closed after the run
9. `EB-25` this run's claimed rows terminalized (0)
10. `EB-34` gate version surfaced in HTTP payload
11. `EB-41` enqueue reports decision=blocked
12. `EB-42` enqueue reports terminal_code
13. `FATAL stage=admin_auth: baseline has no company_admin to test with`
14. `NO EDGE SUMMARY — aborted at stage=admin_auth exit=1`

### Root cause

**RC-1 — schema-only baseline, no gate row (harness fixture defect).**
`db/r1/c/S0/backup/MANIFEST.json` sets `restore_bundle.row_data_included = false`.
The clone therefore restores `public.tw_bsr_sync_config` with zero rows, so the
`market_batch` gate row is absent. The harness `open_gate()` used
`UPDATE ... WHERE key='market_batch'`, which matched 0 rows, so the gate never opened.
Every worker/enqueue call resolved `decision=missing`,
`reason=admission_gate_row_missing` and correctly fail-closed. Consequently the
open-path, terminal-path and the blocked-path `gate_version` / `terminal_code`
assertions were asserting against a state the run never entered.

This is **not** a product bug: production *does* carry `market_batch`
(version 7 at the time of this run), and fail-closed-on-missing is the approved v6
behaviour.

**RC-2 — no identities in the clone (harness fixture defect).**
Same schema-only restore ⇒ `auth.users` and `public.user_roles` are empty, so no
`company_admin` and no non-admin user exist. The `admin_auth` stage called `fatal()`
and terminated the run before EB-50..EB-96 executed.

**RC-3 — no real GoTrue (coverage gap).**
The auth matrix was to be driven with locally minted HS256 JWTs, which would have
proved PostgREST JWT verification rather than a real `auth.getUser()` round trip.

### Fix applied (B12/B13, new clones — B10 is NOT re-used and NOT overwritten)

* Clone-only fixture transaction seeds an explicit, schema-legal `market_batch`
  gate row (`admission_blocked=false`, nonce, version) — **never** in a production
  migration; it lives in `db/r1/c/SB/fixtures/010_clone_fixture.sql`.
* Clone-only fixture seeds `auth.users` + `public.user_roles` identities.
* A real `supabase/auth` (GoTrue) v2.195.0 server is started against the clone and
  every admin assertion uses tokens it actually issued.

---

## EF-04 — B12 aborted before the provider because the clone had NO FinMind quota pool

* run_id: `B12-20260817T153357Z-35032`
* artifact: `db/r1/c/SB/artifacts/B12-failed/rehearsal.log` (preserved, never overwritten)
* first failing check: `EB-13 provider WAS called while gate open (0 calls)`

### Exact evidence (verbatim from the B12 worker HTTP payload)

```
"admission":{"decision":"open","blocked":false,"gate_version":1}
"claimed":1,"processed":1,"jobs_quota_deferred":1,"jobs_failed":0,"rows_written":0
"jobs":[{"id":1,"stock_id":"2330","trade_date":"2026-08-14","outcome":"quota_deferred","last_error":"quota_deferred"}]
"results":[{"id":1,"stock_id":"2330","ok":false,"rows":0,
            "error":"finmind_admission_pool_not_found:pool=interactive"}]
```

The admission **gate** was open and the worker **did** claim jobs (claimed=1, then
claimed=2 in the terminal stage). It never called the provider because the
*separate* FinMind **quota admission** layer rejected every job.

### Root cause — RC-4 (harness fixture defect, NOT a product bug)

`public.finmind_quota_pools` is PK'd on `pool_name` and is empty on a fresh clone
(`db/r1/c/S0/backup/MANIFEST.json` → `restore_bundle.row_data_included = false`).
`public.finmind_admit_v2()` opens with
`SELECT * INTO p FROM public.finmind_quota_pools WHERE pool_name = _pool FOR UPDATE;`
and, on `IF NOT FOUND`, returns `{"granted":false,"reason":"pool_not_found"}`.
The worker maps that to `finmind_admission_pool_not_found:pool=interactive` and
defers the job (`quota_deferred`) *before* any fetch — the approved fail-closed
behaviour. Production carries all three pools (read-only SELECT 2026-08-17:
interactive 240/47, keepwarm 960/16, backfill 384/0), so production is unaffected.

Because the run never reached the provider, every downstream terminal /
blocked / probe assertion (EB-21..25, EB-31..34, EB-41/42, EB-53/56/57,
EB-6*, EB-81/83/87) was asserting against a state the run could not enter.
They are consequences of RC-4, not independent defects.

### Fix (clone-only)

`db/r1/c/SB/fixtures/010_clone_fixture.sql` now seeds the three schema-legal
pools (interactive / keepwarm / backfill) with `used_today=0`, full tokens and a
Taipei-today `reset_at`. No real tokens, no credentials, no production migration.
B12 is NOT re-used: verification moves to fresh clones B14/B15.

---

## EF-05 — T1/T2 hang at `stage concurrency` (harness bug, confirmed by code read)

`db/r1/c/SB/sb_edge_rehearsal.sh` (pre-fix, line 374) launched the two concurrent
worker POSTs as background subshells and then called a **bare `wait`**:

```
( post "$W" "$DIR/w_c1.json" ... >"$DIR/c1.code" ) &
( post "$W" "$DIR/w_c2.json" ... >"$DIR/c2.code" ) &
wait
```

A bare `wait` waits for **every** child of the shell — which at that point
includes the long-lived services this same script started earlier and kept
running on purpose: PostgREST (line 109), `sb_rest_proxy.py` (110), GoTrue
(119), `sb_provider_mock.py` (121) and the two Deno edge drivers (150, 151).
Those never exit, so `wait` blocks forever and T1/T2 could never reach EB-90.
This is a harness defect only — no DB deadlock, no worker deadlock, no product
code involved. (`pg_locks` was NOT the cause and product code was NOT changed.)

### Fix (harness only)
- `post()` now runs `curl --max-time ${POST_MAX_TIME:-60}`.
- Concurrency stage stores `CP1`/`CP2` immediately and **bounded-waits only those
  two PIDs** (`CONC_DEADLINE`, default 90s), polling with `kill -0`.
- Each worker records its own curl rc (`c1.rc`/`c2.rc`) and HTTP code
  (`c1.code`/`c2.code`); `wait $PID` exit codes are captured with `set +e` so a
  non-zero result is never swallowed by `set -e` — it lands in
  `concurrency.out` (+ `concurrency_timeout.txt`) and fails loud via
  **EB-89 / EB-89b / EB-90**.
- New **EB-92b** asserts every long-lived service PID is still alive after the
  concurrency stage; the cleanup trap remains the last thing to reap them.
- Bare `wait` is now banned in this harness.

T1/T2 hang evidence is retained (not overwritten).
