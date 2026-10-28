ALTER TABLE public.daily_price_snapshots ADD COLUMN IF NOT EXISTS is_usable boolean NOT NULL DEFAULT true;
ALTER TABLE public.daily_price_snapshots ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.daily_price_snapshots ADD COLUMN IF NOT EXISTS exclusion_reason text;
ALTER TABLE public.daily_price_snapshots ADD COLUMN IF NOT EXISTS source_evidence jsonb;
CREATE OR REPLACE FUNCTION public.rebuild_us_snapshots(p_original jsonb, p_rows jsonb, p_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $f$
DECLARE v_count integer; v_written integer;
BEGIN
 IF jsonb_array_length(p_original)=0 OR p_evidence->>'source'<>'nasdaq' OR p_evidence->>'sha256' IS NULL THEN RAISE EXCEPTION 'Evidence required'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_original) x WHERE x->>'market'<>'US') OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) x WHERE x->>'market'<>'US' OR x->>'symbol'<>p_original->0->>'symbol') THEN RAISE EXCEPTION 'US single-symbol scope only'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('us_snapshot_rebuild_'||(p_original->0->>'symbol')));
 IF EXISTS(SELECT 1 FROM public.audit_logs WHERE action='us_snapshot_official_rebuild' AND detail->>'original_sha256'=p_evidence->>'original_sha256' AND detail->>'sha256'=p_evidence->>'sha256') THEN RETURN jsonb_build_object('already_applied',true); END IF;
 SELECT count(*) INTO v_count FROM public.daily_price_snapshots d JOIN jsonb_array_elements(p_original) x ON d.id=(x->>'id')::uuid WHERE d.market='US' AND d.symbol=x->>'symbol' AND d.trade_date=(x->>'trade_date')::date AND d.close_price IS NOT DISTINCT FROM (x->>'close_price')::numeric;
 IF v_count<>jsonb_array_length(p_original) THEN RAISE EXCEPTION 'Concurrent snapshot change'; END IF;
 INSERT INTO public.audit_logs(action,target_type,detail) VALUES('us_snapshot_official_rebuild','daily_price_snapshots',jsonb_build_object('original_sha256',p_evidence->>'original_sha256','sha256',p_evidence->>'sha256','evidence',p_evidence,'original',p_original,'replacement',p_rows));
 UPDATE public.daily_price_snapshots d SET is_usable=false,exclusion_reason='superseded_by_official_daily_rebuild',close_price=NULL,yesterday_close=NULL,change_percent=NULL,open_price=NULL,high_price=NULL,low_price=NULL,volume=NULL,volume_shares=NULL,volume_ma5=NULL,source_evidence=p_evidence WHERE d.id IN(SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_original) x);
 INSERT INTO public.daily_price_snapshots(symbol,trade_date,market,close_price,yesterday_close,change_percent,open_price,high_price,low_price,volume,volume_unit,volume_shares,is_limit_up,limit_up_price,is_usable,source,exclusion_reason,source_evidence)
 SELECT x->>'symbol',(x->>'trade_date')::date,'US',(x->>'close_price')::numeric,(x->>'yesterday_close')::numeric,(x->>'change_percent')::numeric,(x->>'open_price')::numeric,(x->>'high_price')::numeric,(x->>'low_price')::numeric,(x->>'volume')::bigint,'shares',(x->>'volume')::bigint,false,NULL,true,'nasdaq',NULL,p_evidence FROM jsonb_array_elements(p_rows) x
 ON CONFLICT(symbol,trade_date) DO UPDATE SET close_price=EXCLUDED.close_price,yesterday_close=EXCLUDED.yesterday_close,change_percent=EXCLUDED.change_percent,open_price=EXCLUDED.open_price,high_price=EXCLUDED.high_price,low_price=EXCLUDED.low_price,volume=EXCLUDED.volume,volume_unit='shares',volume_shares=EXCLUDED.volume_shares,volume_ma5=NULL,is_limit_up=false,limit_up_price=NULL,is_usable=true,source='nasdaq',exclusion_reason=NULL,source_evidence=EXCLUDED.source_evidence WHERE daily_price_snapshots.market='US';
 GET DIAGNOSTICS v_written=ROW_COUNT;
 IF v_written<>jsonb_array_length(p_rows) THEN RAISE EXCEPTION 'Unexpected collision'; END IF;
 RETURN jsonb_build_object('original_rows',v_count,'written_rows',v_written);
END;$f$;
REVOKE ALL ON FUNCTION public.rebuild_us_snapshots(jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_us_snapshots(jsonb,jsonb,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.guard_us_snapshot_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $f$ BEGIN IF NEW.market='US' AND NEW.is_usable AND (NEW.source IS DISTINCT FROM 'nasdaq' OR NEW.source_evidence->>'sha256' IS NULL) THEN NEW.is_usable=false; NEW.exclusion_reason='unverified_us_daily_source'; NEW.close_price=NULL; NEW.yesterday_close=NULL; NEW.change_percent=NULL; NEW.open_price=NULL; NEW.high_price=NULL; NEW.low_price=NULL; NEW.volume=NULL; NEW.volume_shares=NULL; END IF; RETURN NEW; END; $f$;
CREATE TRIGGER guard_us_snapshot_evidence BEFORE INSERT OR UPDATE ON public.daily_price_snapshots FOR EACH ROW EXECUTE FUNCTION public.guard_us_snapshot_evidence();