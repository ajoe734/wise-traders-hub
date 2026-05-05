
-- target_price_history
CREATE TABLE public.target_price_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  code text NOT NULL,
  firm text NOT NULL DEFAULT '',
  target numeric NOT NULL,
  prev_target numeric,
  report_date text,
  change_type text NOT NULL DEFAULT 'new', -- new | updated | removed
  source text NOT NULL DEFAULT 'refresh-reports', -- refresh-reports | weekly-cron | enrich-dossier | manual
  batch_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tph_user_code ON public.target_price_history(user_id, code, created_at DESC);
CREATE INDEX idx_tph_batch ON public.target_price_history(batch_id);
ALTER TABLE public.target_price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own target history" ON public.target_price_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own target history" ON public.target_price_history
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins full access target history" ON public.target_price_history
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

-- holding_meta_overrides
CREATE TABLE public.holding_meta_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  code text NOT NULL,
  industry text,
  strategy text,
  leader text,
  position text,
  source text NOT NULL DEFAULT 'ai_enrich',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, code)
);
ALTER TABLE public.holding_meta_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own meta overrides" ON public.holding_meta_overrides
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins view all meta overrides" ON public.holding_meta_overrides
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'company_admin'::app_role));

CREATE OR REPLACE FUNCTION public.touch_holding_meta_overrides()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER trg_touch_holding_meta_overrides
  BEFORE UPDATE ON public.holding_meta_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_holding_meta_overrides();
