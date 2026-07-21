
-- 1. 建立回補 RPC：把過去 N 個工作日一次全部排入 tw_bsr_sync_queue
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
  IF p_stock_id IS NULL OR p_stock_id !~ '^[1-9]\d{3}$' THEN
    RAISE EXCEPTION 'invalid stock_id (must be 4-digit code starting 1-9)';
  END IF;

  -- 權限：管理員或該檔的 trade_records 擁有者（透過 expert 對應）
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT public.has_role(v_uid, 'admin') INTO v_is_admin;

  IF NOT v_is_admin THEN
    SELECT EXISTS (
      SELECT 1 FROM public.trade_records tr
      JOIN public.experts e ON e.id = tr.expert_id
      WHERE substring(COALESCE(tr.instrument, '') FROM '^([0-9]{4})') = p_stock_id
        AND e.user_id = v_uid
    ) INTO v_is_owner;
    IF NOT v_is_owner THEN
      -- 一般會員（Checkup 使用者）：任何持有的自建持倉都可觸發
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

  -- 從今天倒推 v_max_days 個工作日
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
    -- 保護：避免無限迴圈（跨太多年）
    EXIT WHEN v_d < (now() AT TIME ZONE 'Asia/Taipei')::date - 200;
  END LOOP;

  RETURN v_inserted;
END; $$;

GRANT EXECUTE ON FUNCTION public.enqueue_bsr_backfill(text, int) TO authenticated, service_role;

-- 2. 改寫首次抓取觸發器：一次排入 60 個工作日
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

  v_stock := substring(COALESCE(NEW.instrument, '') FROM '^([0-9]{4})');
  IF v_stock IS NULL OR left(v_stock, 1) = '0' THEN RETURN NEW; END IF;

  -- 已有 >= 20 天歷史 → 交給正常排程
  IF (SELECT count(*) FROM public.tw_bsr_daily WHERE stock_id = v_stock) >= 20 THEN
    RETURN NEW;
  END IF;

  -- 過去 60 個工作日，一次排入 P1
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

-- 3. 一次性種子：對現有 chip-eligible 持倉但 tw_bsr_daily < 20 天者，補齊
DO $$
DECLARE
  r record;
  v_d date;
  v_count int;
BEGIN
  FOR r IN
    SELECT DISTINCT substring(COALESCE(instrument, '') FROM '^([0-9]{4})') AS stock_id
    FROM public.trade_records
    WHERE UPPER(COALESCE(market, '')) IN ('TW', 'TWSE', 'TPEX', '')
      AND substring(COALESCE(instrument, '') FROM '^([0-9]{4})') ~ '^[1-9]\d{3}$'
  LOOP
    IF r.stock_id IS NULL THEN CONTINUE; END IF;
    IF (SELECT count(*) FROM public.tw_bsr_daily WHERE stock_id = r.stock_id) >= 20 THEN
      CONTINUE;
    END IF;
    v_d := (now() AT TIME ZONE 'Asia/Taipei')::date;
    v_count := 0;
    WHILE v_count < 60 LOOP
      IF EXTRACT(ISODOW FROM v_d) < 6 THEN
        INSERT INTO public.tw_bsr_sync_queue
          (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
        VALUES
          (r.stock_id, v_d, 1, 'pending', now(), 'backfill_seed_20260721', gen_random_uuid(), false)
        ON CONFLICT DO NOTHING;
        v_count := v_count + 1;
      END IF;
      v_d := v_d - 1;
      EXIT WHEN v_d < (now() AT TIME ZONE 'Asia/Taipei')::date - 150;
    END LOOP;
  END LOOP;
END $$;
