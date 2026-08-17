# SUPERSEDED — B7 (`B7-20260817T144101Z-57053`)

Retained verbatim, not overwritten. `sha256sums.txt` in this directory covers
the original 34 files and intentionally does **not** include this marker.

**Why superseded**: same defect as B6 — the fingerprint
(`sb_fingerprint.sql` sha256 `3740c4d7ee755bad9df69b64b562cf24c8396ac90faddc80b2e4bb43ca4f5b52`)
omitted `obj_description(oid,'pg_proc')`, `pg_get_function_identity_arguments`,
`proleakproof` and `proisstrict`, so `gap=0` did not cover COMMENT parity.

**Superseded by**: `../B8/` (`B8-20260817T145514Z-2630`) and
`../B9/` (`B9-20260817T145542Z-3321`). See `../../receipt-index.md` and
`../../comment-coverage.md`.

Stage B behaviour was **not** changed between B7 and B8/B9; only the evidence
coverage (fingerprint SQL + harness checks) changed.
