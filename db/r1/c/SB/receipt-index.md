# Stage B v6 — receipt index v2 (authoritative runs: B8 / B9)

Grep anchors: `B8-20260817T145514Z-2630`, `B9-20260817T145542Z-3321`,
`cd58d0fc6486cdfce289f97df41f4210bd19522f05a6d94c452876782998c4f8`,
`98df2e28bb5471d3b1cc4a3adce4ba22c99ea7f7fbe480f46e11c0f00292a92e`.

Superseded runs (retained verbatim, never overwritten):
`B6-20260817T144036Z-56423` → `artifacts/B6/` + `artifacts/B6/SUPERSEDED.md`,
`B7-20260817T144101Z-57053` → `artifacts/B7/` + `artifacts/B7/SUPERSEDED.md`.
Their logs and sha256 (`617299a792bc4a76ee613c477ede77feb993c7fb9314de417c58c96873f81043`,
`b7469f77f71a4415c02274a22c6535d40357489115dfe90ea157aa15b09692dd`) remain valid
for what they measured; they are superseded only because their fingerprint did
not cover COMMENT / identity-argument / leakproof / strict metadata.

Production 0-touch. No deploy, no Publish, no Edge Function change, no cron or
ACL change. Only two evidence files changed (`sb_fingerprint.sql`,
`sb_rehearsal.sh`); Stage B behaviour SQL is byte-identical to the B6/B7 runs.

## 1. Runs

| field | B8 | B9 |
|---|---|---|
| run_id | `B8-20260817T145514Z-2630` | `B9-20260817T145542Z-3321` |
| start (UTC) | `2026-08-17T14:55:14.920Z` | `2026-08-17T14:55:42.735Z` |
| end (UTC) | `2026-08-17T14:55:34.520Z` | `2026-08-17T14:56:00.098Z` |
| clone port (loopback only) | 55861 | 55872 |
| PostgREST port (loopback only) | 3861 | 3872 |
| harness checks / failures | 32 / 0 | 32 / 0 |
| harness exit code | 0 | 0 |
| SQL verifier | `pass=104 fail=0 gap=0` | `pass=104 fail=0 gap=0` |
| PostgREST HTTP proof | `pass=10 fail=0` (exit 0) | `pass=10 fail=0` (exit 0) |
| supabase-js proof | `pass=5 fail=0` (exit 0) | `pass=5 fail=0` (exit 0) |
| clone destroyed | true | true |
| leftover background processes | 0 | 0 |
| full sanitized log sha256 (== raw; nothing needed redacting) | `cd58d0fc6486cdfce289f97df41f4210bd19522f05a6d94c452876782998c4f8` | `98df2e28bb5471d3b1cc4a3adce4ba22c99ea7f7fbe480f46e11c0f00292a92e` |
| in-log `log_sha256_pre_result` | `0a31a085d43aa359578d7c4ef2231055ea55a73c81345b2caccb3e12d2613ec4` | `d6d72a050a9872cee4d1c64bf308720a515f357869a4bd4fc1ce0c68f3c37481` |
| full clone server log sha256 (20 984 lines, not stored) | `34e739b6b2d3c404eabb58053d95df2fe8a470c20b202b846eb794f11160c57c` | `857b41e94c9fc71d9d2f5aa43849cb7bca626fd281ce2574579d1b316e6bf804` |

## 2. Metadata + COMMENT coverage (the reason for v2)

Full write-up: `db/r1/c/SB/comment-coverage.md`
(sha256 `7da4bb54d8ac46c3f72468dc726dfd31bfde9cfc4c898625cece6d6f77a5a31c`).

Fingerprinted per replaced target (`recover_quota_failed_bsr_jobs(integer)`,
`recover_stale_bsr_queue_jobs(integer,integer)`, plus untouched control
`reap_stale_bsr_queue_jobs(integer)`): identity arguments, full argument list
with defaults, result type, owner, full `proacl`, `proconfig`, `provolatile`,
`prosecdef`, `proleakproof`, `proisstrict`, language,
`obj_description(oid,'pg_proc')` md5 + length + full text, and
`md5(pg_get_functiondef)` + length. Every `fn|` row in `public` / `private_bsr`
additionally carries `cmt=<md5>/<len>`.

