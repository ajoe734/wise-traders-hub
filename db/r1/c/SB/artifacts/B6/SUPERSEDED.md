# SUPERSEDED — B6 (`B6-20260817T144036Z-56423`)

Retained verbatim, not overwritten. `sha256sums.txt` in this directory covers
the original 34 files and intentionally does **not** include this marker.

**Why superseded**: the fingerprint used by this run
(`sb_fingerprint.sql` sha256 `3740c4d7ee755bad9df69b64b562cf24c8396ac90faddc80b2e4bb43ca4f5b52`)
did not capture `obj_description(oid,'pg_proc')`, `pg_get_function_identity_arguments`,
`proleakproof` or `proisstrict`. Its `gap=0` therefore did not cover COMMENT
parity, which was only argued statically in the receipt — an unacceptable
contradiction.

**Superseded by**: `../B8/` (`B8-20260817T145514Z-2630`) and
`../B9/` (`B9-20260817T145542Z-3321`), which extend the fingerprint to the full
metadata + comment set, add a comment drift negative control, and assert
metadata/comment invariance across apply and byte-equivalence across rollback.
See `../../receipt-index.md` and `../../comment-coverage.md`.

Stage B behaviour (migrations `001_stage_b.sql`, `002_recover_gate_aware.sql`,
`099_rollback.sql`, `002_recover_baseline.sql`) was **not** changed between B6/B7
and B8/B9 — their sha256 values are identical in both receipts.
