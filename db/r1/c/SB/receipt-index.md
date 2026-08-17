# Stage B v6 — receipt index (clone rehearsals B6 / B7)

Grep anchors: `B6-20260817T144036Z-56423`, `B7-20260817T144101Z-57053`,
`617299a792bc4a76ee613c477ede77feb993c7fb9314de417c58c96873f81043`,
`b7469f77f71a4415c02274a22c6535d40357489115dfe90ea157aa15b09692dd`.

Nothing in this file was produced against production. No deploy, no Publish, no
Edge Function change. Evidence was landed from already-completed runs; no run
was repeated to produce it.

## 1. Runs

| field | B6 | B7 |
|---|---|---|
| run_id | `B6-20260817T144036Z-56423` | `B7-20260817T144101Z-57053` |
| start (UTC) | `2026-08-17T14:40:36.069Z` | `2026-08-17T14:41:01.341Z` |
| end (UTC) | `2026-08-17T14:40:54.947Z` | `2026-08-17T14:41:18.488Z` |
| clone port (loopback only) | 55833 | 55844 |
| PostgREST port (loopback only) | 3833 | 3844 |
| harness checks / failures | 22 / 0 | 22 / 0 |
| harness exit code | 0 | 0 |
| SQL verifier | `pass=104 fail=0 gap=0` | `pass=104 fail=0 gap=0` |
| PostgREST HTTP proof | `pass=10 fail=0` (exit 0) | `pass=10 fail=0` (exit 0) |
| supabase-js proof | `pass=5 fail=0` (exit 0) | `pass=5 fail=0` (exit 0) |
| clone destroyed | true | true |
| leftover background processes | 0 | 0 |
| full log sha256 (sanitized == raw) | `617299a792bc4a76ee613c477ede77feb993c7fb9314de417c58c96873f81043` | `b7469f77f71a4415c02274a22c6535d40357489115dfe90ea157aa15b09692dd` |
| in-log `log_sha256_pre_result` (hash of the log *before* the RESULT line) | `2515e31dd32d4799f6708a7b4ca950a33d23b555803033623a017f458171a2f1` | `1c0886a454f77f49f65d724e66538136b34b955d92dd652b5b54a5eb76fee3ec` |

## 2. Landed evidence (34 files per run)

`db/r1/c/SB/artifacts/<run>/` — per-file sha256 in that directory's
`sha256sums.txt`.

