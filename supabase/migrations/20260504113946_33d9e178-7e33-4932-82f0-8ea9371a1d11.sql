ALTER TABLE public.expert_signals
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS executed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_expert_signals_batch_id
  ON public.expert_signals (batch_id)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expert_signals_executed_at
  ON public.expert_signals (executed_at DESC NULLS LAST);