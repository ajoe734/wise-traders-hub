-- =====================================================================
-- R1-P 002 — PUBLIC READ CONTRACT + EMBARGO / ACL CLOSURE
-- Clone-only. Undone by db/r1/p/099_rollback_p.sql.
--
--   C1 the only anon-readable economic surfaces are the three *_active views
--      plus the pointer table; every internal table is revoked.
--   C2 RLS is enabled on the versioned projection tables so a future GRANT
--      accident cannot leak an inactive (or embargoed) version.
--   C3 no admin / build / publish function keeps PUBLIC or anon EXECUTE.
--   C4 raw economic tables are not anon-readable (embargo cannot be bypassed
--      by reading expert_signals / trade_records directly).
-- =====================================================================
SET lock_timeout = '5s';

-- ---------------------------------------------------------------- C2: RLS
ALTER TABLE public.public_position_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_portfolio_state     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_nav_daily           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_projection_version  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_projection_withheld ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_projection_active   ENABLE ROW LEVEL SECURITY;

-- no policy on the versioned tables == deny for anon/authenticated
DROP POLICY IF EXISTS pointer_public_read ON public.public_projection_active;
CREATE POLICY pointer_public_read ON public.public_projection_active
  FOR SELECT TO anon, authenticated USING (true);

-- ---------------------------------------------------------------- C1: grants
REVOKE ALL ON public.public_position_projection, public.public_portfolio_state,
              public.public_nav_daily, public.public_projection_version,
              public.public_projection_withheld
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_position_projection, public.public_portfolio_state,
                public.public_nav_daily, public.public_projection_version,
                public.public_projection_withheld TO service_role;

GRANT SELECT ON public.public_position_active, public.public_portfolio_active,
                public.public_nav_active, public.public_projection_active
  TO anon, authenticated, service_role;

-- the *_active views are SECURITY DEFINER style reads: they must run with the
-- view owner's rights so that RLS on the base tables does not blank them out.
ALTER VIEW public.public_position_active  SET (security_invoker = false);
ALTER VIEW public.public_portfolio_active SET (security_invoker = false);
ALTER VIEW public.public_nav_active       SET (security_invoker = false);

-- ---------------------------------------------------------------- public API surface
-- one narrow, embargo-safe read model for the site/app. It exposes only
-- adjudicated, published, active-version facts and never a withheld key.
CREATE OR REPLACE VIEW public.public_expert_positions_v1 AS
  SELECT p.expert_id, p.instrument, p.market, p.currency, p.quantity, p.quantity_unit,
         p.avg_cost, p.valuation_status, p.valuation_price, p.price_as_of, p.market_value
    FROM public.public_position_active p;

CREATE OR REPLACE VIEW public.public_expert_nav_v1 AS
  SELECT n.expert_id, n.currency, n.trade_date, n.equity, n.daily_return,
         n.completeness, n.reporting_basis, n.correction_flag
    FROM public.public_nav_active n
   WHERE n.completeness <> 'unavailable';

GRANT SELECT ON public.public_expert_positions_v1, public.public_expert_nav_v1
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------- C4: raw tables
REVOKE ALL ON public.trade_records      FROM anon;
REVOKE ALL ON public.user_performances  FROM anon;
-- expert_signals keeps anon SELECT only through RLS-guarded published rows;
-- the embargo itself is enforced by RLS below.
DROP POLICY IF EXISTS signals_embargo_anon ON public.expert_signals;
CREATE POLICY signals_embargo_anon ON public.expert_signals
  FOR SELECT TO anon
  USING (
    status = 'published'
    AND published_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM app_ledger.economic_effect e
       WHERE e.origin_signal_id = public.expert_signals.id
         AND e.visible_at IS NOT NULL AND e.visible_at <= now())
  );

-- ---------------------------------------------------------------- C3: EXECUTE closure
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public','app_ledger')
       AND p.prokind = 'f'
       AND (p.proname LIKE 'admin\_%' OR p.proname LIKE 'canonical\_%'
            OR p.proname LIKE '%publish%' OR p.proname LIKE '%backfill%'
            OR p.proname LIKE '%dedupe%'  OR p.proname LIKE '%fix%'
            OR p.proname LIKE '%rebuild%' OR p.proname LIKE '%sweep%')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;
END $$;
