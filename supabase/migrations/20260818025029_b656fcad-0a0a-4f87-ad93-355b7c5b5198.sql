-- =====================================================================
-- PV 001 — public.public_expert_state_active (missing-relation closure)
--
-- Why this exists
--   commit 2bb098b8a (2026-08-17 04:00:54Z) wired `gatePositionRows` /
--   `useProjectionStatus` into every economic read path. Those readers select
--   `public.public_expert_state_active(expert_id, state, withheld_count,
--   incomplete_count, manual_review_count)`. That relation was never authored
--   in ANY migration (repo-wide search: only frontend readers + e2e mocks).
--   The R1-P clone stack (db/r1/001..004, db/r1/p/001..002) materialises
--   `public_position_active` / `public_portfolio_active` / `public_nav_active`
--   / `public_projection_active` on top of the clone-only `app_ledger` schema —
--   a different name AND a different substrate. So this is NAME DRIFT plus a
--   never-authored migration, not an unapplied one.
--
-- Contract kept intact (fail-closed):
--   * no row visible for a scope   -> reader resolves NO_PROJECTION (closed)
--   * relation/column error        -> reader resolves closed
--   * state='ready'                -> numbers may render (authoritative DB values)
--
-- Security posture:
--   * security_invoker = on  -> base-table RLS (experts / trade_records)
--     decides visibility per caller. The view grants nothing extra: a caller
--     who cannot see an expert row gets no projection row, and therefore
--     stays fail-closed.
--   * NOT security definer. No route/role name is used as an authorisation
--     signal anywhere.
--   * emits COUNTS ONLY — no expert content, no prices, no quantities, no
--     journal text is derivable from this view.
-- =====================================================================

CREATE OR REPLACE VIEW public.public_expert_state_active
WITH (security_invoker = on) AS
SELECT
  e.id AS expert_id,
  0::int AS withheld_count,
  count(t.id) FILTER (
    WHERE t.status = 'open'::trade_status AND t.entry_price IS NULL
  )::int AS incomplete_count,
  0::int AS manual_review_count,
  CASE
    WHEN count(t.id) FILTER (
      WHERE t.status = 'open'::trade_status AND t.entry_price IS NULL
    ) > 0 THEN 'incomplete'
    ELSE 'ready'
  END AS state
FROM public.experts e
LEFT JOIN public.trade_records t ON t.expert_id = e.id
GROUP BY e.id;

COMMENT ON VIEW public.public_expert_state_active IS
  'R1-P projection status per expert (counts only, security_invoker=on). '
  'withheld_count / manual_review_count are 0 because the adjudication ledger '
  '(app_ledger.replay_manifest_key) is clone-only and not deployed here; '
  'incomplete_count counts open trades with no entry price. Readers fail closed '
  'when no row is visible.';

GRANT SELECT ON public.public_expert_state_active TO anon, authenticated, service_role;