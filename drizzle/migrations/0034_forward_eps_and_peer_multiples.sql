CREATE TABLE public.forward_eps_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  period text NOT NULL,
  eps numeric NOT NULL CHECK (eps > 0),
  eps_source text NOT NULL CHECK (length(trim(eps_source)) > 0),
  forward_pe numeric NOT NULL CHECK (forward_pe > 0),
  pe_source text NOT NULL CHECK (length(trim(pe_source)) > 0),
  as_of date NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, period)
);
CREATE INDEX forward_eps_estimates_symbol_asof_idx ON public.forward_eps_estimates (symbol, as_of DESC);
GRANT SELECT ON public.forward_eps_estimates TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.forward_eps_estimates TO authenticated;
GRANT ALL ON public.forward_eps_estimates TO service_role;
ALTER TABLE public.forward_eps_estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read forward estimates" ON public.forward_eps_estimates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert forward estimates" ON public.forward_eps_estimates FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'company_admin'));
CREATE POLICY "Admins update forward estimates" ON public.forward_eps_estimates FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'company_admin')) WITH CHECK (public.has_role(auth.uid(), 'company_admin'));
CREATE POLICY "Admins delete forward estimates" ON public.forward_eps_estimates FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'company_admin'));

CREATE OR REPLACE FUNCTION public.valuation_peer_multiples(_symbols text[])
RETURNS TABLE(symbol text, trade_date date, pe numeric, pb numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT s, lv.trade_date, lv.per, lv.pbr
  FROM unnest(_symbols[1:20]) AS s
  JOIN LATERAL (SELECT v.trade_date, v.per, v.pbr FROM public.tw_valuation_daily v
    WHERE v.symbol = s ORDER BY v.trade_date DESC LIMIT 1) lv ON true
$$;
GRANT EXECUTE ON FUNCTION public.valuation_peer_multiples(text[]) TO authenticated, service_role;