| file | purpose | B6 sha256 | B7 sha256 |
|---|---|---|---|
| `rehearsal.log` | full sanitized harness log | `617299a792bc4a76ee613c477ede77feb993c7fb9314de417c58c96873f81043` | `b7469f77f71a4415c02274a22c6535d40357489115dfe90ea157aa15b09692dd` |
| `summary.json` | machine-readable result + every check line | `c0aafe77cb582bd76cd62ac785c235cf71ce6593b65e2cc5843d8a11c19290db` | `76993759a7dc028a5e1689e5bd21a96876c825e9ef73a624637954d830c69458` |
| `sha256sums.txt` | checksums of every file in the directory | `19a5bfe054cbb495eb78fe7bb43f071a10bac2d54f5bec397fb982053d50b6c1` | `8d47feed3b3a1a6b06c59971f82bf4b359d9345fabc0da4dc581d451992cf4bf` |
| `acl-matrix.md` | HTTP / PostgREST / supabase-js ACL matrix with status + error codes | `d37fe889b65448c3cdcbcc65390d858b82d6d97541ae63612863c3ebae4fcc6f` | `a1a5288db84fa6ac7dafae50413e5712920d4d4bf4c9a11d4b7af3d75be1607a` |
| `http_proof.log` | raw proof output (sanitized) | see `sha256sums.txt` | see `sha256sums.txt` |
| `verify.out` | 104-check SQL verifier output | `577563f8a9da301de92d1c75a67b31aa6b2cd2fbb9c2986f04d174401bc478f7` | `341a6a92755eb980539c44255f14910c45ae9d49281fb5c4f28121b999bef434` |
| `fp_before.txt` | pre-apply fingerprint (functiondef md5 / secdef / volatility / proconfig / owner / ACL md5 / triggers / nspacl / data) | `d7070058a32ae875b9036b1736e67ad34234c712c049a48efa7ebdb2ceec95fb` | `d7070058a32ae875b9036b1736e67ad34234c712c049a48efa7ebdb2ceec95fb` |
| `fp_after.txt` | post-apply + post-rollback fingerprint | `5c80ea83935cc5c1030aa9447d4692b626a275e6fe815af6b22293e13633833b` | `4cef2786954c14daa2043910debb7cd92f0480ed3575d8f068a5c9204b6b8f9f` |
| `fp_before_cat.txt` / `fp_after_cat.txt` | catalog-only slice used for rollback equality | in `sha256sums.txt` | in `sha256sums.txt` |
| `fp_cat.diff` | rollback catalog diff — **0 bytes** (`e3b0c442…7852b855` = sha256 of empty file) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `queue_fn_before.txt` / `queue_fn_after.txt` / `queue_fn.diff` | owner / ACL / proconfig of every queue-touching function; diff **0 bytes** | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (diff) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (diff) |
| `recover_before.md5` / `recover_after.md5` | `pg_get_functiondef(recover_quota_failed_bsr_jobs)` — both `8a50211b18102cda54bdd99fca991a27` | equal | equal |
| `wrapper_catalog.txt` | post-apply wrapper catalog (secdef / volatility / proconfig / owner / ACL) | `a15b08601502f231c3aa61a685e10763acc5b2e2bc5c48209ddc16dcb3387a87` | `a15b08601502f231c3aa61a685e10763acc5b2e2bc5c48209ddc16dcb3387a87` |
| `rollback.log` | `099_rollback.sql` output | `a2ac8d2b30ed22f8d87469bb263c61742f8e464bcc2174acec2718aeb4766253` | `a2ac8d2b30ed22f8d87469bb263c61742f8e464bcc2174acec2718aeb4766253` |
| `restore.log`, `restore_errors.txt`, `census.txt` | baseline restore (0 errors) + catalog census vs production baseline | in `sha256sums.txt` | in `sha256sums.txt` |
| `barrierA.out`, `barrierB.out`, `chunk.out`, `fuzz.out`, `timeout.out`, `trg.out`, `nsp.out`, `rolecheck.out` | linearization / chunk accounting / 200-iteration fuzz / timeout / trigger / namespace / role checks | in `sha256sums.txt` | in `sha256sums.txt` |
| `apply1.log`, `apply2.log` | migration apply output under `ON_ERROR_STOP=1` (`apply2.log` empty) | in `sha256sums.txt` | in `sha256sums.txt` |
| `pg.filtered.log` + `pg.log.sha256` | server log filtered to errors/warnings/HTTP RPC lines; sha256 of the full 20 755-line original recorded, original not stored (clone destroyed) | full: `5f8772b62198fe221964c1f16b3b91b5862dfffbe761cced7a75d0fb143e46f0` | full: `5cd1182f8c9d9a5600a5e98e5cf42ef9b06ca23b51925575c33d00e28c49f2d7` |

Shared artifacts:

| file | sha256 |
|---|---|
| `db/r1/c/SB/artifacts/reaper-scope-diff.md` | `b65c6d698eb6a669f67a5b5320f7d8c84f64500b548871b692d649fe5bcc7033` |
| `db/r1/c/SB/failure-ledger.md` | `d9a02e941e2662c0d021d3f2769f9c42ab8bec67190aedcfa2ca320e93379767` |

Code under proof (sha256 at the time of the B6/B7 runs):

| file | sha256 |
|---|---|
| `db/r1/c/SB/001_stage_b.sql` | `1240c1f24d0d9fd854f23e12e154b94af63606c2d932562c0fb4655c0911cc4b` |
| `db/r1/c/SB/002_recover_gate_aware.sql` | `fe7e30d4674253d8e976fd51d5ae98baf997404aca488c6d916629f80fe0082a` |
| `db/r1/c/SB/002_recover_baseline.sql` | `8d4f6736463dbe3dfe79ac050573d4a0ab4cfabbbeef5ad3db6384e2cd20a430` |
| `db/r1/c/SB/099_rollback.sql` | `18e1a8e47f95d3d6b651b85bef5874ae939ef027e862700e0e292538af963add` |
| `db/r1/c/SB/sb_verify.sql` | `9ec07966c57db402c62f7587067646e4e7b5f0365062cac7d6574854543d8cb3` |
| `db/r1/c/SB/sb_fingerprint.sql` | `3740c4d7ee755bad9df69b64b562cf24c8396ac90faddc80b2e4bb43ca4f5b52` |
| `db/r1/c/SB/sb_rehearsal.sh` | `dc2f6ae2cebfc8ece97c1320af52a719156b462763daa74be3060aafe5970fc4` |
| `db/r1/c/SB/sb_postgrest_proof.sh` | `f52dbee9dd12d93cdfeaa8f790b13a9dc268290a090c93b51bbc063130f1c9ac` |
| `db/r1/c/SB/sb_supabase_js_proof.mjs` | `16c441ae102de43b493df9081c48bbf01069466c940587e04c05e352e2276c9a` |
| `db/r1/c/SB/sb_clone_up.sh` | `e696bb5d2f5acdda91c6564c1da1e1afae442f84c870e02053f8396867b99bc9` |

