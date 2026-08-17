# Stage B v6 — failure ledger (clone rehearsals only, production 0-touch)

Rule for this file: an *exact error* line is only written here when it can still
be read back from a durable artifact (repo file, landed rehearsal artifact, or
exec log). Where the originating shell/tmp output has already been overwritten
or the clone destroyed, the entry is marked **UNRECOVERABLE GAP (exact error
text)** and only the mechanically re-derivable facts (catalog state, constraint
definition, current file content, rerun result) are stated. Reconstructed or
paraphrased error strings are explicitly forbidden and are not present below.

Runs referenced: `B6-20260817T144036Z-56423`, `B7-20260817T144101Z-57053`
(see `db/r1/c/SB/receipt-index.md`).

---

## F-02 — `002_recover_gate_aware.sql` failed to apply (missing statement separator)

- **Where**: scratch clone (port 55890, destroyed), `psql -v ON_ERROR_STOP=1 -f
  db/r1/c/SB/002_recover_gate_aware.sql`.
- **Observed exit code**: `2` (recorded in the turn's exec output as `a2=2`).
- **Exact error text**: **UNRECOVERABLE GAP (exact error text)** — the psql
  stderr was written to `/tmp/a2.log`, which was overwritten by the next apply
  attempt in the same turn; `grep -rhE "syntax error|ERROR:" /tmp/exec-logs/`
  returns no matching line for this event. Not reconstructed here.
- **Root cause** (mechanically re-derivable): the gate-aware
  `recover_stale_bsr_queue_jobs` definition was appended to the file without a
  terminating `;` separating it from the preceding
  `recover_quota_failed_bsr_jobs` definition, so both `CREATE OR REPLACE`
  statements were parsed as one statement.
- **Patch**: separator restored; current file content is authoritative —
  `db/r1/c/SB/002_recover_gate_aware.sql`
  sha256 `fe7e30d4674253d8e976fd51d5ae98baf997404aca488c6d916629f80fe0082a`.
- **Rerun**: `apply=0` under `ON_ERROR_STOP=1` on clones 55891/55892 and, in the
  final runs, harness check `SB-03 migrations applied with ON_ERROR_STOP` = PASS
  in both B6 and B7 (`artifacts/B6/rehearsal.log`, `artifacts/B7/rehearsal.log`;
  `artifacts/*/apply2.log` is empty = no diagnostics emitted).

## F-03 — `G-queue-unchanged` FAIL: 3 rows resurrected to `pending` while gate closed

- **Where**: B6 run of `db/r1/c/SB/sb_verify.sql` section G (previous turn's
  clone, destroyed).
- **Exact error text**: not an error — a failed assertion. The original
  per-row dump was not produced by that build of the verifier, so the exact
  three row ids are **UNRECOVERABLE GAP (exact row dump)**. The verifier was
  changed so this can never recur silently: `pg_temp.dump_rows()` now prints
  `id/stock_id/trade_date/status/error_code/quota_deferred/attempts/enqueued_by/
  created_at/available_at/started_at/finished_at/correlation_id/updated_at` for
  every residual row (`db/r1/c/SB/sb_verify.sql`).
- **Root cause** (proven, not guessed): `public.enqueue_chips_prefetch_gaps()`
  calls `public.recover_stale_bsr_queue_jobs()`, a *second* recovery predicate
  that was left ungated. Its `failed/skipped -> pending` branch re-queued rows
  whose `last_error = 'finmind_admission_provider_plan_rejected'`, i.e. exactly
  the terminal cohort Stage B must freeze. Baseline definition:
  `db/r1/c/S0/backup/restore/030_functions.sql` line ~8009.
- **Patch**: gate condition added to that branch only —
  `AND (q.last_error IS DISTINCT FROM 'finmind_admission_provider_plan_rejected'
  OR private_bsr.gate_explicit_open())`. Mechanical scope proof (running branch,
  quota / rate-limit / unknown semantics untouched):
  `db/r1/c/SB/artifacts/reaper-scope-diff.md` — `recover_stale_bsr_queue_jobs`
  added 2 lines / removed 0 lines; `recover_quota_failed_bsr_jobs` added 8 lines
  (2 identical predicates × 4 lines) / removed 0 lines;
  `reap_stale_bsr_queue_jobs` has 0 occurrences in every Stage B migration.
- **No data workaround**: the fix contains no `DELETE`, no bulk status sweep.
- **Rerun**: section G iterates gate shapes `true` / missing / malformed for
  three rounds each; terminal cohort pending drift = 0 and zero queue/attempt/
  error/audit noise. B6 and B7 verifier: `SUMMARY pass=104 fail=0 gap=0`.

## F-04 — `E-reaper-race` FAIL: fixture row not reaped

- **Where**: B6 verifier section E (previous clone, destroyed).
- **Exact error text**: **UNRECOVERABLE GAP (exact assertion line)** — that log
  belonged to the destroyed clone and was not landed at the time.
- **Root cause**: the fixture aged only `started_at`, while the real predicate
  in `public.reap_stale_bsr_queue_jobs(_stale_minutes)` also requires an aged
  `updated_at`; the row therefore fell outside the reaper's predicate.
  Baseline definition quoted verbatim in
  `db/r1/c/SB/artifacts/reaper-scope-diff.md` (§ untouched).
- **Patch**: fixture now ages `updated_at` as well; the lost-lease negative
  control (a row whose lease was lost must *not* be terminalized) was kept.
- **Rerun**: section E PASS in B6 and B7 (see `artifacts/*/rehearsal.log`,
  `artifacts/*/verify.out`).

## F-05 — `I-recovery-resumed` FAIL: cumulative token count used

- **Where**: B6 verifier section I (previous clone, destroyed).
- **Exact error text**: **UNRECOVERABLE GAP (exact assertion line)**.
- **Root cause**: the assertion read the cumulative `tokens_issued` counter
  instead of the per-invocation delta, so a second run inherited the first run's
  token and the "at most 1 per run after a successful probe" invariant could not
  be evaluated.
- **Patch**: section I now diffs `tokens_issued` per run, asserts ≤ 1 per run
  after a successful probe fixture, and asserts that a fresh terminal provider
  signal immediately re-blocks the gate and stops recovery.
- **Rerun**: section I PASS in B6 and B7.

## F-06 — `C-open-enqueue_chips_prefetch_gaps` GAP: fixture produced no real gap

- **Where**: verifier section C, clones 55890/55891 (destroyed) and the landed
  B6/B7 runs after the fix.
- **Exact error text**: **UNRECOVERABLE GAP (exact psql error text)** — the
  fixture `INSERT` ran without `ON_ERROR_STOP` inside the verifier, its stderr
  was interleaved into the destroyed clone's `verify.out`, and the surviving
  exec logs contain no matching `ERROR:` line.
- **Root cause** (two independent defects, both proven from catalog / data):
  1. the fixture used `source = 'ops_gapfixture'`, which violates
     `chips_prefetch_targets_source_chk CHECK (source = ANY (ARRAY['demo_seed',
     'manual','ops']))`; the row was absent afterwards —
     `SELECT * FROM chips_prefetch_targets` returned only `2330`.
  2. even with the row present, `enqueue_chips_prefetch_gaps(5, 20)` could not
     produce a delta: earlier writers in the same run had already enqueued the
     last five trading days for both `2330` and `2412`
     (`min=2026-08-13 max=2026-08-17`, observed on the live clone).
- **Patch**: fixture `source = 'ops'`; the writer is now exercised as
  `enqueue_chips_prefetch_gaps(20, 20)` so a real, uncovered gap window exists.
- **Rerun**: `C-open-enqueue_chips_prefetch_gaps` PASS (gate open → delta > 0)
  and `F-closed-enqueue_chips_prefetch_gaps` PASS (gate closed → delta = 0) in
  both B6 and B7; verifier total moved 103 → 104 checks with gap = 0.

## F-07 — `SB-04e` was a GAP: HTTP/ACL proof was `SET ROLE` emulation

- **Where**: previous turn's rehearsals; the harness printed a GAP line because
  no PostgREST binary was available.
- **Root cause**: no real HTTP transport in the sandbox, so role separation was
  only demonstrated in-process via `SET ROLE`, which does not exercise
  PostgREST's JWT decoding, schema exposure, or error mapping.
- **Patch**: PostgREST 14.1 obtained via `nix run nixpkgs#postgrest`;
  `db/r1/c/SB/sb_postgrest_proof.sh` starts a real PostgREST bound to the
  disposable clone with HS256-signed role JWTs, and
  `db/r1/c/SB/sb_supabase_js_proof.mjs` drives the same endpoint through the
  real `@supabase/supabase-js` client (`supabase-js-node/2.97.0`). The harness
  now emits `SB-04e` as PASS/FAIL — the "binary unavailable" branch scores a
  FAIL, never a pass.
- **Rerun**: `HTTP SUMMARY pass=10 fail=0`, `JS SUMMARY pass=5 fail=0` in both
  B6 and B7. Full status / error-code matrix:
  `db/r1/c/SB/artifacts/B6/acl-matrix.md`, `.../B7/acl-matrix.md`.

---

## Earlier-turn failures explicitly NOT reconstructed

The following were mentioned in earlier turns (generated-column restore
handling, audit-noise assertions, quota-pool fixtures). Their originating
clones, shells and tmp logs no longer exist and no landed artifact carries the
verbatim message:

- generated-column restore error — **UNRECOVERABLE GAP (exact error text)**
- audit-noise assertion failure — **UNRECOVERABLE GAP (exact error text)**
- quota-pool fixture failure — **UNRECOVERABLE GAP (exact error text)**

Their current *effect* is nonetheless verifiable without the original text: the
landed B6/B7 runs restore with `SB-01 fresh restore 0 errors`
(`artifacts/*/restore_errors.txt` is empty) and the audit / quota assertions are
part of the 104-check verifier that reports `fail=0 gap=0`.

---

## F-08 — evidence defect: `gap=0` claimed while COMMENT parity was outside the fingerprint (B6/B7)

- **Where**: `db/r1/c/SB/receipt-index.md` §4 (the version published with B6/B7)
  stated that comment parity was "a static property of the change set" and that
  runtime `obj_description()` capture was "not part of `sb_fingerprint.sql`",
  while the same document reported `gap=0` for both runs.
- **Exact defect** (verbatim from the superseded fingerprint,
  `sb_fingerprint.sql` sha256
  `3740c4d7ee755bad9df69b64b562cf24c8396ac90faddc80b2e4bb43ca4f5b52`): the `fn|`
  projection selected only `prosecdef`, `provolatile`, `proconfig`, owner,
  `md5(proacl)` and `md5(pg_get_functiondef)`. No `obj_description`, no
  `pg_get_function_identity_arguments`, no `proleakproof`, no `proisstrict`.
- **Root cause**: a coverage claim (`gap=0`) was made over a fingerprint whose
  column set did not include the attribute being claimed. Not a behaviour bug —
  an evidence bug.
- **Patch** (evidence only, Stage B behaviour untouched — the four migration
  files keep their B6/B7 sha256):
  - `sb_fingerprint.sql` → sha256
    `1bf4addb430f5e9bde087d4fe9c4e7bc34cb76f2ccaec7df5f780c63a8fb0bd8`:
    adds `cmt=<md5>/<len>` to every `fn|` row and emits `replmeta|` / `replbody|`
    blocks for the replaced targets.
  - `sb_rehearsal.sh` → sha256
    `7c2cc07ff4ab38beb26e16e119924d750c5cf0038ead6f18b21f078ea1a66079`:
    seeds a deterministic control comment (multi-line + non-ASCII) before the
    pre-fingerprint, adds SB-02a/b/c/d, SB-03a/b/c, SB-10f/g/h. Harness 22 → 32
    checks. A comment difference scores FAIL; there is no gap branch.
- **Rerun**: two fresh disposable clones — `B8-20260817T145514Z-2630` (port
  55861) and `B9-20260817T145542Z-3321` (port 55872): 32/32 harness checks,
  SQL verifier `pass=104 fail=0 gap=0`, HTTP 10/10, JS 5/5.
  `repl_meta_apply.diff`, `repl_meta_rollback.diff`, `repl_body_rollback.diff`
  and `fp_cat.diff` are all 0 bytes; the negative control
  `repl_meta_drift.diff` is 2 236 bytes (detector proven live).
- **Old artifacts**: `artifacts/B6/` and `artifacts/B7/` are untouched and
  carry `SUPERSEDED.md`.
