CREATE OR REPLACE FUNCTION public.enqueue_bsr_backfill(
  p_stock_id text,
  p_days int DEFAULT 60
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_is_owner boolean := false;
  v_d date;
  v_inserted int := 0;
  v_count int := 0;
  v_max_days int := LEAST(GREATEST(p_days, 1), 120);
BEGIN
  IF p_stock_id IS NULL OR p_stock_id !~ '^[1-9][0-9]{3}$' THEN
    RAISE EXCEPTION 'invalid stock_id (must be 4-digit code starting 1-9)';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT public.has_role(v_uid, 'admin') INTO v_is_admin;

  IF NOT v_is_admin THEN
    SELECT EXISTS (
      SELECT 1 FROM public.trade_records tr
      JOIN public.experts e ON e.id = tr.expert_id
      WHERE (regexp_match(COALESCE(tr.instrument, ''), '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1] = p_stock_id
        AND e.user_id = v_uid
    ) INTO v_is_owner;
    IF NOT v_is_owner THEN
      SELECT EXISTS (
        SELECT 1 FROM public.checkup_storage cs
        WHERE cs.user_id = v_uid
          AND cs.payload::text LIKE '%' || p_stock_id || '%'
        LIMIT 1
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
      VALUES
        (p_stock_id, v_d, 1, 'pending', now(), 'backfill_rpc', gen_random_uuid(), false)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN v_inserted := v_inserted + 1; END IF;
      v_count := v_count + 1;
    END IF;
    v_d := v_d - 1;
    EXIT WHEN v_d < (now() AT TIME ZONE 'Asia/Taipei')::date - 200;
  END LOOP;

  RETURN v_inserted;
END; $$;

GRANT EXECUTE ON FUNCTION public.enqueue_bsr_backfill(text, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enqueue_bsr_first_fetch_on_trade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock text;
  v_market text := UPPER(COALESCE(NEW.market, ''));
  v_d date;
  v_count int := 0;
BEGIN
  IF v_market NOT IN ('TW', 'TWSE', 'TPEX', '') THEN RETURN NEW; END IF;

  v_stock := (regexp_match(COALESCE(NEW.instrument, ''), '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1];
  IF v_stock IS NULL THEN RETURN NEW; END IF;

  IF (SELECT count(*) FROM public.tw_bsr_daily WHERE stock_id = v_stock) >= 20 THEN
    RETURN NEW;
  END IF;

  v_d := (now() AT TIME ZONE 'Asia/Taipei')::date;
  WHILE v_count < 60 LOOP
    IF EXTRACT(ISODOW FROM v_d) < 6 THEN
      INSERT INTO public.tw_bsr_sync_queue
        (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
      VALUES
        (v_stock, v_d, 1, 'pending', now(), 'trade_insert_hook_backfill', gen_random_uuid(), false)
      ON CONFLICT DO NOTHING;
      v_count := v_count + 1;
    END IF;
    v_d := v_d - 1;
    EXIT WHEN v_d < (now() AT TIME ZONE 'Asia/Taipei')::date - 150;
  END LOOP;

  RETURN NEW;
END; $$;

GRANT EXECUTE ON FUNCTION public.enqueue_bsr_first_fetch_on_trade() TO service_role;
