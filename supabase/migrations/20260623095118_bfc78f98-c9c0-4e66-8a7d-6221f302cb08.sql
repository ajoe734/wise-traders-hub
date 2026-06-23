
-- ─────────────────────────────────────────────────────────────
-- 1. checkup_prediction_accuracy: scope INSERT to auth.uid()
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.checkup_prediction_accuracy
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_cpa_user_id ON public.checkup_prediction_accuracy(user_id);

DROP POLICY IF EXISTS "Authenticated users can insert prediction accuracy"
  ON public.checkup_prediction_accuracy;

CREATE POLICY "Users insert their own prediction accuracy"
  ON public.checkup_prediction_accuracy
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 2. paywall_events: prevent user_id impersonation
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can insert paywall events" ON public.paywall_events;

CREATE POLICY "Anyone can insert paywall events with own id"
  ON public.paywall_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());
