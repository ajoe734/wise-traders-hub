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
