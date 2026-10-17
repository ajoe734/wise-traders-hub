ALTER TABLE public.tw_sales_basis ADD COLUMN IF NOT EXISTS eligible boolean NOT NULL DEFAULT true;
CREATE OR REPLACE FUNCTION public.commit_valuation_filing(_symbol text, _expected date, _source text, _latest date, _statements jsonb, _balance_sheet jsonb, _version text, _sps numeric DEFAULT NULL, _period text DEFAULT NULL, _ps_rows jsonb DEFAULT '[]'::jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cur public.valuation_filing_versions%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
 SELECT * INTO cur FROM public.valuation_filing_versions WHERE symbol=_symbol FOR UPDATE;
 IF NOT FOUND OR cur.expected_period IS DISTINCT FROM _expected OR cur.source IS DISTINCT FROM _source THEN RETURN false; END IF;
 IF _latest < _expected THEN RAISE EXCEPTION 'incomplete new quarter'; END IF;
 IF cur.latest_period=_latest AND cur.version=_version AND cur.state <> 'ready' THEN RETURN false; END IF;
 IF _sps IS NOT NULL AND _sps > 0 THEN
   INSERT INTO public.tw_sales_basis(symbol,sps,period,latest_period,computed_at,eligible) VALUES(_symbol,_sps,_period,_latest,now(),true)
   ON CONFLICT(symbol) DO UPDATE SET sps=excluded.sps,period=excluded.period,latest_period=excluded.latest_period,computed_at=excluded.computed_at,eligible=true;
   INSERT INTO public.tw_ps_daily(symbol,trade_date,ps,source)
   SELECT _symbol,(r->>'trade_date')::date,(r->>'ps')::numeric,r->>'source' FROM jsonb_array_elements(_ps_rows) r
   WHERE r->>'symbol'=_symbol AND (r->>'ps')::numeric > 0
   ON CONFLICT(symbol,trade_date) DO UPDATE SET ps=excluded.ps,source=excluded.source,fetched_at=now();
 ELSE
   UPDATE public.tw_sales_basis SET eligible=false WHERE symbol=_symbol;
 END IF;
 UPDATE public.valuation_filing_versions SET latest_period=_latest,statements=_statements,balance_sheet=_balance_sheet,version=_version,fetched_at=now(),state='ready',reason=NULL WHERE symbol=_symbol;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.commit_valuation_filing(text,date,text,date,jsonb,jsonb,text,numeric,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_valuation_filing(text,date,text,date,jsonb,jsonb,text,numeric,text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.valuation_peer_multiples(_symbols text[])
 RETURNS TABLE(symbol text, trade_date date, pe numeric, pb numeric, ps numeric, ps_date date)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
 SELECT s,lv.trade_date,lv.per,lv.pbr,lp.ps,lp.trade_date FROM unnest(_symbols[1:20]) AS s
 LEFT JOIN LATERAL (SELECT v.trade_date,v.per,v.pbr FROM public.tw_valuation_daily v WHERE v.symbol=s AND v.trade_date >= (now() AT TIME ZONE 'Asia/Taipei')::date-10 ORDER BY v.trade_date DESC LIMIT 1) lv ON true
 LEFT JOIN LATERAL (SELECT p.trade_date,p.ps FROM public.tw_ps_daily p JOIN public.tw_sales_basis b ON b.symbol=p.symbol AND b.eligible WHERE p.symbol=s AND p.trade_date >= (now() AT TIME ZONE 'Asia/Taipei')::date-10 AND (lv.trade_date IS NULL OR p.trade_date=lv.trade_date) ORDER BY p.trade_date DESC LIMIT 1) lp ON true
 WHERE lv.trade_date IS NOT NULL OR lp.trade_date IS NOT NULL
$$;
GRANT EXECUTE ON FUNCTION public.valuation_peer_multiples(text[]) TO anon,authenticated,service_role;