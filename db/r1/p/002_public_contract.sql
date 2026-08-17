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
-- RLS policies are OR-ed: every pre-existing anon/PUBLIC SELECT policy must be
-- removed, otherwise the embargo policy below could never restrict anything.
DO $embargo$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
            WHERE schemaname='public' AND tablename='expert_signals'
              AND cmd IN ('SELECT','ALL')
              AND (roles::text LIKE '%anon%' OR roles::text LIKE '%public%')
  LOOP EXECUTE format('DROP POLICY %I ON public.expert_signals', r.policyname); END LOOP;
END $embargo$;

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
-- Per-target disposition, mirrored 1:1 by db/r1/p/acl-25.json:
--   owner_service_role_only               -> PUBLIC, anon, authenticated all revoked
--   keep_typed_safe_authenticated_guarded -> anon/PUBLIC revoked; authenticated kept
--                                            because the body raises 42501 unless the
--                                            caller is company_admin (negative test)
--   keep_rls_predicate_helper             -> anon/PUBLIC revoked; authenticated kept
--                                            because RLS policies evaluate the helper
--                                            as the querying role
--   replace_with_wrapper                  -> body re-defined below with an entitlement
--                                            gate, then granted to authenticated
DO $acl$
DECLARE r record; d text;
  guarded CONSTANT text[] := ARRAY[
    'admin_apply_fix_proposal','admin_delete_trade_records_by_signal_ids',
    'admin_delete_trade_records_by_symbol','admin_generate_fix_proposals',
    'admin_holdings_consistency_audit','admin_reject_fix_proposal',
    'admin_reset_expert_asset_class','admin_trade_dedupe_sweep',
    'enqueue_bsr_backfill','get_publish_batch_attempts','get_publish_batch_runs',
    'get_publish_batch_status'];
  wrapped CONSTANT text[] := ARRAY['get_expert_capital_status','backfill_queue_stats'];
  rls_helper CONSTANT text[] := ARRAY['has_active_subscription_after','is_tester'];
  -- service_role EXECUTE is granted ONLY where a service_role edge function / cron
  -- job really calls the target. Publish / build / ledger writers stay owner-only:
  -- db/r1/p/094 T-P99R19 asserts service_role is not a publisher.
  svc_allow CONSTANT text[] := ARRAY[
    'claim_backfill_jobs','backfill_job_set_done','backfill_job_set_failed',
    'enqueue_backfill_jobs','enqueue_institutional_backfill_universe',
    'prune_backfill_job_queue','recover_stale_backfill_jobs',
    'backfill_legacy_bsr_to_fact'];
BEGIN
  FOR r IN
    SELECT p.proname,
           format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public','app_ledger')
       AND p.prokind = 'f'
       AND (p.proname LIKE 'admin\_%' OR p.proname LIKE 'canonical\_%'
            OR p.proname LIKE '%publish%' OR p.proname LIKE '%backfill%'
            OR p.proname LIKE '%dedupe%'  OR p.proname LIKE '%fix%'
            OR p.proname LIKE '%rebuild%' OR p.proname LIKE '%sweep%'
            OR p.proname = ANY(rls_helper)
            OR p.proname = ANY(wrapped))
  LOOP
    -- absolute, for every target: no unauthenticated EXECUTE path
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    d := CASE
           WHEN r.proname = ANY(guarded)    THEN 'keep_typed_safe_authenticated_guarded'
           WHEN r.proname = ANY(wrapped)    THEN 'replace_with_wrapper'
           WHEN r.proname = ANY(rls_helper) THEN 'keep_rls_predicate_helper'
           ELSE 'owner_service_role_only'
         END;
    IF d = 'owner_service_role_only' THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated, service_role', r.sig);
      IF r.proname = ANY(svc_allow) THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
      END IF;
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
    END IF;
  END LOOP;
END $acl$;

-- ledger_owner keeps the privileges the SECURITY DEFINER builder needs
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.public_position_projection, public.public_portfolio_state,
  public.public_nav_daily, public.public_projection_active,
  public.public_projection_version, public.public_projection_withheld
  TO ledger_owner;

