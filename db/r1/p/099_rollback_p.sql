-- =====================================================================
-- R1-P 099 ROLLBACK — undo 001_projection + 002_public_contract + 010 seed.
-- Leaves the clone exactly as R1-D left it. No irreversible statement.
-- =====================================================================
SET lock_timeout = '5s';
SET statement_timeout = '300s';

-- 1. public contract objects
DROP VIEW IF EXISTS public.public_expert_positions_v1;
DROP VIEW IF EXISTS public.public_expert_nav_v1;
DROP POLICY IF EXISTS signals_embargo_anon ON public.expert_signals;
DROP POLICY IF EXISTS pointer_public_read ON public.public_projection_active;

ALTER TABLE public.public_position_projection DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_portfolio_state     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_nav_daily           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_projection_active   DISABLE ROW LEVEL SECURITY;

-- 2. R1-P tables
DROP TABLE IF EXISTS public.public_projection_withheld;
DROP TABLE IF EXISTS public.public_projection_version;
DROP TABLE IF EXISTS app_ledger.replay_manifest_key CASCADE;

-- 3. R1-P functions (the R1-D/R1 baseline bodies are replayed by the runner)
DROP FUNCTION IF EXISTS app_ledger.manifest_disposition(uuid,text,text);
DROP FUNCTION IF EXISTS app_ledger.manifest_key(uuid,text,text);
DROP FUNCTION IF EXISTS app_ledger.manifest_immutable() CASCADE;
DROP FUNCTION IF EXISTS app_ledger.fx_rate_as_of(text,text,date);

-- 4. restore the R1 baseline publish body + grants
\i db/r1/004_projection.sql
