
CREATE OR REPLACE FUNCTION public.converge_bsr_windows(p_max_stocks integer DEFAULT 500, p_chunk_dates integer DEFAULT 15, p_horizon_days integer DEFAULT 110)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_stock text; v_readiness jsonb;
  v_stocks_scanned int := 0; v_stocks_converged int := 0;
  v_stocks_exhausted int := 0; v_stocks_ready int := 0;
  v_stocks_total int := 0; v_jobs_created int := 0;
  v_d date; v_added int; v_valid_dates date[]; v_valid_days int;
BEGIN
  FOR v_stock, v_valid_days IN
    WITH t AS (
      SELECT DISTINCT (regexp_match(instrument, '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1] AS sid
        FROM public.trade_records
       WHERE UPPER(COALESCE(market,'TW')) IN ('TW','TWSE','TPEX','')
         AND instrument ~ '^[1-9][0-9]{3}'
    ),
    c AS (
      SELECT DISTINCT h->>'symbol' AS sid
        FROM public.checkup_storage cs,
             LATERAL jsonb_array_elements(COALESCE(cs.data->'holdings','[]'::jsonb)) h
       WHERE cs.key IN ('portfolio','holdings','state')
    ),
    e AS (
      -- 分析師公開已發布訊號（近 180 天內建立）也納入活躍股名單，
      -- 讓所有讀者點開籌碼抽屜時都有完整歷史。
      SELECT DISTINCT (regexp_match(instrument, '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1] AS sid
        FROM public.expert_signals
       WHERE status = 'published'
         AND UPPER(COALESCE(market,'TW')) IN ('TW','TWSE','TPEX','')
         AND created_at >= now() - INTERVAL '180 days'
         AND instrument ~ '^[1-9][0-9]{3}'
    ),
    all_stocks AS (
      SELECT sid FROM t WHERE sid ~ '^[1-9][0-9]{3}$'
      UNION SELECT sid FROM c WHERE sid ~ '^[1-9][0-9]{3}$'
      UNION SELECT sid FROM e WHERE sid ~ '^[1-9][0-9]{3}$'
    ),
    coverage AS (
      SELECT s.sid,
             COALESCE((SELECT COUNT(*)::int FROM (
                SELECT trade_date FROM public.tw_bsr_daily
                 WHERE stock_id=s.sid AND trade_date >= v_today - 90
                 GROUP BY trade_date HAVING COUNT(DISTINCT broker_id) >= 1) x),0) AS valid_days,
             (SELECT MAX(trade_date) FROM public.tw_bsr_daily d WHERE d.stock_id=s.sid) AS last_valid
        FROM all_stocks s
    )
    SELECT sid, valid_days FROM coverage
     ORDER BY valid_days ASC, last_valid ASC NULLS FIRST, sid
     LIMIT p_max_stocks
  LOOP
    v_stocks_total := v_stocks_total + 1;
    IF NOT COALESCE((public.tw_bsr_eligibility(v_stock)->>'eligible')::boolean,false) THEN CONTINUE; END IF;
    v_stocks_scanned := v_stocks_scanned + 1;
    v_readiness := public.compute_bsr_series_readiness(v_stock);
    IF COALESCE((v_readiness->>'ready60')::boolean,false) THEN v_stocks_ready := v_stocks_ready+1; CONTINUE; END IF;
    IF COALESCE((v_readiness->>'exhausted')::boolean,false) THEN v_stocks_exhausted := v_stocks_exhausted+1; CONTINUE; END IF;

    SELECT COALESCE(array_agg(trade_date), ARRAY[]::date[]) INTO v_valid_dates
      FROM (SELECT trade_date FROM public.tw_bsr_daily WHERE stock_id=v_stock
            GROUP BY trade_date HAVING COUNT(DISTINCT broker_id) >= 1) x;

    v_d := v_today; v_added := 0;
    WHILE v_added < p_chunk_dates AND v_d > v_today - p_horizon_days LOOP
      IF EXTRACT(ISODOW FROM v_d) < 6 AND NOT (v_d = ANY(v_valid_dates)) THEN
        BEGIN
          INSERT INTO public.tw_bsr_sync_queue (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
          VALUES (v_stock, v_d, CASE WHEN v_d=v_today THEN 1 ELSE 2 END, 'pending', now(), 'converge_bsr_windows', gen_random_uuid(), false)
          ON CONFLICT DO NOTHING;
          IF FOUND THEN v_jobs_created := v_jobs_created+1; v_added := v_added+1; END IF;
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;
      v_d := v_d - 1;
    END LOOP;
    IF v_added > 0 THEN v_stocks_converged := v_stocks_converged + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'stocks_total', v_stocks_total, 'stocks_scanned', v_stocks_scanned,
    'stocks_ready', v_stocks_ready, 'stocks_exhausted', v_stocks_exhausted,
    'stocks_converged', v_stocks_converged, 'jobs_created', v_jobs_created,
    'deterministic_order', true,
    'params', jsonb_build_object('max_stocks', p_max_stocks, 'chunk_dates', p_chunk_dates, 'horizon_days', p_horizon_days, 'threshold', 1)
  );
END;
$function$;

-- 立即補一次
SELECT public.converge_bsr_windows(200, 30, 110) AS result;
