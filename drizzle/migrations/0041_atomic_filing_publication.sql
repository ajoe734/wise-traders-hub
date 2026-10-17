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
   INSERT INTO public.tw_sales_basis(symbol,sps,period,latest_period,computed_at) VALUES(_symbol,_sps,_period,_latest,now())
   ON CONFLICT(symbol) DO UPDATE SET sps=excluded.sps,period=excluded.period,latest_period=excluded.latest_period,computed_at=excluded.computed_at;
   INSERT INTO public.tw_ps_daily(symbol,trade_date,ps,source)
   SELECT _symbol,(r->>'trade_date')::date,(r->>'ps')::numeric,r->>'source' FROM jsonb_array_elements(_ps_rows) r
   WHERE r->>'symbol'=_symbol AND (r->>'ps')::numeric > 0
   ON CONFLICT(symbol,trade_date) DO UPDATE SET ps=excluded.ps,source=excluded.source,fetched_at=now();
 END IF;
 UPDATE public.valuation_filing_versions SET latest_period=_latest,statements=_statements,balance_sheet=_balance_sheet,version=_version,fetched_at=now(),state='ready',reason=NULL WHERE symbol=_symbol;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.commit_valuation_filing(text,date,text,date,jsonb,jsonb,text,numeric,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_valuation_filing(text,date,text,date,jsonb,jsonb,text,numeric,text,jsonb) TO service_role;