## 3. Tool versions

| tool | version |
|---|---|
| PostgreSQL (clone server + psql) | 17.11 (`/nix/store/…postgresql-and-plugins-17.11`) |
| PostgREST | 14.1 (`/nix/store/grkpy61kplv8wrf9iiga06658av4mww9-postgrest-14.1-bin`) |
| `@supabase/supabase-js` | 2.97.0 (client header `supabase-js-node/2.97.0`) |
| Bun | 1.3.3 |
| Python | 3.13.12 |

## 4. Rollback / drift proof

- `SB-10a` `pg_get_functiondef(public.recover_quota_failed_bsr_jobs(int))` md5
  before = after = `8a50211b18102cda54bdd99fca991a27`.
- `SB-10e` catalog fingerprint diff (`fp_cat.diff`) is **0 bytes** in both runs.
  That fingerprint covers, per function in `public` + `private_bsr`:
  `pg_get_functiondef` md5, `prosecdef`, `provolatile`, `proconfig`,
  owner, and ACL md5 — so `recover_stale_bsr_queue_jobs` and every other
  modified object is proven restored, not just the one spot-checked function.
- `SB-10d` `queue_fn.diff` is **0 bytes**: 0 owner / ACL / proconfig drift across
  every queue-touching function.
- `SB-10b` / `SB-10c`: `private_bsr` schema and the admission-gate trigger are
  gone after rollback.
- **COMMENT parity**: `grep -c 'COMMENT ON'` = 0 in `001_stage_b.sql`,
  `002_recover_gate_aware.sql`, `002_recover_baseline.sql`, `099_rollback.sql`,
  i.e. no migration in this stage creates, changes, or drops any object comment;
  comment parity is therefore a static property of the change set. Runtime
  `obj_description()` capture is **not** part of `sb_fingerprint.sql` — noted as
  a known coverage limit rather than claimed as verified.

## 5. Reaper / recovery scope

`db/r1/c/SB/artifacts/reaper-scope-diff.md` holds machine-generated
`difflib.unified_diff` output against the exact production baseline dump:

- `recover_stale_bsr_queue_jobs`: +2 / −0 lines, both inside the
  `failed/skipped -> pending` branch. The `running -> pending` stale-lease branch
  is byte-identical.
- `recover_quota_failed_bsr_jobs`: +8 / −0 lines = the same 4-line predicate in
  two candidate CTEs. `quota_deferred`, `finmind_admission_*` (non-terminal),
  rate-limit and unknown-error semantics are unchanged; only
  `finmind_admission_provider_plan_rejected` gains the
  `OR private_bsr.gate_explicit_open()` condition.
- `reap_stale_bsr_queue_jobs`: 0 occurrences in all Stage B migrations; baseline
  definition quoted verbatim in the same file.

## 6. Production 0-touch proof

- `db/r1/c/SB/sb_rehearsal.sh:51` runs
  `unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE` before any
  database call, so no managed production credential is in scope for the run.
- Every connection in the harness and in `sb_postgrest_proof.sh` is
  `…@localhost:<clone-port>/clone`; PostgREST is bound to
  `server-host = "127.0.0.1"`. Connection strings are redacted in landed
  artifacts.
- Each run ends with `destroyed=true background=0`; the clone data directory is
  removed in the harness `cleanup` trap.
- No `supabase--migration`, `supabase--insert`, `supabase--deploy_edge_functions`,
  cron change, ACL change, deploy or Publish was executed in this or the
  preceding rehearsal turn.

## 7. Honesty markers

- `failure-ledger.md` marks F-02, F-04, F-05, F-06 exact error/assertion text and
  the three earlier-turn items (generated column / audit noise / quota pool) as
  **UNRECOVERABLE GAP** where the originating output no longer exists. No error
  string in that file is reconstructed.
- The unfiltered clone server logs are not stored (2.4 MB each); their sha256 is
  recorded but they cannot be re-derived, since the clones were destroyed.
- Stage B is **not** complete: the Edge worker changes (B-2 / B-6) have not been
  written, and nothing has been applied to production.
