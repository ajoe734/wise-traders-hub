ALTER TABLE public.warrant_expiry
  ADD COLUMN IF NOT EXISTS exercise_ratio numeric(12,6),
  ADD COLUMN IF NOT EXISTS strike_price numeric(14,4),
  ADD COLUMN IF NOT EXISTS call_put text CHECK (call_put IN ('call','put') OR call_put IS NULL),
  ADD COLUMN IF NOT EXISTS ratio_source text,
  ADD COLUMN IF NOT EXISTS ratio_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_warrant_expiry_ratio_null
  ON public.warrant_expiry(symbol) WHERE exercise_ratio IS NULL;

COMMENT ON COLUMN public.warrant_expiry.exercise_ratio IS '每 1 單位權證可換多少股標的。例：0.025 表示 1 張(=1000單位)可換 25 股；1.0 表示 1 對 1。';
COMMENT ON COLUMN public.warrant_expiry.ratio_source IS 'twse_daily / twse_single / manual';