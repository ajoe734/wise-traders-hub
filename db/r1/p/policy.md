# R1-P Dual Reporting Policy (clone-verified, production zero-touch)

## 1. Two separated bases
- **as_reported** — what was published at the time. Data corrections are treated as
  cash/quantity events on the day they were booked; a day containing a
  `quantity_adjustment` publishes `daily_return = NULL`, `completeness = 'partial'`.
- **restated** — the corrected history. It may only be built once every replay key
  touching that expert is adjudicated by a human. While any key is withheld,
  `canonical_publish(..., 'restated')` raises
  `restated_basis_blocked_unadjudicated_drift` (test T-P70).

Both bases are stored in `public_nav_daily` under the primary key
`(projection_version, expert_id, currency, trade_date, reporting_basis)` — they can
never be merged into one series (T-P71..T-P73).

## 2. Fail-closed rules
| Missing input | Result |
|---|---|
| position withheld (manual_review) | equity `NULL`, `incomplete_reason = 'withheld_manual_review'` |
| price missing / stale beyond window | `valuation_status` `unpriced`, market_value `NULL`, equity `NULL` |
| US native combo | `valuation_status = 'unsupported'`, no money value ever (T-P75/76) |
| historical FX | `fx_rate_as_of` raises `fx_history_unavailable`; production holds a single undated USDTWD row, so cross-currency roll-ups are refused (T-P74) |

## 3. No auto-correction
`replay_manifest_key` cannot hold an authoritative quantity while
`auto_correction_forbidden` is true (constraint `rmk_no_auto_answer`), replay numbers
are immutable, rows cannot be deleted, and a `manual_review` key cannot be flipped to
publishable. **6515 (穎崴)**: stored 50 and replay 10 are recorded as *candidates only*;
no channel may present either as the answer (T-P20..T-P31).

## 4. Embargo (T+7)
An economic effect reaches a public surface only when
`economic_effect.visible_at IS NOT NULL AND visible_at <= build cutoff`. This is enforced
once, inside `canonical_publish`, so rows, aggregates, portfolio state, NAV, returns and
chart series all inherit it. `anon` additionally cannot read the raw signal row
(RLS policy `signals_embargo_anon`), `trade_records`, `user_performances`, any
`app_ledger` relation, or any versioned projection table.

## 5. Publication swap
Per-expert monotonic pointer (`public_projection_active`). Builds write a fresh
`projection_version`; the pointer flips in one statement at the end. A failed build never
moves the pointer (failure injection), and a concurrent reader observed 200 samples
during 40 swaps with zero mixed-version reads (`091_swap_race.sh`).

## 6. Scope
Clone-only. Nothing in this folder has been applied to production; no Edge deploy, no data
correction, no publish. Rollback (`099_rollback_p.sql` + R1-D rollback + restore) returns a
byte-identical catalog/data hash.
