-- E0 baseline: minimal Supabase-equivalent surface (ephemeral cluster only).
-- NOT a production migration. Never applied to production.

CREATE SCHEMA IF NOT EXISTS app_ledger;

-- Roles (E6 capability probe: does CREATE ROLE work in this environment?)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ledger_owner') THEN CREATE ROLE ledger_owner NOLOGIN; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA app_ledger TO ledger_owner;

-- ---------------------------------------------------------------- baseline app tables
CREATE TABLE public.experts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  base_currency text NOT NULL DEFAULT 'TWD',
  starting_capital numeric NOT NULL DEFAULT 0
);

CREATE TABLE public.expert_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_effect_id uuid NOT NULL DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id),
  status text NOT NULL DEFAULT 'pending',
  published_at timestamptz NULL
);

CREATE TABLE public.trade_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id),
  market text NOT NULL,
  instrument text NOT NULL,
  instrument_key text NOT NULL,
  currency text NOT NULL,
  quantity integer NOT NULL,
  entry_price numeric NOT NULL,
  exit_price numeric NULL,
  status text NOT NULL,
  entry_date timestamptz NOT NULL,
  exit_date timestamptz NULL,
  signal_id uuid NULL,
  pnl_percent numeric NULL,
  -- non-economic (price worker only)
  current_price numeric NULL,
  price_updated_at timestamptz NULL,
  -- guard-owned provenance
  last_event_id uuid NULL,
  last_projection_mutation_id uuid NULL
);

CREATE TABLE public.daily_price_snapshots (
  symbol text NOT NULL,
  market text NOT NULL,
  trade_date date NOT NULL,
  close_price numeric NOT NULL,
  PRIMARY KEY (symbol, market, trade_date)
);

CREATE TABLE public.fx_rates_history (
  currency_pair text NOT NULL,
  rate_date date NOT NULL,
  rate numeric NOT NULL,
  PRIMARY KEY (currency_pair, rate_date)
);

CREATE TABLE public.tw_market_holidays (holiday_date date PRIMARY KEY);
