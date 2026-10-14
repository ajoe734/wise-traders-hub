CREATE TABLE public.forward_eps_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  status text NOT NULL CHECK (status IN ('passed','blocked')),
  block_round int,
  block_reason text,
  period text,
  eps numeric,
  forward_pe numeric,
  eps_source text,
  pe_source text,
  annualized boolean NOT NULL DEFAULT false,
  rounds jsonb NOT NULL DEFAULT '{}'::jsonb,
  docs jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forward_eps_extractions_symbol_idx ON public.forward_eps_extractions (symbol, created_at DESC);
CREATE INDEX forward_eps_extractions_user_idx ON public.forward_eps_extractions (requested_by, created_at DESC);
GRANT SELECT, DELETE ON public.forward_eps_extractions TO authenticated;
GRANT ALL ON public.forward_eps_extractions TO service_role;
ALTER TABLE public.forward_eps_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read forward extractions" ON public.forward_eps_extractions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'company_admin'));
CREATE POLICY "Admins delete forward extractions" ON public.forward_eps_extractions FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'company_admin'));