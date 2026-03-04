CREATE TABLE public.expert_signal_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  title text NOT NULL,
  action text NOT NULL,
  reason text NOT NULL DEFAULT '',
  risk_note text NOT NULL DEFAULT '',
  strategy_note text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expert_signal_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Analysts can manage own signal templates"
  ON public.expert_signal_templates FOR ALL TO authenticated
  USING (expert_id IN (SELECT id FROM experts WHERE user_id = auth.uid()))
  WITH CHECK (expert_id IN (SELECT id FROM experts WHERE user_id = auth.uid()));

CREATE POLICY "Company admins full access signal templates"
  ON public.expert_signal_templates FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'))
  WITH CHECK (has_role(auth.uid(), 'company_admin'));