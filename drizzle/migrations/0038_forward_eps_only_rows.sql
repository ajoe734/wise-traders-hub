ALTER TABLE public.forward_eps_estimates ALTER COLUMN forward_pe DROP NOT NULL;
ALTER TABLE public.forward_eps_estimates ALTER COLUMN pe_source DROP NOT NULL;
ALTER TABLE public.forward_eps_estimates ADD CONSTRAINT forward_pe_source_pair CHECK ((forward_pe IS NULL) = (pe_source IS NULL));

CREATE OR REPLACE FUNCTION public.forward_estimate_for(_symbol text)
RETURNS TABLE(period text, eps numeric, eps_source text, forward_pe numeric, pe_source text, as_of date, note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT f.period, f.eps, f.eps_source, f.forward_pe, f.pe_source, f.as_of,
         CASE WHEN f.note LIKE 'ai_extraction:%' THEN 'ai_extraction:' ELSE NULL END
  FROM public.forward_eps_estimates f
  WHERE auth.uid() IS NOT NULL AND _symbol ~ '^\d{4,6}$' AND f.symbol = _symbol
  ORDER BY (f.forward_pe IS NOT NULL) DESC, f.as_of DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.forward_estimate_for(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forward_estimate_for(text) TO authenticated, service_role;