-- ------------------------------------------------- C3b: replace_with_wrapper bodies
-- Two functions cannot simply be revoked: the app calls them as an ordinary
-- authenticated session. Their original body is preserved verbatim as `<name>_raw`
-- (owner/service_role only) and the public signature becomes a gated wrapper.
DO $mkraw$
DECLARE src text; nm text;
BEGIN
  FOREACH nm IN ARRAY ARRAY['get_expert_capital_status','backfill_queue_stats'] LOOP
    IF to_regprocedure('public.' || nm || '_raw' ||
         CASE WHEN nm = 'get_expert_capital_status' THEN '(uuid)' ELSE '()' END) IS NULL THEN
      SELECT pg_get_functiondef(p.oid) INTO src
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = nm;
      -- production-shape clones carry a subset of the app catalog; a target that
      -- does not exist here cannot be reachable, so skip it instead of failing.
      CONTINUE WHEN src IS NULL;
      EXECUTE replace(src, 'FUNCTION public.' || nm || '(',
                           'FUNCTION public.' || nm || '_raw(');
    END IF;
  END LOOP;
END $mkraw$;

-- get_expert_capital_status was an ungated SECURITY DEFINER economic raw RPC: any
-- caller could read any expert's full open positions. The signature is preserved so
-- the app keeps working; the entitlement gate is added at the top of the body.
DO $wrap1$ BEGIN
IF to_regprocedure('public.get_expert_capital_status_raw(uuid)') IS NULL THEN RETURN; END IF;
EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.get_expert_capital_status(_expert_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $gecs$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT (
       public.has_role(auth.uid(), 'company_admin')
    OR EXISTS (SELECT 1 FROM public.experts e
                WHERE e.id = _expert_id AND e.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.member_subscriptions ms
                 JOIN public.expert_plans ep ON ep.id = ms.plan_id
                WHERE ms.user_id = auth.uid()
                  AND ep.expert_id = _expert_id
                  AND ms.status = 'active'
                  AND (ms.expires_at IS NULL OR ms.expires_at > now()))
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.get_expert_capital_status_raw(_expert_id);
END $gecs$;
$ddl$;
EXECUTE 'REVOKE ALL ON FUNCTION public.get_expert_capital_status_raw(uuid) FROM PUBLIC, anon, authenticated';
EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_expert_capital_status_raw(uuid) TO service_role';
EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_expert_capital_status(uuid) TO authenticated, service_role';
END $wrap1$;

-- Internal callers (e.g. the enforce_signal_capital_limit trigger) must keep calling
-- the ungated computation: they already run inside a trusted SECURITY DEFINER path
-- and have no auth.uid() of their own.
DO $repoint$
DECLARE r record; def text;
BEGIN
  IF to_regprocedure('public.get_expert_capital_status_raw(uuid)') IS NULL THEN RETURN; END IF;
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public','app_ledger')
       AND p.proname NOT LIKE 'get_expert_capital_status%'
       AND p.prosrc LIKE '%get_expert_capital_status(%'
  LOOP
    def := regexp_replace(pg_get_functiondef(r.oid),
                          'get_expert_capital_status\(',
                          'get_expert_capital_status_raw(', 'g');
    EXECUTE def;
  END LOOP;
END $repoint$;

-- backfill_queue_stats is a /company ops card read with no in-function guard.
DO $wrap2$ BEGIN
IF to_regprocedure('public.backfill_queue_stats_raw()') IS NULL THEN RETURN; END IF;
EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.backfill_queue_stats()
RETURNS TABLE(dataset text, pending bigint, running bigint, done bigint,
              failed bigint, skipped bigint, oldest_pending timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $bqs$
BEGIN
  IF NOT public.has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.backfill_queue_stats_raw();
END $bqs$;
$ddl$;
EXECUTE 'REVOKE ALL ON FUNCTION public.backfill_queue_stats_raw() FROM PUBLIC, anon, authenticated';
EXECUTE 'GRANT EXECUTE ON FUNCTION public.backfill_queue_stats_raw() TO service_role';
EXECUTE 'REVOKE ALL ON FUNCTION public.backfill_queue_stats() FROM PUBLIC, anon';
EXECUTE 'GRANT EXECUTE ON FUNCTION public.backfill_queue_stats() TO authenticated, service_role';
END $wrap2$;


-- ---------------------------------------------------------------- C3c: named helpers
-- has_active_subscription_after(_user_id, _at) and is_tester(_user_id) are
-- SECURITY DEFINER helpers that accept an ARBITRARY user id: pre-cutover, any
-- caller could probe another member's entitlements / tester flag. They are also
-- evaluated inside RLS predicates as the QUERYING role (including anon, e.g.
-- "Anyone can view active experts" -> is_tester(auth.uid())), so a blanket
-- REVOKE FROM anon would break anonymous browsing with 42501.
-- Disposition: replace_with_wrapper_authuid_bound
--   * <name>_raw  : verbatim original body, owner/service_role only
--   * <name>      : identity-bound wrapper, callable by anon/authenticated
--                   but only for auth.uid() itself (NULL binds to NULL),
--                   company_admin, or a trusted server-side caller.
DO $mkraw2$
DECLARE src text; nm text; sig text;
BEGIN
  FOREACH nm IN ARRAY ARRAY['has_active_subscription_after','is_tester'] LOOP
    sig := CASE WHEN nm = 'is_tester' THEN '(uuid)' ELSE '(uuid, timestamptz)' END;
    CONTINUE WHEN to_regprocedure('public.' || nm || sig) IS NULL;
    IF to_regprocedure('public.' || nm || '_raw' || sig) IS NULL THEN
      SELECT pg_get_functiondef(p.oid) INTO src
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = nm;
      CONTINUE WHEN src IS NULL;
      EXECUTE replace(src, 'FUNCTION public.' || nm || '(',
                           'FUNCTION public.' || nm || '_raw(');
    END IF;
  END LOOP;
END $mkraw2$;

DO $wrap3$ BEGIN
IF to_regprocedure('public.is_tester_raw(uuid)') IS NULL THEN RETURN; END IF;
EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.is_tester(_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $ist$
BEGIN
  IF NOT public.acl_caller_may_read_identity(_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.is_tester_raw(_user_id);
END $ist$;
$ddl$;
EXECUTE 'REVOKE ALL ON FUNCTION public.is_tester_raw(uuid) FROM PUBLIC, anon, authenticated';
EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_tester_raw(uuid) TO service_role';
EXECUTE 'REVOKE ALL ON FUNCTION public.is_tester(uuid) FROM PUBLIC';
EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_tester(uuid) TO anon, authenticated, service_role';
END $wrap3$;

DO $wrap4$ BEGIN
IF to_regprocedure('public.has_active_subscription_after_raw(uuid, timestamptz)') IS NULL THEN RETURN; END IF;
EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.has_active_subscription_after(
  _user_id uuid, _published_at timestamptz)
RETURNS TABLE(expert_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $hasa$
BEGIN
  IF NOT public.acl_caller_may_read_identity(_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT r.expert_id
    FROM public.has_active_subscription_after_raw(_user_id, _published_at) r;
END $hasa$;
$ddl$;
EXECUTE 'REVOKE ALL ON FUNCTION public.has_active_subscription_after_raw(uuid, timestamptz) FROM PUBLIC, anon, authenticated';
EXECUTE 'GRANT EXECUTE ON FUNCTION public.has_active_subscription_after_raw(uuid, timestamptz) TO service_role';
EXECUTE 'REVOKE ALL ON FUNCTION public.has_active_subscription_after(uuid, timestamptz) FROM PUBLIC';
EXECUTE 'GRANT EXECUTE ON FUNCTION public.has_active_subscription_after(uuid, timestamptz) TO anon, authenticated, service_role';
END $wrap4$;


