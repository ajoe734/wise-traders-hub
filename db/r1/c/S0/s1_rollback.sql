-- S1-only clone rehearsal rollback. Restore replaced function bodies by replaying
-- the pre-S1 R1 base canonical layer, then drop only S1-created objects.
DROP FUNCTION IF EXISTS app_ledger.canonical_publish(uuid,date,text,boolean);
DROP FUNCTION IF EXISTS app_ledger.embargo_days();
DROP FUNCTION IF EXISTS app_ledger.fx_rate_as_of(text,text,date);
DROP FUNCTION IF EXISTS app_ledger.manifest_disposition(uuid,text,text);
DROP FUNCTION IF EXISTS app_ledger.manifest_key(uuid,text,text);
DROP FUNCTION IF EXISTS app_ledger.instrument_publishable(text,text,boolean,text);
DROP FUNCTION IF EXISTS app_ledger.classify_instrument(text,text,boolean,text);
DROP TRIGGER IF EXISTS trg_manifest_immutable ON app_ledger.replay_manifest_key;
DROP FUNCTION IF EXISTS app_ledger.manifest_immutable();
DROP TABLE IF EXISTS public.public_projection_withheld;
DROP TABLE IF EXISTS public.public_projection_version;
DROP TABLE IF EXISTS app_ledger.replay_manifest_key;
\ir ../../p/099_rollback_p.sql
\ir ../../d/099_rollback.sql
-- Restore the R1 base bodies/guards removed by the stage rollbacks.
DROP TABLE IF EXISTS public.public_projection_active CASCADE;
DROP TABLE IF EXISTS public.public_nav_daily CASCADE;
DROP TABLE IF EXISTS public.public_portfolio_state CASCADE;
DROP TABLE IF EXISTS public.public_position_projection CASCADE;
\ir ../../001_expand.sql
\ir ../../002_ledger.sql
\ir ../../003_canonical.sql
\ir ../../004_projection.sql