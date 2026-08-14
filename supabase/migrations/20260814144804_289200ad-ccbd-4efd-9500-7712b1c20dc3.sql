CREATE OR REPLACE FUNCTION public.enqueue_bsr_backfill(p_stock_id text, p_days integer DEFAULT 60)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_is_owner boolean := false;
  v_d date;
  v_inserted int := 0;
  v_count int := 0;
  v_row_ct int;
  v_max_days int := LEAST(GREATEST(p_days, 1), 120);
BEGIN
  IF p_stock_id IS NULL OR p_stock_id !~ '^[1-9][0-9]{3}$' THEN
    RAISE EXCEPTION 'invalid stock_id (must be 4-digit code starting 1-9)';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT public.has_role(v_uid, 'company_admin') INTO v_is_admin;

  IF NOT v_is_admin THEN
    SELECT EXISTS (
      SELECT 1 FROM public.trade_records tr
      JOIN public.experts e ON e.id = tr.expert_id
      WHERE (regexp_match(COALESCE(tr.instrument, ''), '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1] = p_stock_id
        AND e.user_id = v_uid
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      -- 只看「自己」的持倉列；解析 array 與 {holdings:[]} 兩種形狀
      SELECT EXISTS (
        SELECT 1
          FROM public.checkup_storage cs,
               LATERAL jsonb_array_elements(
                 CASE
                   WHEN jsonb_typeof(cs.data) = 'array' THEN cs.data
                   WHEN jsonb_typeof(cs.data->'holdings') = 'array' THEN cs.data->'holdings'
                   ELSE '[]'::jsonb
                 END
               ) h
         WHERE cs.user_id = v_uid
           AND cs.key LIKE 'pf-holdings%'
           AND upper(btrim(COALESCE(h->>'code', h->>'symbol'))) = p_stock_id
      ) INTO v_is_owner;
    END IF;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'not authorized to backfill this stock';
    END IF;
  END IF;

  v_d := (now() AT TIME ZONE 'Asia/Taipei')::date;
  WHILE v_count < v_max_days LOOP
    IF EXTRACT(ISODOW FROM v_d) < 6 THEN
      INSERT INTO public.tw_bsr_sync_queue
        (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
      VALUES (p_stock_id, v_d, 1, 'pending', now(), 'backfill_rpc', gen_random_uuid(), false)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_row_ct = ROW_COUNT;
      v_inserted := v_inserted + v_row_ct;
      v_count := v_count + 1;
    END IF;
    v_d := v_d - 1;
    EXIT WHEN v_d < (now() AT TIME ZONE 'Asia/Taipei')::date - 200;
  END LOOP;

  RETURN v_inserted;
END; $function$;