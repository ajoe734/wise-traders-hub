-- 1) Warrant expiry table (公開只讀，admin 可寫)
CREATE TABLE IF NOT EXISTS public.warrant_expiry (
  symbol      text PRIMARY KEY,
  name        text,
  parent_code text,
  expire_date date,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warrant_expiry_parent
  ON public.warrant_expiry(parent_code);

ALTER TABLE public.warrant_expiry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read warrant expiry" ON public.warrant_expiry;
CREATE POLICY "Public read warrant expiry"
  ON public.warrant_expiry
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Admins manage warrant expiry" ON public.warrant_expiry;
CREATE POLICY "Admins manage warrant expiry"
  ON public.warrant_expiry
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

-- 2) Accuracy stats indexes
CREATE INDEX IF NOT EXISTS idx_pred_accuracy_reviewed_at
  ON public.checkup_prediction_accuracy(reviewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_pred_accuracy_event_type
  ON public.checkup_prediction_accuracy(event_type);
