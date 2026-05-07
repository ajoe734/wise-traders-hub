ALTER TABLE public.experts
  ADD COLUMN IF NOT EXISTS risk_preference text,
  ADD COLUMN IF NOT EXISTS operation_cycle text,
  ADD COLUMN IF NOT EXISTS strategy_name text;