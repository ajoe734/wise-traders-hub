
-- Add columns for daily price tracking on open positions
ALTER TABLE public.trade_records
ADD COLUMN current_price numeric DEFAULT NULL,
ADD COLUMN price_updated_at timestamp with time zone DEFAULT NULL;
