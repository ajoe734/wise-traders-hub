-- S1-min stage rollback: drops ONLY the objects 001_s1min.sql created.
-- It never touches a baseline table, function, trigger, role privilege or row.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

DROP TABLE IF EXISTS public.public_projection_withheld;
DROP TABLE IF EXISTS public.public_projection_version;

DROP FUNCTION IF EXISTS app_ledger.embargo_days();
DROP FUNCTION IF EXISTS app_ledger.fx_rate_as_of(text,text,date);
DROP FUNCTION IF EXISTS app_ledger.manifest_disposition(uuid,text,text);
DROP FUNCTION IF EXISTS app_ledger.manifest_key(uuid,text,text);
DROP FUNCTION IF EXISTS app_ledger.instrument_publishable(text,text,boolean,text);
DROP FUNCTION IF EXISTS app_ledger.classify_instrument(text,text,boolean,text);
DROP TRIGGER IF EXISTS trg_manifest_immutable ON app_ledger.replay_manifest_key;
DROP FUNCTION IF EXISTS app_ledger.manifest_immutable();

-- the manifest table carries an immutability trigger on DELETE; the trigger is
-- already gone above, so the table itself can be dropped as a created object.
DROP TABLE IF EXISTS app_ledger.replay_manifest_key;

DROP SCHEMA IF EXISTS app_ledger;   -- no CASCADE: fails loudly if anything is left
DROP ROLE IF EXISTS ledger_owner;
