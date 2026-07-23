CREATE OR REPLACE FUNCTION public.ensure_bsr_queued(p_stock_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_elig jsonb;
  v_today date;
  v_active record;
  v_done record;
  v_failure record;
  v_next timestamptz := now();
  v_reason text;
  v_inserted integer := 0;
  v_raw_rows integer := 0;
  v_done_threshold integer := 5;
BEGIN
  v_elig := public.tw_bsr_eligibility(p_stock_id);
  IF COALESCE((v_elig->>'eligible')::boolean, false) = false THEN
    RETURN v_elig || jsonb_build_object('created', false, 'status', 'ineligible');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('bsr_queue:' || p_stock_id));

  v_today := (now() AT TIME ZONE 'Asia/Taipei')::date;

  -- 已有 active job → no-op
  SELECT status, trade_date, next_run_at INTO v_active
    FROM public.tw_bsr_sync_queue
    WHERE stock_id = p_stock_id AND status IN ('pending','running')
    ORDER BY updated_at DESC
    LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'eligible', true,
      'created', false,
      'status', v_active.status,
      'trade_date', v_active.trade_date,
      'next_run_at', v_active.next_run_at
    );
  END IF;

  -- 今日已 done 必須同時有足夠 raw broker rows，否則視為 fake_done，允許重新排隊。
  SELECT trade_date, updated_at INTO v_done
    FROM public.tw_bsr_sync_queue
    WHERE stock_id = p_stock_id AND trade_date = v_today AND status = 'done'
    ORDER BY updated_at DESC
    LIMIT 1;
  IF FOUND THEN
    SELECT count(*) INTO v_raw_rows
      FROM public.tw_bsr_daily
      WHERE stock_id = p_stock_id AND trade_date = v_today;

    IF v_raw_rows >= v_done_threshold THEN
      RETURN jsonb_build_object(
        'eligible', true,
        'created', false,
        'status', 'completed',
        'trade_date', v_done.trade_date,
        'completed_at', v_done.updated_at,
        'raw_rows', v_raw_rows
      );
    END IF;
  END IF;

  -- 尊重 fetch_failures 冷卻
  SELECT next_retry_at, reason INTO v_failure
    FROM public.tw_bsr_fetch_failures
    WHERE stock_id = p_stock_id AND resolved_at IS NULL
    ORDER BY trade_date DESC
    LIMIT 1;
  IF FOUND AND v_failure.next_retry_at IS NOT NULL AND v_failure.next_retry_at > now() THEN
    v_next := v_failure.next_retry_at;
    v_reason := v_failure.reason;
  END IF;

  INSERT INTO public.tw_bsr_sync_queue
    (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
  VALUES
    (p_stock_id, v_today, 1, 'pending', v_next, 'ensure_bsr_queued', gen_random_uuid(), false)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'eligible', true,
    'created', v_inserted > 0,
    'status', 'pending',
    'trade_date', v_today,
    'next_run_at', v_next,
    'respected_backoff_reason', v_reason,
    'requeued_fake_done', FOUND,
    'raw_rows', v_raw_rows,
    'required_raw_rows', v_done_threshold
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_bsr_queued(text) TO authenticated, service_role;