| assertion | artifact | B8 | B9 |
|---|---|---|---|
| pre-apply metadata captured for 3 targets, all with non-null comment | `repl_meta_before.txt` | PASS | PASS |
| negative control — comment-only drift IS detected | `repl_meta_drift.diff` **non-empty**, 2 236 B | `63872405c1be0e228dbeca78a9d0b4336f0876b5773e19cc99a156b3913f0ef9` | `584fea7f1e6d5ba78996cba64982c982bb2790ecc155696b3b47f69c517be01f` |
| post-apply metadata+comment 100% identical | `repl_meta_apply.diff` = 0 B | PASS | PASS |
| post-apply exactly 2 bodies changed, reaper untouched | `repl_body_apply.diff` | PASS | PASS |
| post-rollback metadata+comment byte-equivalent | `repl_meta_rollback.diff` = 0 B | PASS | PASS |
| post-rollback `pg_get_functiondef` byte-equivalent (all 3) | `repl_body_rollback.diff` = 0 B | PASS | PASS |
| no comment dropped by apply+rollback | `repl_meta_after.txt` (`comment_md5=NULL` count 0) | PASS | PASS |
| whole-catalog rollback equality (now incl. `cmt=`) | `fp_cat.diff` = 0 B | PASS | PASS |

`repl_meta_before.txt` / `repl_meta_apply.txt` / `repl_meta_after.txt` share one
sha256 per run — B8 `82a99de46802ac513f4c8d2a4146816c87f5185de1654e15afd4654bd4e5e7b9`,
B9 `2879edc5f40d76b2793ced4c460fac744051cc46acaffc5c9b896243f44b2a66` (they
differ between runs only because the seeded control comment embeds the run_id).
`repl_body_before.txt` == `repl_body_after.txt` ==
`28654463671071e785087064543605a30ec26ed30d76d17d8b8787fc787a344a` in **both**
runs; the during-apply body set is
`750d49060be3449ff2934cfaecf04dba8ecefaa8d861668e7e5439f8af35a518` in both,
i.e. the body delta is deterministic and reproducible across clones.

A comment difference scores **FAIL**. There is no gap branch for comments.

## 3. Landed evidence

`db/r1/c/SB/artifacts/<run>/` — 51 files each, per-file sha256 in that
directory's `sha256sums.txt`.

