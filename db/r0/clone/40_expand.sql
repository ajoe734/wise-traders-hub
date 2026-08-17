-- R0-G expand step (additive only, no destructive change). Runs as migration runner (postgres).
\set ON_ERROR_STOP on
BEGIN;
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- price source used by projection/NAV (production-shaped subset)
CREATE TABLE IF NOT EXISTS public.daily_price_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL, trade_date date NOT NULL, close_price numeric,
  yesterday_close numeric, change_percent numeric, is_limit_up boolean NOT NULL DEFAULT false,
  limit_up_price numeric, volume bigint, created_at timestamptz NOT NULL DEFAULT now(),
  open_price numeric, high_price numeric, low_price numeric, volume_ma5 numeric,
  market text NOT NULL, volume_unit text, volume_shares bigint,
  UNIQUE (symbol, market, trade_date));

-- experts: ledger-canonical currency alias (expand; legacy experts.currency stays authoritative until contract)
ALTER TABLE public.experts ADD COLUMN IF NOT EXISTS base_currency text;
UPDATE public.experts SET base_currency = coalesce(currency,'TWD') WHERE base_currency IS NULL;
ALTER TABLE public.experts ALTER COLUMN base_currency SET DEFAULT 'TWD';
ALTER TABLE public.experts ALTER COLUMN base_currency SET NOT NULL;
ALTER TABLE public.experts ALTER COLUMN starting_capital SET DEFAULT 0;
UPDATE public.experts SET starting_capital = 0 WHERE starting_capital IS NULL;
ALTER TABLE public.experts ALTER COLUMN starting_capital SET NOT NULL;

-- expert_signals: stable logical id for replay/idempotency
ALTER TABLE public.expert_signals ADD COLUMN IF NOT EXISTS logical_effect_id uuid;
UPDATE public.expert_signals SET logical_effect_id = id WHERE logical_effect_id IS NULL;
ALTER TABLE public.expert_signals ALTER COLUMN logical_effect_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.expert_signals ALTER COLUMN logical_effect_id SET NOT NULL;

-- trade_records: instrument_key + guard-owned provenance pointers
ALTER TABLE public.trade_records ADD COLUMN IF NOT EXISTS instrument_key text;
UPDATE public.trade_records SET instrument_key = coalesce(market,'?')||':'||split_part(instrument,' ',1)
 WHERE instrument_key IS NULL;
ALTER TABLE public.trade_records ALTER COLUMN instrument_key SET NOT NULL;
ALTER TABLE public.trade_records ADD COLUMN IF NOT EXISTS last_event_id uuid;
ALTER TABLE public.trade_records ADD COLUMN IF NOT EXISTS last_projection_mutation_id uuid;
ALTER TABLE public.trade_records ADD COLUMN IF NOT EXISTS realized_pnl_delta numeric;

COMMIT;
