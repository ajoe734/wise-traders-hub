# R1-P STATUS — REPLAY + PUBLIC PROJECTION + EMBARGO CLOSURE

VERDICT: **IN PROGRESS — consumer closure re-run pending final two-clone acceptance** — production zero-touch (no DDL/DML, no Edge deploy, no data correction, no publish).

| Gate | r1pA | r1pB |
|---|---|---|
| schema errors | 0 | 0 |
| fidelity / shape | 104/104, 63/63 | 104/104, 63/63 |
| R1-D 090_verify regression | 66 tests, 0 fail | 66 tests, 0 fail |
| R1-P 090_verify_p | 63 tests, 0 fail | 63 tests, 0 fail |
| 091_swap_race (40 swaps / 200 reads) | 0 violations | 0 violations |
| failure injection (pointer held) | PASS | PASS |
| rollback hash before == after | IDENTICAL | IDENTICAL |
| clone destroyed | yes | yes |

Manifest reconciliation (production read-only): 84 = 48 match + 17 multiple_apply
+ 9 signal_only + 6 stored_only + 3 incomplete + 1 other; drift set = 17 + 9 = 26;
unit_ambiguous 24 (84-key basis) / 24 (76-pair basis); market_ambiguous 16 (84-key basis)
= 8 (76-pair basis, the R0 number) and 10 of the 26 drift keys. One definition only
(replay-84.json["ambiguity"]["definition"]); every JSON/status/test uses these exact numbers.
fx_history_unavailable 34 (single undated USDTWD row).
6515 穎崴: stored 50 vs replay 10, manual_review, withheld, no authoritative answer.

Deliverables: replay-84.json, drift-26.json, consumer-matrix.json, policy.md,
manifest_replay.sql, 001_projection.sql, 002_public_contract.sql, 010_manifest_seed.sql,
090_verify.sql, 090_verify_p.sql, 091_swap_race.sh, 092_embargo.sh, 099_rollback_p.sql,
run_two_fresh_clones.sh, run_two_fresh_clones_p.sh, public_legacy_readers.json, evidence/.

Derivative open positions (production read-only, replay-84.json["derivative_open_positions"]):
4/4 TW warrant opens (068003, 071745 -> tw_warrant master hit; 078397, 079052 -> conservative
unknown_derivative, absent from master) and 3/3 US option combos (LUNR/RKLB/SNDK) all carry
derivative_supported=false and public_disposition=withheld_incomplete. Rule: a derivative is
supported only with a complete quote+multiplier chain AND an adjudicated quantity basis
(class=match, single unit); drifted or unit-ambiguous derivative keys fail closed.

Public legacy readers: 10 = 6 gated by the typed public contract + 4 proven authenticated-only
(see public_legacy_readers.json).
