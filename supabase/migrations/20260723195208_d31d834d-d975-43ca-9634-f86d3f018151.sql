
CREATE OR REPLACE FUNCTION public.enqueue_all_active_tw_holdings_bsr(p_lookback_days int DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_stocks text[];
  v_stock text;
  v_d date;
  v_days_added int := 0;
  v_stock_count int := 0;
  v_inserted int := 0;
  v_row_ct int;
BEGIN
  -- 1) trade_records 中所有出現過 4 碼 TW 代號的（含 closed，方便使用者查歷史）
  WITH t AS (
    SELECT DISTINCT (regexp_match(instrument, '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1] AS sid
      FROM public.trade_records
     WHERE UPPER(COALESCE(market, 'TW')) IN ('TW','TWSE','TPEX','')
       AND instrument ~ '^[1-9][0-9]{3}'
  ),
  -- 2) checkup_storage 中每個使用者的 holdings 陣列裡的 symbol
  c AS (
    SELECT DISTINCT h->>'symbol' AS sid
      FROM public.checkup_storage cs,
           LATERAL jsonb_array_elements(COALESCE(cs.data->'holdings','[]'::jsonb)) h
     WHERE cs.key IN ('portfolio','holdings','state')
  )
  SELECT array_agg(DISTINCT sid) INTO v_stocks
    FROM (SELECT sid FROM t WHERE sid IS NOT NULL UNION SELECT sid FROM c WHERE sid ~ '^[1-9][0-9]{3}$') u;

  IF v_stocks IS NULL THEN
    RETURN jsonb_build_object('stocks', 0, 'inserted', 0);
  END IF;

  FOREACH v_stock IN ARRAY v_stocks LOOP
    -- 只保留合格個股（會過濾權證/ETF/ineligible）
    IF NOT COALESCE((public.tw_bsr_eligibility(v_stock)->>'eligible')::boolean, false) THEN
      CONTINUE;
    END IF;
    v_stock_count := v_stock_count + 1;

    -- 排 tier1 今日 + 近 N 個 weekday（跳週末）
    v_d := v_today;
    v_days_added := 0;
    WHILE v_days_added < p_lookback_days LOOP
      IF EXTRACT(ISODOW FROM v_d) < 6 THEN
        INSERT INTO public.tw_bsr_sync_queue
          (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
        VALUES
          (v_stock, v_d,
           CASE WHEN v_d = v_today THEN 1 ELSE 2 END,
           'pending', now(),
           'enqueue_all_active_holdings',
           gen_random_uuid(),
           false)
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_row_ct = ROW_COUNT;
        v_inserted := v_inserted + v_row_ct;
        v_days_added := v_days_added + 1;
      END IF;
      v_d := v_d - 1;
      EXIT WHEN v_d < v_today - 30;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'stocks_scanned', array_length(v_stocks, 1),
    'stocks_eligible', v_stock_count,
    'inserted', v_inserted,
    'lookback_days', p_lookback_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_all_active_tw_holdings_bsr(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_all_active_tw_holdings_bsr(int) TO service_role;
