-- =====================================================================
-- S1-min — ADDITIVE-ONLY production candidate (clone rehearsal first).
-- Contains ONLY newly created objects. It performs:
--   * zero UPDATE / DELETE / backfill on any pre-existing table
--   * zero GRANT / REVOKE on any pre-existing object
--   * zero CREATE OR REPLACE of any pre-existing function
--   * zero role privilege change on any pre-existing role
-- Everything else from db/r1/d/001_compat.sql and db/r1/p/001_projection.sql
-- (ledger core, effect_key, guards, canonical writers, publish, ownership
--  transfers, BYPASSRLS, grants on public.trade_records) is deferred to S2.
-- Run inside ONE transaction; see s1min_apply.sh.
-- =====================================================================
SET lock_timeout = '3s';
SET statement_timeout = '60s';

-- new role: NOLOGIN, no members, no privilege on any existing object.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_owner') THEN
    CREATE ROLE ledger_owner NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS app_ledger AUTHORIZATION ledger_owner;

CREATE TABLE IF NOT EXISTS app_ledger.replay_manifest_key (
  key                       text PRIMARY KEY,
  expert_handle             text NOT NULL,
  instrument                text NOT NULL,
  market                    text NOT NULL,
  currency                  text NOT NULL,
  class                     text NOT NULL
    CHECK (class IN ('match','multiple_apply','signal_only','stored_only','incomplete','other')),
  stored_open_qty_shares    numeric NULL,
  replay_qty_shares         numeric NULL,
  qty_drift                 numeric NULL,
  review_status             text NOT NULL
    CHECK (review_status IN ('auto_supported','manual_review')),
  public_disposition        text NOT NULL
    CHECK (public_disposition IN ('as_reported_publishable','withheld_incomplete')),
  authoritative_qty_shares  numeric NULL,
  auto_correction_forbidden boolean NOT NULL DEFAULT true,
  reason_codes              jsonb NOT NULL DEFAULT '[]'::jsonb,
  in_drift26                boolean NOT NULL DEFAULT false,
  -- security-master classification (db/r1/p/instrument_class_view.sql)
  asset_class               text NOT NULL DEFAULT 'unknown_instrument'
    CHECK (asset_class IN ('tw_stock','us_stock','tw_warrant','unknown_derivative',
                           'us_option_combo','unknown_instrument')),
  derivative_supported      boolean NOT NULL DEFAULT false,
  in_warrant_master         boolean NOT NULL DEFAULT false,
  classification_evidence   text NOT NULL DEFAULT 'no_master_row',
  -- a derivative that is not fully supported can never be publishable
  CONSTRAINT rmk_derivative_closed CHECK
    (derivative_supported
     OR asset_class IN ('tw_stock','us_stock')
     OR public_disposition = 'withheld_incomplete'),
  -- G3: an unadjudicated key may never carry an authoritative number
  CONSTRAINT rmk_no_auto_answer CHECK
    (NOT auto_correction_forbidden OR authoritative_qty_shares IS NULL),
  -- manual_review is never publishable
  CONSTRAINT rmk_manual_withheld CHECK
    (review_status <> 'manual_review' OR public_disposition = 'withheld_incomplete')
);
ALTER TABLE app_ledger.replay_manifest_key OWNER TO ledger_owner;

-- the manifest is append/adjudicate-only: class + replay numbers are immutable
CREATE OR REPLACE FUNCTION app_ledger.manifest_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'manifest_delete_forbidden' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.key <> OLD.key OR NEW.class <> OLD.class
     OR NEW.stored_open_qty_shares IS DISTINCT FROM OLD.stored_open_qty_shares
     OR NEW.replay_qty_shares IS DISTINCT FROM OLD.replay_qty_shares THEN
    RAISE EXCEPTION 'manifest_replay_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION app_ledger.manifest_immutable() OWNER TO ledger_owner;

DROP TRIGGER IF EXISTS trg_manifest_immutable ON app_ledger.replay_manifest_key;
CREATE TRIGGER trg_manifest_immutable
  BEFORE UPDATE OR DELETE ON app_ledger.replay_manifest_key
  FOR EACH ROW EXECUTE FUNCTION app_ledger.manifest_immutable();

