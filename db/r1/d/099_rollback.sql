-- =====================================================================
-- R1-D 099 ROLLBACK — undo 001_compat + 002_cutover completely.
-- Restores: legacy writer bodies/owners (from the production-extracted schema
-- snapshot loaded by the clone runner), guard triggers, ACLs and owner roles.
-- Verified by comparing db/r1/d/095_hashes.sql output before/after.
-- Every step is reversible; there is NO irreversible statement in this file.
-- =====================================================================
SET lock_timeout = '3s';
SET statement_timeout = '300s';

-- 1. drop the compat/canonical layer added by 001+002 (app_ledger objects that
--    did not exist before R1-D). The R1 base ledger objects stay untouched.
DROP FUNCTION IF EXISTS app_ledger.canonical_correct_position(uuid,text,text,int,text,text,int);
DROP FUNCTION IF EXISTS app_ledger.canonical_apply_signal(uuid,uuid,text);
DROP FUNCTION IF EXISTS app_ledger.canonical_reverse_signal(uuid,text,uuid,text);
DROP FUNCTION IF EXISTS app_ledger.publish_signal_effect(uuid);
DROP FUNCTION IF EXISTS app_ledger.apply_price_update(jsonb);
DROP FUNCTION IF EXISTS app_ledger.dedupe_candidates();
DROP FUNCTION IF EXISTS app_ledger.derive_logical_effect_id(uuid,text,int);
DROP FUNCTION IF EXISTS app_ledger.lock_expert(uuid);
DROP FUNCTION IF EXISTS app_ledger.convert_qty(int,text,text);
DROP FUNCTION IF EXISTS app_ledger.assert_canonical_writer(text);
DROP TABLE IF EXISTS app_ledger.effect_key;

-- 2. restore the pre-R1-D guard behaviour (R1 baseline guards were SECURITY DEFINER
--    owned by postgres; the clone runner reloads them from db/r1/004_projection.sql).
--    Here we only detach the R1-D specific SECURITY INVOKER variants.
DROP FUNCTION IF EXISTS app_ledger.trade_records_economic_guard() CASCADE;
DROP FUNCTION IF EXISTS app_ledger.cash_ledger_guard() CASCADE;

-- 3. give ownership back to postgres before dropping the R1-D roles
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT format('ALTER FUNCTION %I.%I(%s) OWNER TO postgres',
                    n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) s
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE pg_get_userbyid(p.proowner) IN ('wrapper_owner','ledger_owner')
  LOOP EXECUTE r.s; END LOOP;
  FOR r IN SELECT format('ALTER TABLE %I.%I OWNER TO postgres', n.nspname, c.relname) s
             FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE c.relkind IN ('r','p') AND pg_get_userbyid(c.relowner) IN ('wrapper_owner','ledger_owner')
  LOOP EXECUTE r.s; END LOOP;
  FOR r IN SELECT format('ALTER SEQUENCE %I.%I OWNER TO postgres', n.nspname, c.relname) s
             FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE c.relkind='S' AND pg_get_userbyid(c.relowner) IN ('wrapper_owner','ledger_owner')
  LOOP EXECUTE r.s; END LOOP;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='app_ledger') THEN
    EXECUTE 'ALTER SCHEMA app_ledger OWNER TO postgres';
  END IF;
END $$;

-- 4. restore production ACLs on trade_records (R1-D revoked runtime DML)
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.trade_records TO anon, authenticated, service_role;

-- 5. drop the R1-D roles
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wrapper_owner') THEN
    EXECUTE 'REASSIGN OWNED BY wrapper_owner TO postgres';
    EXECUTE 'DROP OWNED BY wrapper_owner';
    EXECUTE 'DROP ROLE wrapper_owner';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ledger_owner') THEN
    EXECUTE 'REASSIGN OWNED BY ledger_owner TO postgres';
    EXECUTE 'DROP OWNED BY ledger_owner';
    EXECUTE 'DROP ROLE ledger_owner';
  END IF;
END $$;

-- 6. drop the R1 ledger schema itself so the clone returns to the exact
--    production-extracted baseline used for the before-hash.
DROP SCHEMA IF EXISTS app_ledger CASCADE;
DROP SCHEMA IF EXISTS t CASCADE;
DROP SCHEMA IF EXISTS td CASCADE;
DROP TYPE IF EXISTS effect_provenance CASCADE;
DROP FUNCTION IF EXISTS public.economic_instrument_key(text,text) CASCADE;
DROP TABLE IF EXISTS public.signal_trade_applications_r1d_shadow;
