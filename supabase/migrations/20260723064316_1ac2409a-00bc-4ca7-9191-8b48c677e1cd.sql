
-- Eligibility check for BSR chip data
CREATE OR REPLACE FUNCTION public.tw_bsr_eligibility(p_stock_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sn record;
BEGIN
  IF p_stock_id IS NULL OR btrim(p_stock_id) = '' THEN
    RETURN jsonb_build_object('eligible', false, 'ineligible_reason', 'invalid_stock_id');
  END IF;

  -- 台股個股代號：4 位數字、首位 1-9（FinMind 分點覆蓋範圍）
  IF NOT (p_stock_id ~ '^[1-9][0-9]{3}$') THEN
    -- 若在 stock_names 內找得到但非 tw_stock，回 unsupported_asset_type；否則 invalid
    SELECT symbol, asset_class INTO v_sn
      FROM public.stock_names WHERE symbol = p_stock_id LIMIT 1;
    IF FOUND AND v_sn.asset_class IS NOT NULL AND v_sn.asset_class <> 'tw_stock' THEN
      RETURN jsonb_build_object(
        'eligible', false,
        'ineligible_reason', 'unsupported_asset_type',
        'asset_class', v_sn.asset_class
      );
    END IF;
    -- 4 位數字但首位為 0（ETF/受益憑證）視為 unsupported_asset_type
    IF p_stock_id ~ '^0[0-9]{3,5}$' THEN
      RETURN jsonb_build_object('eligible', false, 'ineligible_reason', 'unsupported_asset_type');
    END IF;
    RETURN jsonb_build_object('eligible', false, 'ineligible_reason', 'invalid_stock_id');
  END IF;

  -- 若 stock_names 明示為非 tw_stock（罕見），視為 unsupported
  SELECT asset_class INTO v_sn FROM public.stock_names WHERE symbol = p_stock_id LIMIT 1;
  IF FOUND AND v_sn.asset_class IS NOT NULL AND v_sn.asset_class <> 'tw_stock' THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'ineligible_reason', 'unsupported_asset_type',
      'asset_class', v_sn.asset_class
    );
  END IF;

  RETURN jsonb_build_object('eligible', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.tw_bsr_eligibility(text) TO authenticated, anon, service_role;


-- Idempotent enqueue: only add a pending job for today's Taipei date if none active and cooldown respected
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
  v_failure record;
  v_next timestamptz := now();
  v_reason text;
  v_inserted integer := 0;
BEGIN
  v_elig := public.tw_bsr_eligibility(p_stock_id);
  IF COALESCE((v_elig->>'eligible')::boolean, false) = false THEN
    RETURN v_elig || jsonb_build_object('created', false, 'status', 'ineligible');
  END IF;

  -- Advisory lock：同 stock 併發呼叫序列化（不依賴 row 存在）
  PERFORM pg_advisory_xact_lock(hashtext('bsr_queue:' || p_stock_id));

  v_today := (now() AT TIME ZONE 'Asia/Taipei')::date;

  -- 已有 active job（不限日期）→ no-op，回傳目前 status
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

  -- 靠 tw_bsr_sync_queue_active_uniq(stock_id, trade_date) partial unique index 兜底
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
    'respected_backoff_reason', v_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_bsr_queued(text) TO authenticated, service_role;
