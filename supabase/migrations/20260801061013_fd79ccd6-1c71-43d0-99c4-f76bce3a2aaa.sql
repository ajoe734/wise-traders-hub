CREATE OR REPLACE FUNCTION public.expected_latest_bsr_date()
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH base AS (
    SELECT CASE WHEN EXTRACT(hour FROM (now() AT TIME ZONE 'Asia/Taipei')) >= 15
                THEN (now() AT TIME ZONE 'Asia/Taipei')::date
                ELSE (now() AT TIME ZONE 'Asia/Taipei')::date - 1 END AS d
  ), cand AS (
    SELECT (SELECT d FROM base) - g AS dd FROM generate_series(0, 20) g
  )
  SELECT max(dd) FROM cand
   WHERE EXTRACT(ISODOW FROM dd) < 6
     AND NOT EXISTS (SELECT 1 FROM public.tw_market_holidays h WHERE h.trade_date = dd);
$$;
GRANT EXECUTE ON FUNCTION public.expected_latest_bsr_date() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.converge_bsr_windows(p_max_stocks integer DEFAULT 500, p_chunk_dates integer DEFAULT 15, p_horizon_days integer DEFAULT 110)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_expected date := public.expected_latest_bsr_date();
  v_stock text; v_readiness jsonb; v_latest date;
  v_stocks_scanned int := 0; v_stocks_converged int := 0;
  v_stocks_exhausted int := 0; v_stocks_ready int := 0;
  v_stocks_total int := 0; v_jobs_created int := 0; v_stocks_stale int := 0;
  v_d date; v_added int; v_valid_dates date[]; v_valid_days int;
BEGIN
  CREATE TEMP TABLE _conv_cand ON COMMIT DROP AS
  WITH t AS (
    SELECT DISTINCT (regexp_match(instrument, '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1] AS sid
      FROM public.trade_records
     WHERE UPPER(COALESCE(market,'TW')) IN ('TW','TWSE','TPEX','') AND instrument ~ '^[1-9][0-9]{3}'
  ), c AS (
    SELECT DISTINCT h->>'symbol' AS sid
      FROM public.checkup_storage cs,
           LATERAL jsonb_array_elements(COALESCE(cs.data->'holdings','[]'::jsonb)) h
     WHERE cs.key IN ('portfolio','holdings','state')
  ), e AS (
    SELECT DISTINCT (regexp_match(instrument, '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1] AS sid
      FROM public.expert_signals
     WHERE status = 'published' AND UPPER(COALESCE(market,'TW')) IN ('TW','TWSE','TPEX','')
       AND created_at >= now() - INTERVAL '180 days' AND instrument ~ '^[1-9][0-9]{3}'
  ), all_stocks AS (
    SELECT sid FROM t WHERE sid ~ '^[1-9][0-9]{3}$'
    UNION SELECT sid FROM c WHERE sid ~ '^[1-9][0-9]{3}$'
    UNION SELECT sid FROM e WHERE sid ~ '^[1-9][0-9]{3}$'
  ), cov AS (
    SELECT stock_id,
           COUNT(*) FILTER (WHERE trade_date >= v_today - 90)::int AS valid_days,
           MAX(trade_date) AS last_valid
      FROM (SELECT stock_id, trade_date FROM public.tw_bsr_daily GROUP BY 1,2) g
     GROUP BY stock_id
  )
  SELECT s.sid, COALESCE(cov.valid_days,0) AS valid_days, cov.last_valid
    FROM all_stocks s LEFT JOIN cov ON cov.stock_id = s.sid;

  FOR v_stock, v_valid_days IN
    SELECT sid, valid_days FROM _conv_cand
     ORDER BY valid_days ASC, last_valid ASC NULLS FIRST, sid
     LIMIT p_max_stocks
  LOOP
    v_stocks_total := v_stocks_total + 1;
    IF NOT COALESCE((public.tw_bsr_eligibility(v_stock)->>'eligible')::boolean,false) THEN CONTINUE; END IF;
    v_stocks_scanned := v_stocks_scanned + 1;
    v_readiness := public.compute_bsr_series_readiness(v_stock);
    v_latest := NULLIF(v_readiness->>'latest_available','')::date;

    -- ready60 只代表「總天數夠」，不代表「最近幾天有抓到」。
    -- 2026-07-28~31 就是這樣被跳過：60 日視窗滿了，但最新只到 7/23。
    IF COALESCE((v_readiness->>'ready60')::boolean,false)
       AND v_latest IS NOT NULL AND v_latest >= v_expected THEN
      v_stocks_ready := v_stocks_ready + 1; CONTINUE;
    END IF;
    IF v_latest IS NOT NULL AND v_latest < v_expected THEN v_stocks_stale := v_stocks_stale + 1; END IF;
    IF COALESCE((v_readiness->>'exhausted')::boolean,false)
       AND COALESCE((v_readiness->>'ready60')::boolean,false)
       AND v_latest IS NOT NULL AND v_latest >= v_expected THEN
      v_stocks_exhausted := v_stocks_exhausted + 1; CONTINUE;
    END IF;

    SELECT COALESCE(array_agg(trade_date), ARRAY[]::date[]) INTO v_valid_dates
      FROM (SELECT trade_date FROM public.tw_bsr_daily WHERE stock_id=v_stock
             AND trade_date >= v_today - p_horizon_days
            GROUP BY trade_date HAVING COUNT(DISTINCT broker_id) >= 1) x;

    v_d := v_expected; v_added := 0;
    WHILE v_added < p_chunk_dates AND v_d > v_today - p_horizon_days LOOP
      IF EXTRACT(ISODOW FROM v_d) < 6
         AND NOT EXISTS (SELECT 1 FROM public.tw_market_holidays h WHERE h.trade_date = v_d)
         AND NOT (v_d = ANY(v_valid_dates)) THEN
        BEGIN
          INSERT INTO public.tw_bsr_sync_queue (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
          VALUES (v_stock, v_d, CASE WHEN v_d >= v_expected THEN 1 ELSE 2 END, 'pending', now(), 'converge_bsr_windows', gen_random_uuid(), false)
          ON CONFLICT DO NOTHING;
          IF FOUND THEN v_jobs_created := v_jobs_created+1; v_added := v_added+1; END IF;
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;
      v_d := v_d - 1;
    END LOOP;
    IF v_added > 0 THEN v_stocks_converged := v_stocks_converged + 1; END IF;
  END LOOP;

  DROP TABLE IF EXISTS _conv_cand;

  RETURN jsonb_build_object(
    'stocks_total', v_stocks_total, 'stocks_scanned', v_stocks_scanned,
    'stocks_ready', v_stocks_ready, 'stocks_stale', v_stocks_stale,
    'stocks_exhausted', v_stocks_exhausted, 'stocks_converged', v_stocks_converged,
    'jobs_created', v_jobs_created, 'expected_latest', v_expected, 'deterministic_order', true,
    'params', jsonb_build_object('max_stocks', p_max_stocks, 'chunk_dates', p_chunk_dates, 'horizon_days', p_horizon_days, 'threshold', 1)
  );
END;
$function$;