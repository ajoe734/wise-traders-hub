-- Candidate DDL under test; production receives this exact SQL via migration tool.
ALTER TABLE public.market_data_requests ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.market_data_requests ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE public.market_data_requests ADD COLUMN IF NOT EXISTS lease_until timestamptz;
CREATE INDEX IF NOT EXISTS market_data_requests_due_idx ON public.market_data_requests(next_attempt_at,last_attempt_at,symbol) WHERE state <> 'ready';

CREATE OR REPLACE FUNCTION public.history_backfill_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT jsonb_build_object(
   'remaining', (SELECT count(*) FROM public.market_data_requests WHERE state <> 'ready'),
   'scheduled', EXISTS(SELECT 1 FROM cron.job WHERE jobname='market-data-backfill' AND active),
   'due', (SELECT count(*) FROM public.market_data_requests WHERE state <> 'ready' AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<=now())),
   'inFlight', (SELECT count(*) FROM public.market_data_requests WHERE state <> 'ready' AND lease_until>now()))
$$;
REVOKE ALL ON FUNCTION public.history_backfill_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.history_backfill_status() TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_history_backfill_schedule()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(771040);
 SELECT jobid INTO j FROM cron.job WHERE jobname='market-data-backfill';
 IF EXISTS(SELECT 1 FROM public.market_data_requests WHERE state <> 'ready') THEN
   IF j IS NULL THEN
     PERFORM cron.schedule('market-data-backfill','40 * * * *',
       $cmd$SELECT public.cron_edge_call('market-data-sync', '{"mode":"backfill","limit":40}'::jsonb, 120000);$cmd$);
   ELSE
     PERFORM cron.alter_job(j, active:=true);
   END IF;
 ELSE
   IF j IS NOT NULL THEN PERFORM cron.unschedule(j); END IF;
 END IF;
 RETURN public.history_backfill_status();
END $$;
REVOKE ALL ON FUNCTION public.refresh_history_backfill_schedule() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_history_backfill_schedule() TO service_role;

CREATE OR REPLACE FUNCTION public.history_backfill_lock_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN PERFORM pg_advisory_xact_lock(771040); RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION public.history_backfill_schedule_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN PERFORM public.refresh_history_backfill_schedule(); RETURN NULL; END $$;
REVOKE ALL ON FUNCTION public.history_backfill_lock_trigger(),public.history_backfill_schedule_trigger() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER history_backfill_lock BEFORE INSERT OR UPDATE OR DELETE ON public.market_data_requests
FOR EACH STATEMENT EXECUTE FUNCTION public.history_backfill_lock_trigger();
CREATE TRIGGER history_backfill_schedule AFTER INSERT OR UPDATE OR DELETE ON public.market_data_requests
FOR EACH STATEMENT EXECUTE FUNCTION public.history_backfill_schedule_trigger();

CREATE OR REPLACE FUNCTION public.enqueue_history_backfill(p_symbols text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_symbols IS NULL OR cardinality(p_symbols)>500 THEN RAISE EXCEPTION 'invalid symbol batch'; END IF;
 PERFORM pg_advisory_xact_lock(771040);
 INSERT INTO public.market_data_requests(symbol)
 SELECT DISTINCT s FROM unnest(p_symbols) s WHERE s ~ '^[0-9]{4,6}[A-Z]?$'
 ON CONFLICT(symbol) DO UPDATE SET state='pending',next_attempt_at=now(),lease_token=NULL,lease_until=NULL
 WHERE market_data_requests.state='ready' AND
   (SELECT count(*) FROM public.tw_price_history p WHERE p.symbol=EXCLUDED.symbol AND p.close>0 AND p.trade_date >= (now() AT TIME ZONE 'Asia/Taipei')::date-120)<20;
 RETURN public.refresh_history_backfill_schedule();
END $$;
REVOKE ALL ON FUNCTION public.enqueue_history_backfill(text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_history_backfill(text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_history_backfill(p_limit integer DEFAULT 40)
RETURNS TABLE(symbol text, lease_token uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_limit IS NULL OR p_limit<1 THEN RAISE EXCEPTION 'invalid limit'; END IF;
 PERFORM pg_advisory_xact_lock(771040);
 RETURN QUERY
 WITH picked AS (
   SELECT q.symbol FROM public.market_data_requests q
   WHERE q.state <> 'ready' AND q.next_attempt_at<=now() AND (q.lease_until IS NULL OR q.lease_until<=now())
   ORDER BY q.last_attempt_at NULLS FIRST,q.symbol LIMIT LEAST(p_limit,40) FOR UPDATE SKIP LOCKED
 ) UPDATE public.market_data_requests q SET lease_token=gen_random_uuid(),lease_until=now()+interval '15 minutes',
   attempts=q.attempts+1,last_attempt_at=now()
   FROM picked WHERE q.symbol=picked.symbol RETURNING q.symbol,q.lease_token;
END $$;
REVOKE ALL ON FUNCTION public.claim_history_backfill(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_history_backfill(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_history_backfill(p_symbol text,p_token uuid,p_outcome text,p_reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE q public.market_data_requests%ROWTYPE; n integer;
BEGIN
 IF p_outcome NOT IN ('ready','failed','quota','release') OR p_outcome IS NULL THEN RAISE EXCEPTION 'invalid outcome'; END IF;
 PERFORM pg_advisory_xact_lock(771040);
 SELECT * INTO q FROM public.market_data_requests WHERE symbol=p_symbol FOR UPDATE;
 IF NOT FOUND OR q.lease_token IS DISTINCT FROM p_token OR p_token IS NULL OR q.lease_until<=now() THEN
   RETURN jsonb_build_object('applied',false,'reason','stale_lease');
 END IF;
 IF p_outcome='ready' THEN
   SELECT count(*) INTO n FROM public.tw_price_history WHERE symbol=p_symbol AND close>0
     AND trade_date >= (now() AT TIME ZONE 'Asia/Taipei')::date-120;
   IF n<20 THEN RAISE EXCEPTION 'incomplete persisted history: % bars',n; END IF;
 END IF;
 UPDATE public.market_data_requests SET
   state=CASE WHEN p_outcome='ready' THEN 'ready' WHEN p_outcome='release' THEN q.state ELSE 'failed' END,
   reason=left(COALESCE(p_reason,''),1000),lease_token=NULL,lease_until=NULL,
   next_attempt_at=CASE WHEN p_outcome='quota' THEN now()+interval '1 hour'
     WHEN p_outcome='failed' THEN now()+make_interval(hours=>LEAST(24,power(2,LEAST(q.attempts-1,5))::integer))
     ELSE now() END
 WHERE symbol=p_symbol;
 RETURN jsonb_build_object('applied',true,'status',public.refresh_history_backfill_schedule());
END $$;
REVOKE ALL ON FUNCTION public.finish_history_backfill(text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_history_backfill(text,uuid,text,text) TO service_role;