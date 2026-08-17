# Replaced-function metadata + COMMENT coverage (B8 / B9)

Closes the contradiction in the previous receipt: `gap=0` while COMMENT parity
was only a static argument. Comment / metadata parity is now a **machine
fingerprint assertion**; a comment difference is a FAIL, never a gap.

Stage B behaviour is unchanged. Only `sb_fingerprint.sql` and `sb_rehearsal.sh`
were modified; `001_stage_b.sql`, `002_recover_gate_aware.sql`,
`002_recover_baseline.sql` and `099_rollback.sql` keep the exact sha256 values
recorded for B6/B7.

## What is now fingerprinted

`sb_fingerprint.sql`
(sha256 `1bf4addb430f5e9bde087d4fe9c4e7bc34cb76f2ccaec7df5f780c63a8fb0bd8`)
emits, for every `CREATE OR REPLACE` target that pre-exists in the production
baseline — `recover_quota_failed_bsr_jobs(integer)`,
`recover_stale_bsr_queue_jobs(integer,integer)` and the untouched control
`reap_stale_bsr_queue_jobs(integer)`:

- `replmeta|` line: `oid::regprocedure`, `pg_get_function_identity_arguments`,
  `pg_get_function_arguments` (incl. defaults), `pg_get_function_result`,
  owner, full `proacl`, `proconfig`, `provolatile`, `prosecdef`, `proleakproof`,
  `proisstrict`, language, `obj_description(oid,'pg_proc')` md5 **+ length +
  full text**.
- `replbody|` line: `md5(pg_get_functiondef(oid))` + definition length.

The global `fn|` line for every function in `public` and `private_bsr` also
carries `cmt=<md5>/<len>`, so a comment drift anywhere in those schemas breaks
`SB-10e` too.

## Why a seeded control comment

The exact production baseline bundle contains **zero** `COMMENT ON` statements,
and a read-only production query confirms the three targets have no comment
(`obj_description` = NULL for all three; 6 other public functions do carry
comments, none of them Stage B targets:
`handle_signal_trade()`, `get_expert_capital_status(uuid)`,
`enforce_unit_consistency()`, `log_unit_lock_violation(jsonb)`,
`reconcile_snapshot(date)`, `materialize_bsr_daily_from_fact(date)`).

Asserting "NULL == NULL" would be vacuous. So the harness seeds a deterministic
control comment on each target before the pre-fingerprint — including a
multi-line + non-ASCII payload — and requires it to survive apply and rollback
byte-for-byte.

## Checks added (harness 22 → 32)

| id | assertion | B8 | B9 |
|----|-----------|----|----|
| SB-02a | metadata captured for all 3 replaced targets | PASS | PASS |
| SB-02b | every target carries a non-null comment pre-apply (no vacuous compare) | PASS | PASS |
| SB-02c | **negative control**: comment-only drift IS detected by the fingerprint | PASS | PASS |
| SB-02d | negative control reverted, metadata back to pre-probe state | PASS | PASS |
| SB-03a | post-apply metadata+comment 100% identical (owner/acl/proconfig/provolatile/prosecdef/leakproof/strict/lang/identity args/comment) | PASS | PASS |
| SB-03b | post-apply exactly 2 bodies changed | PASS | PASS |
| SB-03c | `reap_stale_bsr_queue_jobs` body untouched by apply | PASS | PASS |
| SB-10f | post-rollback metadata+comment byte-equivalent | PASS | PASS |
| SB-10g | post-rollback `pg_get_functiondef` byte-equivalent for all 3 targets | PASS | PASS |
| SB-10h | no comment dropped by apply+rollback (NULL count = 0) | PASS | PASS |

## Machine evidence

| artifact | B8 | B9 |
|---|---|---|
| `repl_meta_before.txt` == `repl_meta_apply.txt` == `repl_meta_after.txt` (same sha256) | `82a99de46802ac513f4c8d2a4146816c87f5185de1654e15afd4654bd4e5e7b9` | `2879edc5f40d76b2793ced4c460fac744051cc46acaffc5c9b896243f44b2a66` |
| `repl_meta_apply.diff` / `repl_meta_rollback.diff` | 0 bytes | 0 bytes |
| `repl_body_before.txt` == `repl_body_after.txt` | `28654463671071e785087064543605a30ec26ed30d76d17d8b8787fc787a344a` | same |
| `repl_body_apply.txt` (bodies during apply) | `750d49060be3449ff2934cfaecf04dba8ecefaa8d861668e7e5439f8af35a518` | same |
| `repl_body_rollback.diff` | 0 bytes | 0 bytes |
| `repl_meta_drift.diff` (negative control must be NON-empty) | 2 236 bytes, sha256 `63872405c1be0e228dbeca78a9d0b4336f0876b5773e19cc99a156b3913f0ef9` | 2 236 bytes, sha256 `584fea7f1e6d5ba78996cba64982c982bb2790ecc155696b3b47f69c517be01f` |
| `fp_cat.diff` (whole-catalog rollback diff) | 0 bytes | 0 bytes |

Expected body deltas during apply (identical in both runs, so the change is
deterministic):

```
-replbody|recover_quota_failed_bsr_jobs(integer)|8a50211b18102cda54bdd99fca991a27|len=7118
-replbody|recover_stale_bsr_queue_jobs(integer,integer)|b69234190a85b224858f8eed13811102|len=1166
+replbody|recover_quota_failed_bsr_jobs(integer)|7db78b7920aa30af334ef7772302049e|len=7642
+replbody|recover_stale_bsr_queue_jobs(integer,integer)|a5ced72afc5fca09d4af06dccfd5989b|len=1300
```

`reap_stale_bsr_queue_jobs` appears in neither the `+` nor the `-` side: its
body md5 is unchanged by apply, matching the mechanical source diff in
`artifacts/reaper-scope-diff.md`.

## Residual coverage limits (stated, not hidden)

- Comment parity is proven for the three replaced/adjacent functions and, at
  md5+length granularity, for every function in `public` / `private_bsr` via the
  `fn|…|cmt=` field. Comments on tables, columns, types, schemas and triggers
  are **not** in the fingerprint — no Stage B migration issues any `COMMENT ON`
  statement (`grep -c 'COMMENT ON'` = 0 in all four SQL files), so those objects
  are out of the change surface, but this is a scope statement, not a proof.
- The clone baseline carries no production comments (the restore bundle has no
  `COMMENT ON` statements at all). Comment behaviour is therefore proven against
  a seeded control, not against production's own 6 commented functions.
