
-- Add market/currency columns to support US stocks alongside TW.
ALTER TABLE public.current_prices
  ADD COLUMN IF NOT EXISTS market text NOT NULL DEFAULT 'TW',
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'TWD';

ALTER TABLE public.trade_records
  ADD COLUMN IF NOT EXISTS market text,
  ADD COLUMN IF NOT EXISTS currency text;

ALTER TABLE public.expert_signals
  ADD COLUMN IF NOT EXISTS market text;

ALTER TABLE public.daily_price_snapshots
  ADD COLUMN IF NOT EXISTS market text NOT NULL DEFAULT 'TW';

ALTER TABLE public.stock_names
  ADD COLUMN IF NOT EXISTS market text NOT NULL DEFAULT 'TW';

-- Backfill: everything existing is TW.
UPDATE public.trade_records
   SET market = COALESCE(market, 'TW'),
       currency = COALESCE(currency, 'TWD')
 WHERE market IS NULL OR currency IS NULL;

UPDATE public.expert_signals
   SET market = 'TW'
 WHERE market IS NULL;

-- Indexes to keep dispatchers fast.
CREATE INDEX IF NOT EXISTS idx_current_prices_market ON public.current_prices (market);
CREATE INDEX IF NOT EXISTS idx_trade_records_market_us ON public.trade_records (market) WHERE market = 'US';
CREATE INDEX IF NOT EXISTS idx_expert_signals_market ON public.expert_signals (market);
