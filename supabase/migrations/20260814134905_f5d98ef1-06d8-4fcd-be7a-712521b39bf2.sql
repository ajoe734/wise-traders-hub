-- P6-R1: sanitize probe error, weekly probe cadence, Lane A fairness

UPDATE public.tw_bsr_sync_config
   SET config = jsonb_set(config, '{last_probe_error}', '"unsupported_plan:sponsor_level"'::jsonb),
       version = version + 1
 WHERE key = 'market_batch'
   AND config->>'last_probe_error' LIKE 'unsupported_plan:http_400:%';

SELECT cron.alter_job(67, schedule => '30 13 * * 1');

CREATE OR REPLACE FUNCTION public.detect_chip_gap_jobs(_target_date date DEFAULT CURRENT_DATE, _lookback_days integer DEFAULT 60, _max_jobs integer DEFAULT 5000)
 RETURNS TABLE(stock_id text, start_date date, end_date date, gap_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH uni AS (
    SELECT u.code AS symbol, u.sources FROM public.checkup_prefetch_universe() u WHERE u.supported
  ),
  open_tr AS (
    SELECT DISTINCT upper(btrim((regexp_match(split_part(tr.instrument,' ',1), '^([0-9A-Z]{4,6})'))[1])) AS code
      FROM public.trade_records tr
     WHERE tr.status = 'open'
       AND COALESCE(upper(tr.market),'TW') IN ('TW','TWSE','TPEX','')
       AND split_part(tr.instrument,' ',1) ~ '^[0-9]'
  ),
  trade_dates AS (
    SELECT td AS trade_date
      FROM public.tw_trading_days(_target_date - (_lookback_days - 1), _target_date) td
  ),
  expected AS (SELECT u.symbol, td.trade_date FROM uni u CROSS JOIN trade_dates td),
  existing AS (
    SELECT DISTINCT bd.stock_id, bd.trade_date
      FROM public.tw_bsr_daily bd
     WHERE bd.trade_date BETWEEN _target_date - (_lookback_days - 1) AND _target_date
  ),
  missing AS (
    SELECT e.symbol, e.trade_date
      FROM expected e
      LEFT JOIN existing ex ON ex.stock_id = e.symbol AND ex.trade_date = e.trade_date
      LEFT JOIN public.tw_bsr_sync_queue q
             ON q.stock_id = e.symbol AND q.trade_date = e.trade_date
            AND q.status IN ('pending','running')
     WHERE ex.stock_id IS NULL AND q.id IS NULL
  ),
  gaps AS (
    SELECT m.symbol, MIN(m.trade_date) AS min_date, MAX(m.trade_date) AS max_date, COUNT(*)::integer AS cnt
      FROM missing m GROUP BY m.symbol
  ),
  ranked AS (
    SELECT g.*,
           CASE
             WHEN 'checkup_storage' = ANY(u.sources) THEN 1
             WHEN 'trade_records' = ANY(u.sources) AND EXISTS (SELECT 1 FROM open_tr o WHERE o.code = g.symbol) THEN 2
             ELSE 3
           END AS source_rank
      FROM gaps g JOIN uni u ON u.symbol = g.symbol
  )
  SELECT r.symbol AS stock_id, r.min_date AS start_date, r.max_date AS end_date, r.cnt AS gap_count
    FROM ranked r
   ORDER BY r.source_rank ASC,
            (r.max_date = _target_date) DESC,
            r.cnt DESC,
            r.symbol ASC
   LIMIT _max_jobs;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_chips_prefetch_gaps(p_lookback_days integer DEFAULT 10, p_max_stocks integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tpe_now timestamp := (now() AT TIME ZONE 'Asia/Taipei');
  v_today date := v_tpe_now::date;
  v_end date;
  v_inserted int := 0;
  v_row_ct int;
  v_gaps int := 0;
  g record;
  d date;
  v_rank int;
  v_recover jsonb;
  v_bp jsonb;
  v_quota_recover jsonb;
BEGIN
  v_end := CASE WHEN v_tpe_now::time >= time '15:00' THEN v_today ELSE v_today - 1 END;
  SELECT max(td) INTO v_end FROM public.tw_trading_days(v_end - 10, v_end) td;
  IF v_end IS NULL THEN
    RETURN jsonb_build_object('skipped', 'no_trading_day');
  END IF;

  FOR g IN
    SELECT * FROM public.detect_chip_gap_jobs(v_end, p_lookback_days, p_max_stocks)
  LOOP
    v_gaps := v_gaps + 1;

    SELECT CASE
             WHEN 'checkup_storage' = ANY(u.sources) THEN 1
             WHEN 'trade_records' = ANY(u.sources) AND EXISTS (
               SELECT 1 FROM public.trade_records tr
                WHERE tr.status = 'open'
                  AND COALESCE(upper(tr.market),'TW') IN ('TW','TWSE','TPEX','')
                  AND upper(btrim((regexp_match(split_part(tr.instrument,' ',1), '^([0-9A-Z]{4,6})'))[1])) = g.stock_id
             ) THEN 2
             ELSE 3
           END
      INTO v_rank
      FROM public.checkup_prefetch_universe() u
     WHERE u.code = g.stock_id
     LIMIT 1;

    v_rank := COALESCE(v_rank, 3);

    FOR d IN
      SELECT td FROM public.tw_trading_days(v_end - (p_lookback_days - 1), v_end) td
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.tw_bsr_daily bd
         WHERE bd.stock_id = g.stock_id AND bd.trade_date = d
      ) THEN
        INSERT INTO public.tw_bsr_sync_queue
          (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
        VALUES (g.stock_id, d, v_rank,
                'pending', now(), 'chips_prefetch_hourly:r' || v_rank, gen_random_uuid(), false)
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_row_ct = ROW_COUNT;
        v_inserted := v_inserted + v_row_ct;
      END IF;
    END LOOP;
  END LOOP;

  v_recover := public.recover_stale_bsr_queue_jobs();

  v_bp := public.bsr_recovery_budget(12);
  v_quota_recover := public.recover_quota_failed_bsr_jobs((v_bp->>'budget')::int);

  RETURN jsonb_build_object(
    'target_date', v_end,
    'lookback_days', p_lookback_days,
    'stocks_with_gaps', v_gaps,
    'inserted', v_inserted,
    'recovery', v_recover,
    'backpressure', v_bp,
    'quota_recovery', v_quota_recover
  );
END;
$function$;