| file | purpose | B8 sha256 | B9 sha256 |
|---|---|---|---|
| `rehearsal.log` | full sanitized harness log (32 checks) | `cd58d0fc6486cdfce289f97df41f4210bd19522f05a6d94c452876782998c4f8` | `98df2e28bb5471d3b1cc4a3adce4ba22c99ea7f7fbe480f46e11c0f00292a92e` |
| `summary.json` | machine-readable result + every check line | `f8aca22cd5eb6b404864b70bdf99b2d724a61c297a18a55b6b084dbdcbf3b9cb` | `4178b39c0972ed66dd4cd63deb807af9c574f78c629cfdc6ee26bdeea32b81a2` |
| `sha256sums.txt` | checksums of every file in the directory | `d4b468b413e1b78755395f013195a64925393bf8b5685cf0825d4f0a108c5055` | `9282f5d53a94a48db523c97390f755abf041795082856711cd5716abf0bdc1ba` |
| `verify.out` | 104-check SQL verifier output | `93d2f9a70d9ea59ba57d39ca36942017f0375c8d75ef82544a8fa410eea26e6f` | `2e782882f086b34e812df7827580f382d94cf87d6bf1631bf29aa982f9975cd8` |
| `acl-matrix.md` | real HTTP / PostgREST / supabase-js ACL matrix (status + error codes) | `ff89a0933492d7083a3e010288f8f996f04b84472a5b0149122e67cd9db20455` | `5d4f876c1384069905f34f2f971b6a0d0849c652b12815c195fec55e0e5e68f4` |
| `fp_before.txt` | pre-apply fingerprint (catalog + comments + data) | `3673c00ed0a6563e5327d66143b031454c381322ff6923c79cc223bb5f98afde` | `e0c807376d810871d3a497a46aa79859b45c75726219f60690141da4b128a3cb` |
| `fp_apply.txt` | **post-apply** fingerprint (new in v2) | `567014742694aef0cfb378e1723b507d8596e35f5e6f2136ecd1ac6dfc4533ab` | `0c5fa347668ceb4397531371ce8ee811980efcd322035ad2a06e5151e5f3e71b` |
| `fp_after.txt` | post-rollback fingerprint | `ac6418dcf390c57b05087d5e5ce91ea3d37c46e706496dc1e5a6605d13861e01` | `cca9ed71905311ee52b624b007150bb574f29666ed59ad543d4cde32428192ee` |
| `repl_meta_*` / `repl_body_*` (11 files) | replaced-function metadata/comment/body at pre / drift-probe / restored / apply / rollback | see §2 + `sha256sums.txt` | see §2 + `sha256sums.txt` |
| `fp_cat.diff`, `queue_fn.diff`, `repl_meta_apply.diff`, `repl_meta_rollback.diff`, `repl_body_rollback.diff` | all **0 bytes** (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`) | equal | equal |
| `restore.log`, `restore_errors.txt` (empty), `census.txt` | baseline restore 0 errors + catalog census vs production baseline | `sha256sums.txt` | `sha256sums.txt` |
| `apply1.log`, `apply2.log`, `rollback.log`, `wrapper_catalog.txt` | migration apply/rollback under `ON_ERROR_STOP=1` | `sha256sums.txt` | `sha256sums.txt` |
| `barrierA.out`, `barrierB.out`, `chunk.out`, `fuzz.out`, `timeout.out`, `trg.out`, `nsp.out`, `rolecheck.out`, `http_proof.log` | barrier / chunk accounting / 200-iteration fuzz / timeout / trigger / namespace / role / HTTP proofs | `sha256sums.txt` | `sha256sums.txt` |
| `pg.filtered.log` + `pg.log.sha256` | filtered clone server log; sha256 of the full 20 984-line original recorded, original not stored (clone destroyed) | `824a1d3324793242c0f66177a2252012420a00b23240d06a1b1d07ae9d8a8cba` (sha file) | `3684896eb5f41ef836cd6c084cd27653cc6910cea0d5ccb2afb3acfb8a889eaf` (sha file) |

Shared documents:

| file | sha256 |
|---|---|
| `db/r1/c/SB/comment-coverage.md` | `7da4bb54d8ac46c3f72468dc726dfd31bfde9cfc4c898625cece6d6f77a5a31c` |
| `db/r1/c/SB/failure-ledger.md` (F-02…F-08) | `fa5f6190e33038d931817dff4c99e87f9894c4e55b5197616efb427eea3042ee` |
| `db/r1/c/SB/artifacts/reaper-scope-diff.md` | `b65c6d698eb6a669f67a5b5320f7d8c84f64500b548871b692d649fe5bcc7033` |
| `db/r1/c/SB/artifacts/B6/SUPERSEDED.md` | `0ad450317182bca0888e35ff83e37148a480973a94b4f1ece53c29226c75deee` |
| `db/r1/c/SB/artifacts/B7/SUPERSEDED.md` | `b4338768958156391144db0ca7b57e941d2263b54e5475ea7a734b9dba144e7d` |

Code under proof at B8/B9 time — the four behaviour files are **unchanged** from
B6/B7; only the two evidence files moved:

| file | sha256 | changed since B6/B7 |
|---|---|---|
| `db/r1/c/SB/001_stage_b.sql` | `1240c1f24d0d9fd854f23e12e154b94af63606c2d932562c0fb4655c0911cc4b` | no |
| `db/r1/c/SB/002_recover_gate_aware.sql` | `fe7e30d4674253d8e976fd51d5ae98baf997404aca488c6d916629f80fe0082a` | no |
| `db/r1/c/SB/002_recover_baseline.sql` | `8d4f6736463dbe3dfe79ac050573d4a0ab4cfabbbeef5ad3db6384e2cd20a430` | no |
| `db/r1/c/SB/099_rollback.sql` | `18e1a8e47f95d3d6b651b85bef5874ae939ef027e862700e0e292538af963add` | no |
| `db/r1/c/SB/sb_verify.sql` | `9ec07966c57db402c62f7587067646e4e7b5f0365062cac7d6574854543d8cb3` | no |
| `db/r1/c/SB/sb_postgrest_proof.sh` | `f52dbee9dd12d93cdfeaa8f790b13a9dc268290a090c93b51bbc063130f1c9ac` | no |
| `db/r1/c/SB/sb_supabase_js_proof.mjs` | `16c441ae102de43b493df9081c48bbf01069466c940587e04c05e352e2276c9a` | no |
| `db/r1/c/SB/sb_clone_up.sh` | `e696bb5d2f5acdda91c6564c1da1e1afae442f84c870e02053f8396867b99bc9` | no |
| `db/r1/c/SB/sb_fingerprint.sql` | `1bf4addb430f5e9bde087d4fe9c4e7bc34cb76f2ccaec7df5f780c63a8fb0bd8` | **yes** (was `3740c4d7…4f5b52`) |
| `db/r1/c/SB/sb_rehearsal.sh` | `7c2cc07ff4ab38beb26e16e119924d750c5cf0038ead6f18b21f078ea1a66079` | **yes** (was `dc2f6ae2…f1c9ac`) |

## 4. Tool versions

| tool | version |
|---|---|
| PostgreSQL (clone server + psql) | 17.11 |
| PostgREST | 14.1 (`/nix/store/grkpy61kplv8wrf9iiga06658av4mww9-postgrest-14.1-bin`) |
| `@supabase/supabase-js` | 2.97.0 (`supabase-js-node/2.97.0`) |
| Bun | 1.3.3 |
| Python | 3.13.12 |

## 5. Rollback / drift proof

- `SB-10a` `pg_get_functiondef(recover_quota_failed_bsr_jobs(int))` md5 before ==
  after == `8a50211b18102cda54bdd99fca991a27` (both runs).
- `SB-10e` catalog fingerprint diff = 0 bytes; the fingerprint now covers, per
  function in `public` + `private_bsr`: functiondef md5, `prosecdef`,
  `provolatile`, `proconfig`, owner, ACL md5 **and comment md5 + length**.
- `SB-10f/g/h` replaced-target metadata, comment and full functiondef are
  byte-equivalent after rollback; no comment was dropped.
- `SB-10d` `queue_fn.diff` = 0 bytes (owner / ACL / proconfig).
- `SB-10b/c` `private_bsr` schema and admission-gate trigger removed.
- Change-surface statement: all four Stage B SQL files contain
  `COMMENT ON` × 0, so no object comment is created, altered or dropped by the
  migrations; §2 proves the runtime consequence instead of asserting it.

## 6. Reaper / recovery scope

Unchanged from the superseded receipt and re-verified mechanically in
`artifacts/reaper-scope-diff.md`: `recover_stale_bsr_queue_jobs` +2/−0 lines in
the `failed/skipped` branch only, `recover_quota_failed_bsr_jobs` +8/−0 lines
(same predicate in two CTEs), `reap_stale_bsr_queue_jobs` 0 occurrences in every
Stage B migration. B8/B9 add the runtime counterpart: `SB-03c` proves the
reaper's `pg_get_functiondef` md5 is untouched by apply.

## 7. Production 0-touch proof

- `sb_rehearsal.sh` unsets `PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE`
  before any database call; every connection is `localhost:<clone-port>/clone`
  and PostgREST binds `127.0.0.1`.
- Both runs end `destroyed=true background=0`; clone data directories removed by
  the harness cleanup trap.
- The only production contact this turn was a read-only `SELECT` over
  `pg_proc` / `obj_description` to establish that the three replaced functions
  carry no production comment (result recorded in `comment-coverage.md`).
- No migration, insert, edge deploy, cron change, ACL change or Publish was
  executed.

## 8. Honesty markers

- B6/B7 are **superseded, not deleted or rewritten**; their directories and
  original `sha256sums.txt` are byte-identical to when they were landed, with a
  `SUPERSEDED.md` marker added alongside (deliberately outside their checksum
  file).
- Comment parity is proven for functions. Comments on tables, columns, types,
  schemas and triggers are outside the fingerprint; no Stage B statement touches
  them (scope statement, explicitly not a proof).
- The clone baseline restore bundle contains no `COMMENT ON` statements, so
  comment behaviour is proven against a seeded control comment rather than
  against production's own 6 commented functions.
- Unfiltered clone server logs are not stored; their sha256 is recorded and the
  clones are destroyed, so they cannot be re-derived.
- `failure-ledger.md` still marks F-02/F-04/F-05/F-06 and three earlier-turn
  items as **UNRECOVERABLE GAP** for exact error text.
- Stage B is **not** complete: the Edge worker changes (B-2 / B-6) have not been
  written, and nothing has been applied to production.
