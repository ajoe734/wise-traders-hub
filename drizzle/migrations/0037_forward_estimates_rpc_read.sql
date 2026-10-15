DROP POLICY IF EXISTS "Signed-in users read forward estimates" ON public.forward_eps_estimates;
CREATE POLICY "Admins read forward estimates" ON public.forward_eps_estimates FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'::app_role));

CREATE OR REPLACE FUNCTION public.forward_estimate_for(_symbol text)
RETURNS TABLE(period text, eps numeric, eps_source text, forward_pe numeric, pe_source text, as_of date, note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT f.period, f.eps, f.eps_source, f.forward_pe, f.pe_source, f.as_of,
         CASE WHEN f.note LIKE 'ai_extraction:%' THEN 'ai_extraction:' ELSE NULL END
  FROM public.forward_eps_estimates f
  WHERE auth.uid() IS NOT NULL AND _symbol ~ '^\d{4,6}$' AND f.symbol = _symbol
  ORDER BY f.as_of DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.forward_estimate_for(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forward_estimate_for(text) TO authenticated, service_role;