-- R0-C: real ownership gate on production-schema clone.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ledger_owner') THEN
    CREATE ROLE ledger_owner NOLOGIN;
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS app_ledger AUTHORIZATION ledger_owner;
GRANT USAGE ON SCHEMA app_ledger TO ledger_owner;
-- aux tables required by ledger canonical/projection layer
CREATE TABLE IF NOT EXISTS public.daily_price_snapshots_r0 (
  symbol text NOT NULL, market text NOT NULL, trade_date date NOT NULL, close_price numeric NOT NULL,
  PRIMARY KEY (symbol, market, trade_date));
CREATE TABLE IF NOT EXISTS public.fx_rates_history (
  currency_pair text NOT NULL, rate_date date NOT NULL, rate numeric NOT NULL, PRIMARY KEY (currency_pair, rate_date));
CREATE TABLE IF NOT EXISTS public.tw_market_holidays_r0 (holiday_date date PRIMARY KEY);
-- everything created from here on is owned by ledger_owner
SET ROLE ledger_owner;
