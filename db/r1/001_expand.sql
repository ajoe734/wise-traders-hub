-- R1-001 EXPAND (additive only; no economic row is written by this file)
-- Runs as: postgres (needs CREATE ROLE + CREATE ON SCHEMA public grant to ledger_owner)
-- Safety: DDL only. Generated columns are computed by the storage layer, so NO row
-- trigger fires (this is what keeps public.trigger_expert_ai_reindex / pg_net silent).

SET lock_timeout = '3s';
SET statement_timeout = '120s';

-- ---------------------------------------------------------------- 1. roles / schema
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_owner') THEN
    CREATE ROLE ledger_owner NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS app_ledger AUTHORIZATION ledger_owner;
GRANT CREATE, USAGE ON SCHEMA public TO ledger_owner;   -- needed for enum + trigger DDL
GRANT USAGE ON SCHEMA app_ledger TO service_role, authenticated, anon;

-- ---------------------------------------------------------------- 2. experts.base_currency
-- Production `experts.currency` is nullable and asset_class-locked by
-- enforce_expert_currency_lock; the ledger needs a NOT NULL settlement currency.
ALTER TABLE public.experts
  ADD COLUMN IF NOT EXISTS base_currency text
  GENERATED ALWAYS AS (
    CASE
      WHEN currency IN ('TWD','USD') THEN currency
      WHEN asset_class LIKE 'us%' THEN 'USD'
      ELSE 'TWD'
    END
  ) STORED;

-- ---------------------------------------------------------------- 3. expert_signals.logical_effect_id
-- Stable identity of "the economic intent this signal represents". Generated from id
-- so that (a) no UPDATE is issued on 173 live signals and (b) the statement-level
-- trigger trigger_expert_ai_reindex (pg_net) never fires during expand.
ALTER TABLE public.expert_signals
  ADD COLUMN IF NOT EXISTS logical_effect_id uuid
  GENERATED ALWAYS AS (id) STORED;

-- ---------------------------------------------------------------- 3b. instrument key function
-- Single source of truth for instrument identity: the generated column AND the
-- canonical writer must derive the key the same way, or tokens never match.
CREATE OR REPLACE FUNCTION public.economic_instrument_key(p_market text, p_instrument text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS
$$ SELECT coalesce(nullif(upper(btrim(p_market)),''),'?')||'|'||upper(btrim(p_instrument)) $$;

-- ---------------------------------------------------------------- 4. trade_records
-- instrument_key: canonical instrument identity. Market is nullable in production,
-- so unknown market degrades to '?' rather than NULL: default-deny happens in the
-- guard, never by silently collapsing two different instruments into one key.
ALTER TABLE public.trade_records
  ADD COLUMN IF NOT EXISTS instrument_key text
  GENERATED ALWAYS AS (public.economic_instrument_key(market, instrument)) STORED;

-- guard-owned provenance (written only by app_ledger.trade_records_economic_guard)
ALTER TABLE public.trade_records ADD COLUMN IF NOT EXISTS last_event_id uuid;
ALTER TABLE public.trade_records ADD COLUMN IF NOT EXISTS last_projection_mutation_id uuid;
-- realized pnl accumulated by closed-lot projection (E1 conservation)
ALTER TABLE public.trade_records ADD COLUMN IF NOT EXISTS realized_pnl_delta numeric;

COMMENT ON COLUMN public.trade_records.last_event_id IS
  'app_ledger guard-owned. Any client value is overwritten.';
COMMENT ON COLUMN public.trade_records.last_projection_mutation_id IS
  'app_ledger guard-owned. Any client value is overwritten.';

-- ---------------------------------------------------------------- 5. expand-time assertions
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public'
     AND (table_name,column_name) IN (
       ('experts','base_currency'),
       ('expert_signals','logical_effect_id'),
       ('trade_records','instrument_key'),
       ('trade_records','last_event_id'),
       ('trade_records','last_projection_mutation_id'),
       ('trade_records','realized_pnl_delta'));
  IF n <> 6 THEN RAISE EXCEPTION 'expand_incomplete: % / 6', n; END IF;

  -- instrument_key must be total: no NULL, no empty tail
  SELECT count(*) INTO n FROM public.trade_records
   WHERE instrument_key IS NULL OR instrument_key LIKE '%|';
  IF n <> 0 THEN RAISE EXCEPTION 'instrument_key_not_total: % rows', n; END IF;
END $$;
