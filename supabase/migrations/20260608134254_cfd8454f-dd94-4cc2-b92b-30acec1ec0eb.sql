ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS final_recovery_notified_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_payment_intents_final_recovery
  ON public.payment_intents (status, created_at)
  WHERE status = 'pending' AND final_recovery_notified_at IS NULL;