-- ---------------------------------------------------------------- classifier
-- Mirrors db/r1/p/instrument_class_view.sql. It exists so that an instrument
-- that has NO manifest row can still never slip through the tw_stock/us_stock
-- fast path: anything derivative-shaped is classified and fails closed.
CREATE OR REPLACE FUNCTION app_ledger.classify_instrument(
  p_market text, p_instrument text, p_combo boolean DEFAULT false, p_unit text DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_market = 'US' AND (coalesce(p_combo,false) OR coalesce(p_unit,'') = '組'
         OR p_instrument ~ '[0-9]+(\.[0-9]+)?[CP]')                  THEN 'us_option_combo'
    WHEN p_market = 'TW' AND EXISTS (SELECT 1 FROM public.warrant_expiry w
           WHERE w.symbol = pg_catalog.split_part(p_instrument,' ',1))  THEN 'tw_warrant'
    WHEN p_market = 'TW' AND pg_catalog.split_part(p_instrument,' ',1) ~ '^[0-9]{6}$'
         AND pg_catalog.left(pg_catalog.split_part(p_instrument,' ',1),2) <> '00'
                                                                        THEN 'unknown_derivative'
    WHEN p_market = 'TW' AND (pg_catalog.split_part(p_instrument,' ',1) ~ '^[0-9]{4}$'
         OR pg_catalog.split_part(p_instrument,' ',1) ~ '^00[0-9]{2,3}[A-Z]?$')
                                                                        THEN 'tw_stock'
    WHEN p_market = 'US' AND pg_catalog.split_part(p_instrument,' ',1) ~ '^[A-Z][A-Z.\-]{0,5}$'
                                                                        THEN 'us_stock'
    ELSE 'unknown_instrument' END
$$;
ALTER FUNCTION app_ledger.classify_instrument(text,text,boolean,text) OWNER TO ledger_owner;

CREATE OR REPLACE FUNCTION app_ledger.instrument_publishable(
  p_market text, p_instrument text, p_combo boolean DEFAULT false, p_unit text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE app_ledger.classify_instrument(p_market, p_instrument, p_combo, p_unit)
    WHEN 'tw_stock' THEN true
    WHEN 'us_stock' THEN true
    WHEN 'tw_warrant' THEN EXISTS (
      SELECT 1 FROM public.warrant_expiry w
        JOIN public.current_prices c ON c.symbol = w.symbol
       WHERE w.symbol = pg_catalog.split_part(p_instrument,' ',1)
         AND w.exercise_ratio IS NOT NULL AND c.price IS NOT NULL)
    ELSE false END
$$;
ALTER FUNCTION app_ledger.instrument_publishable(text,text,boolean,text) OWNER TO ledger_owner;

-- production key formula (identical to db/r1/p/manifest_replay.sql)
CREATE OR REPLACE FUNCTION app_ledger.manifest_key(p_expert uuid, p_market text, p_instrument text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT 'K-' || pg_catalog.left(pg_catalog.md5(
           p_expert::text || '|' || coalesce(p_market,'-') || '|' || p_instrument), 16)
$$;
ALTER FUNCTION app_ledger.manifest_key(uuid,text,text) OWNER TO ledger_owner;

CREATE OR REPLACE FUNCTION app_ledger.manifest_disposition(
  p_expert uuid, p_market text, p_instrument text)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(
    (SELECT m.public_disposition FROM app_ledger.replay_manifest_key m
      WHERE m.key = app_ledger.manifest_key(p_expert, p_market, p_instrument)),
    'as_reported_publishable')
$$;
ALTER FUNCTION app_ledger.manifest_disposition(uuid,text,text) OWNER TO ledger_owner;

CREATE TABLE IF NOT EXISTS public.public_projection_version (
  projection_version bigint PRIMARY KEY,
  expert_id          uuid NOT NULL,
  basis              text NOT NULL CHECK (basis IN ('as_reported','restated')),
  embargo_cutoff     timestamptz NOT NULL,
  built_at           timestamptz NOT NULL DEFAULT now(),
  withheld_count     int NOT NULL DEFAULT 0,
  embargoed_count    int NOT NULL DEFAULT 0,
  source             text NOT NULL DEFAULT 'canonical_publish'
);

CREATE TABLE IF NOT EXISTS public.public_projection_withheld (
  projection_version bigint NOT NULL,
  expert_id          uuid NOT NULL,
  instrument_key     text NOT NULL,
  instrument         text NOT NULL,
  market             text NULL,
  manifest_key       text NULL,
  reason             text NOT NULL,
  PRIMARY KEY (projection_version, expert_id, instrument_key)
);

REVOKE ALL ON public.public_projection_version, public.public_projection_withheld
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_projection_version TO service_role;
GRANT SELECT ON public.public_projection_withheld TO service_role;

-- ---------------------------------------------------------------- fx (fail closed)
-- production fx_rates holds a single undated USDTWD row: historical conversion
-- is NOT available, so any cross-currency roll-up must fail closed.
CREATE OR REPLACE FUNCTION app_ledger.fx_rate_as_of(p_from text, p_to text, p_as_of date)
RETURNS numeric LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v numeric;
BEGIN
  IF p_from = p_to THEN RETURN 1; END IF;
  SELECT r.rate INTO v FROM public.fx_rates r
   WHERE r.currency_pair = p_from||p_to
     AND r.fetched_at::date <= p_as_of
   ORDER BY r.fetched_at DESC LIMIT 1;
  IF v IS NULL THEN
    RAISE EXCEPTION 'fx_history_unavailable: % -> % as_of %', p_from, p_to, p_as_of
      USING ERRCODE = 'P0001';
  END IF;
  RETURN v;
END $$;
ALTER FUNCTION app_ledger.fx_rate_as_of(text,text,date) OWNER TO ledger_owner;

-- ---------------------------------------------------------------- embargo constant
-- Single source of truth for the T+7 window: the writer stamps it and the
-- verification lattice reads it, so the two can never drift apart.
CREATE OR REPLACE FUNCTION app_ledger.embargo_days() RETURNS int
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT 7 $$;
REVOKE ALL ON FUNCTION app_ledger.embargo_days() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_ledger.embargo_days() TO ledger_owner, postgres;

