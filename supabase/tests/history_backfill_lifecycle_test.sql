\set ON_ERROR_STOP on
-- Only run against the socket-only ephemeral harness, never the shared database.
DO $$ BEGIN
  ASSERT current_database() = 'bsr_ephemeral' AND inet_server_addr() IS NULL;
END $$;
BEGIN;
DO $$ DECLARE s jsonb; BEGIN
  s := public.history_backfill_status();
  ASSERT (s->>'scheduled')::boolean = false, 'empty queue must have no recurring job';
END $$;
ROLLBACK;
BEGIN;
SELECT cron.schedule('market-data-daily','0 9 * * 1-5','daily-original');
SELECT public.enqueue_history_backfill(ARRAY['2330','1101','2330','invalid']);
DO $$ DECLARE s jsonb; BEGIN
 s:=public.history_backfill_status();
 ASSERT (s->>'remaining')::int=2 AND (s->>'scheduled')::boolean;
 ASSERT (SELECT count(*) FROM cron.job WHERE jobname='market-data-backfill')=1;
 ASSERT (SELECT schedule FROM cron.job WHERE jobname='market-data-backfill')='40 * * * *';
 ASSERT (SELECT command FROM cron.job WHERE jobname='market-data-daily')='daily-original';
END $$;
DO $$ DECLARE t uuid; s jsonb; bad boolean:=false; BEGIN
 SELECT lease_token INTO t FROM public.claim_history_backfill(1);
 BEGIN PERFORM public.finish_history_backfill('1101',t,'ready','empty');
 EXCEPTION WHEN OTHERS THEN bad:=true; END;
 ASSERT bad, 'no persisted bars must reject ready';
 s:=public.finish_history_backfill('1101',gen_random_uuid(),'ready');
 ASSERT (s->>'applied')::boolean=false;
 s:=public.finish_history_backfill('1101',t,'failed','provider failed');
 ASSERT (s->>'applied')::boolean;
 ASSERT (public.history_backfill_status()->>'scheduled')::boolean;
 SELECT lease_token INTO t FROM public.claim_history_backfill(1);
 PERFORM public.finish_history_backfill('2330',t,'quota','quota exhausted');
 ASSERT (public.history_backfill_status()->>'due')::int=0;
 ASSERT (public.history_backfill_status()->>'remaining')::int=2;
 ASSERT (public.history_backfill_status()->>'scheduled')::boolean;
END $$;
INSERT INTO public.tw_price_history(symbol,trade_date,close,source)
SELECT s,(now() AT TIME ZONE 'Asia/Taipei')::date-d,100,'fixture'
FROM unnest(ARRAY['1101','2330']) s CROSS JOIN generate_series(1,20) d;
UPDATE public.market_data_requests SET next_attempt_at=now();
DO $$ DECLARE r record; s jsonb; BEGIN
 FOR r IN SELECT * FROM public.claim_history_backfill(40) LOOP
  s:=public.finish_history_backfill(r.symbol,r.lease_token,'ready','20 stored bars');
  ASSERT (s->>'applied')::boolean;
 END LOOP;
 s:=public.history_backfill_status();
 ASSERT (s->>'remaining')::int=0 AND NOT (s->>'scheduled')::boolean;
 ASSERT (SELECT command FROM cron.job WHERE jobname='market-data-daily')='daily-original';
END $$;
SELECT public.enqueue_history_backfill(ARRAY['2330']);
DO $$ BEGIN ASSERT NOT (public.history_backfill_status()->>'scheduled')::boolean; END $$;
DELETE FROM public.tw_price_history WHERE symbol='2330';
SELECT public.enqueue_history_backfill(ARRAY['2330']);
DO $$ BEGIN ASSERT (public.history_backfill_status()->>'remaining')::int=1;
 ASSERT (public.history_backfill_status()->>'scheduled')::boolean; END $$;
ROLLBACK;
BEGIN;
SELECT public.enqueue_history_backfill(array_agg(s::text)) FROM generate_series(1000,1104) s;
DO $$ DECLARE first_set text[]; second_set text[]; BEGIN
 SELECT array_agg(symbol) INTO first_set FROM public.claim_history_backfill(100);
 SELECT array_agg(symbol) INTO second_set FROM public.claim_history_backfill(100);
 ASSERT cardinality(first_set)=40 AND cardinality(second_set)=40;
 ASSERT NOT first_set && second_set;
 ASSERT (public.history_backfill_status()->>'inFlight')::int=80;
 UPDATE public.market_data_requests SET lease_until=now()-interval '1 second' WHERE symbol=ANY(first_set);
 ASSERT (SELECT count(*) FROM public.claim_history_backfill(40))=40;
END $$;
ROLLBACK;
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['history_backfill_status()','refresh_history_backfill_schedule()',
 'enqueue_history_backfill(text[])','claim_history_backfill(integer)','finish_history_backfill(text,uuid,text,text)'] LOOP
  ASSERT NOT has_function_privilege('anon','public.'||f,'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.'||f,'EXECUTE');
  ASSERT has_function_privilege('service_role','public.'||f,'EXECUTE');
 END LOOP;
END $$;