CREATE OR REPLACE FUNCTION public.enqueue_institutional_backfill_universe()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n INT;
BEGIN
  WITH cov AS (
    SELECT stock_id, COUNT(DISTINCT trade_date) AS d
      FROM public.tw_institutional_daily
     GROUP BY stock_id
  ),
  saved AS (
    SELECT DISTINCT upper(btrim(COALESCE(h->>'code', h->>'symbol'))) AS sid
      FROM public.checkup_storage cs,
           LATERAL jsonb_array_elements(
             CASE
               WHEN jsonb_typeof(cs.data) = 'array' THEN cs.data
               WHEN jsonb_typeof(cs.data->'holdings') = 'array' THEN cs.data->'holdings'
               ELSE '[]'::jsonb
             END
           ) h
     WHERE cs.key LIKE 'pf-holdings%'
  ),
  open_pos AS (
    SELECT DISTINCT sid FROM (
      SELECT SPLIT_PART(TRIM(tr.instrument), ' ', 1) AS sid
        FROM public.trade_records tr
       WHERE tr.market = 'TW' AND tr.status::text = 'open'
      UNION
      SELECT SPLIT_PART(TRIM(es.instrument), ' ', 1)
        FROM public.expert_signals es
       WHERE es.market = 'TW'
    ) x
  ),
  others AS (
    SELECT DISTINCT u.code AS sid
      FROM public.checkup_prefetch_universe() u
     WHERE u.supported
    UNION
    SELECT DISTINCT stock_id FROM public.v_active_tw_holdings
  ),
  r1 AS (SELECT sid FROM saved WHERE sid ~ '^[1-9][0-9]{3}$'),
  r2 AS (
    SELECT sid FROM open_pos
     WHERE sid ~ '^[1-9][0-9]{3}$'
       AND sid NOT IN (SELECT sid FROM r1)
  ),
  r3 AS (
    SELECT sid FROM others
     WHERE sid ~ '^[1-9][0-9]{3}$'
       AND sid NOT IN (SELECT sid FROM r1)
       AND sid NOT IN (SELECT sid FROM r2)
  ),
  elig AS (
    SELECT c.sid, c.rnk
      FROM (
        SELECT sid, 1 AS rnk FROM r1
        UNION ALL SELECT sid, 2 FROM r2
        UNION ALL SELECT sid, 3 FROM r3
      ) c
      LEFT JOIN cov ON cov.stock_id = c.sid
      LEFT JOIN public.institutional_new_stock_queue q ON q.stock_id = c.sid
     WHERE COALESCE(cov.d, 0) < 40
       AND (
         q.stock_id IS NULL
         OR (
           q.status IN ('failed', 'dead')
           AND q.attempts < 5
           AND q.next_attempt_at <= now()
           AND COALESCE(q.last_error, '') !~* '(no_data|delisted|ineligible|sealed|terminal)'
         )
       )
  ),
  cand AS (
        (SELECT sid FROM elig WHERE rnk = 1 ORDER BY sid LIMIT 20)
    UNION ALL
        (SELECT sid FROM elig WHERE rnk = 2 ORDER BY sid LIMIT 15)
    UNION ALL
        (SELECT sid FROM elig WHERE rnk = 3 ORDER BY sid LIMIT 5)
  ),
  ins AS (
    INSERT INTO public.institutional_new_stock_queue (stock_id, status, attempts, next_attempt_at)
    SELECT sid, 'pending', 0, now() FROM cand
    ON CONFLICT (stock_id) DO UPDATE
       SET status = 'pending',
           next_attempt_at = now() + LEAST(
             interval '24 hours',
             make_interval(mins => (30 * power(2, LEAST(public.institutional_new_stock_queue.attempts, 10)))::int)
           ),
           updated_at = now()
       WHERE public.institutional_new_stock_queue.status IN ('failed', 'dead')
         AND public.institutional_new_stock_queue.attempts < 5
         AND public.institutional_new_stock_queue.next_attempt_at <= now()
         AND COALESCE(public.institutional_new_stock_queue.last_error, '') !~* '(no_data|delisted|ineligible|sealed|terminal)'
    RETURNING 1
  )
  SELECT COUNT(*) INTO _n FROM ins;
  RETURN _n;
END;
$function$;

DO $do$
BEGIN
  IF to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') IS NOT NULL THEN
    PERFORM cron.alter_job(job_id => 71, schedule => '15 * * * *');
    PERFORM cron.alter_job(job_id => 72, schedule => '*/15 6-11 * * *');
  END IF;
END
$do$;