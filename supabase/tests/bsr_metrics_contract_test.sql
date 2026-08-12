-- Build 1c Tier B-readonly — metrics / budget JSON contract (read-only calls only)
-- Requires a connection whose role has EXECUTE on the functions (postgres / service_role).
-- The restricted sandbox role cannot run this (42501); in that case it SKIPs and exits
-- non-zero so it can never be mistaken for a PASS.
-- Same assertions are embedded in migration 2026-08-12 (Build 1c) and ran green there.
\set ON_ERROR_STOP on

SELECT NOT has_function_privilege(current_user, 'public.bsr_backlog_metrics()', 'EXECUTE')
       AS cannot_run \gset
\if :cannot_run
  \echo 'bsr_metrics_contract_test: SKIPPED (insufficient role) — PENDING, not PASS'
  DO $skip$ BEGIN RAISE EXCEPTION 'PENDING: insufficient role, not a PASS'; END $skip$;
\endif

-- metrics shape: three separated buckets + split cohort counters
DO $$
DECLARE m jsonb;
BEGIN
  m := public.bsr_backlog_metrics();
  ASSERT m ? 'ready' AND m ? 'deferred' AND m ? 'cohort' AND m ? 'audit';
  ASSERT (m->'ready') ? 'oldest_due_since_h';
  ASSERT (m->'deferred') ? 'oldest_enqueued_age_h';
  ASSERT (m->'ready') ? 'unclaimable_null_count';
  ASSERT (m->'cohort') ? 'legacy_quota_failed_total';
  ASSERT (m->'cohort') ? 'actionable_still_required';
  ASSERT (m->'cohort') ? 'satisfied_reconcilable';
  ASSERT (m->'cohort') ? 'obsolete_retained';
  ASSERT (m#>>'{cohort,counting_mode}') = 'exact';
  ASSERT (m#>>'{cohort,legacy_quota_failed_total}')::int
       = (m#>>'{cohort,satisfied_reconcilable}')::int
       + (m#>>'{cohort,actionable_still_required}')::int
       + (m#>>'{cohort,obsolete_retained}')::int,
       'cohort split must be exhaustive and disjoint';
END $$;

-- budget gates: kill switch / real degrade reason / pool reserve
DO $$
DECLARE b jsonb;
BEGIN
  b := public.bsr_recovery_budget(12);
  ASSERT b ? 'budget' AND b ? 'budget_reason' AND b ? 'pools' AND b ? 'degrade';
  ASSERT (b->>'budget')::int <= 1, 'canary cap is 1 token per invocation';
  ASSERT EXISTS (
    SELECT 1 FROM jsonb_array_elements(b->'pools') p
     WHERE p->>'pool' = 'interactive' AND (p->>'excluded')::boolean
  ), 'interactive pool must be excluded from recovery';
  ASSERT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(b->'pools') p
     WHERE (p->>'issue_ok')::boolean
       AND ((p->>'used_today')::int + 1 > (p->>'daily_budget')::int - 30
            OR (p->>'tokens')::int < 31)
  ), 'issue_ok must respect daily + burst reserve';
END $$;

\echo 'bsr_metrics_contract_test: PASS'
