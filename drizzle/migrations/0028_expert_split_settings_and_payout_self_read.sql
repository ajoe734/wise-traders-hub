CREATE TABLE public.expert_split_settings (
  expert_id uuid PRIMARY KEY REFERENCES public.experts(id) ON DELETE CASCADE,
  pct_platform integer NOT NULL CHECK (pct_platform BETWEEN 0 AND 100),
  pct_expert integer NOT NULL CHECK (pct_expert BETWEEN 0 AND 100),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pct_platform + pct_expert = 100)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_split_settings TO authenticated;
GRANT ALL ON public.expert_split_settings TO service_role;
ALTER TABLE public.expert_split_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage expert splits" ON public.expert_split_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin')) WITH CHECK (public.has_role(auth.uid(), 'company_admin'));
CREATE POLICY "Experts view own split" ON public.expert_split_settings FOR SELECT TO authenticated
  USING (expert_id IN (SELECT e.id FROM public.experts e WHERE e.user_id = auth.uid()));

ALTER TABLE public.revenue_splits DROP CONSTRAINT revenue_splits_rule_source_check;
ALTER TABLE public.revenue_splits ADD CONSTRAINT revenue_splits_rule_source_check
  CHECK (rule_source = ANY (ARRAY['plan_override','expert_override','standard_default','checkup_default']));

CREATE POLICY "Experts read own paid payouts" ON public.expert_payouts FOR SELECT TO authenticated
  USING (status = 'paid' AND expert_id IN (SELECT e.id FROM public.experts e WHERE e.user_id = auth.uid()));