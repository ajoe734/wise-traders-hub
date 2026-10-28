CREATE OR REPLACE FUNCTION public.validate_us_rebuild_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $f$
DECLARE v_symbol text;
BEGIN
 IF NEW.action IS DISTINCT FROM 'us_snapshot_official_rebuild' THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.detail->'original') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.detail->'replacement') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.detail->'original')=0 THEN RAISE EXCEPTION 'Invalid reconstruction arrays'; END IF;
 v_symbol:=NEW.detail->'original'->0->>'symbol';
 IF v_symbol IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.detail->'original') x WHERE x->>'market' IS DISTINCT FROM 'US' OR x->>'symbol' IS DISTINCT FROM v_symbol OR x->>'id' IS NULL) THEN RAISE EXCEPTION 'US single-symbol originals required'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(NEW.detail->'original'))<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(NEW.detail->'original') x) THEN RAISE EXCEPTION 'Duplicate original IDs'; END IF;
 IF NEW.detail->'evidence'->>'source' IS DISTINCT FROM 'nasdaq' OR NEW.detail->'evidence'->>'sha256' IS NULL OR NEW.detail->'evidence'->>'original_sha256' IS NULL THEN RAISE EXCEPTION 'Verified source evidence required'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(NEW.detail->'replacement'))<>(SELECT count(DISTINCT x->>'trade_date') FROM jsonb_array_elements(NEW.detail->'replacement') x) THEN RAISE EXCEPTION 'Duplicate replacement dates'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.detail->'replacement') x WHERE x->>'market' IS DISTINCT FROM 'US' OR x->>'symbol' IS DISTINCT FROM v_symbol OR x->>'trade_date' IS NULL OR (x->>'trade_date')::date > (now() AT TIME ZONE 'America/New_York')::date OR x->>'close_price' IS NULL OR x->>'open_price' IS NULL OR x->>'high_price' IS NULL OR x->>'low_price' IS NULL OR x->>'volume' IS NULL OR (x->>'close_price')::numeric<=0 OR (x->>'open_price')::numeric<=0 OR (x->>'low_price')::numeric<=0 OR (x->>'high_price')::numeric < greatest((x->>'close_price')::numeric,(x->>'open_price')::numeric,(x->>'low_price')::numeric) OR (x->>'low_price')::numeric > least((x->>'close_price')::numeric,(x->>'open_price')::numeric) OR (x->>'volume')::numeric<0 OR (x->>'volume')::numeric<>trunc((x->>'volume')::numeric)) THEN RAISE EXCEPTION 'Invalid replacement OHLCV or date'; END IF;
 RETURN NEW;
END;$f$;
CREATE TRIGGER validate_us_rebuild_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.validate_us_rebuild_audit();
REVOKE ALL ON FUNCTION public.validate_us_rebuild_audit() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_us_rebuild_audit() TO service_role;