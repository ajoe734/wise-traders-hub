
-- 部分唯一索引：同一 (stock_id, trade_date) 只允許一筆「未完成」的 job
DROP INDEX IF EXISTS public.tw_bsr_sync_queue_active_uniq;
CREATE UNIQUE INDEX tw_bsr_sync_queue_active_uniq
  ON public.tw_bsr_sync_queue (stock_id, trade_date)
  WHERE status IN ('pending','running','failed','skipped');

CREATE OR REPLACE FUNCTION public.ensure_bsr_window(
  p_stock_id text,
  p_window_days int DEFAULT 5,
  p_horizon_days int DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_valid_dates date[];
  v_existing text[] := ARRAY[]::text[];
  v_promoted text[] := ARRAY[]::text[];
  v_newly_queued text[] := ARRAY[]::text[];
  v_d date;
  v_added int := 0;
  v_target int;
  v_probe_exhausted boolean := null;
  v_existing_row record;
BEGIN
  IF p_stock_id !~ '^[1-9][0-9]{3}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_stock_id', 'stock_id', p_stock_id);
  END IF;

  IF NOT COALESCE((public.tw_bsr_eligibility(p_stock_id)->>'eligible')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ineligible', 'stock_id', p_stock_id);
  END IF;

  SELECT COALESCE(exhausted, false) INTO v_probe_exhausted
    FROM public.tw_bsr_upstream_probe WHERE stock_id = p_stock_id;

  v_target := GREATEST(1, LEAST(60, p_window_days));

  SELECT COALESCE(array_agg(trade_date), ARRAY[]::date[])
    INTO v_valid_dates
    FROM (
      SELECT trade_date
        FROM public.tw_bsr_daily
       WHERE stock_id = p_stock_id
       GROUP BY trade_date
      HAVING COUNT(DISTINCT broker_id) >= 5
    ) x;

  v_d := v_today;
  WHILE v_added < v_target AND v_d > v_today - p_horizon_days LOOP
    IF EXTRACT(ISODOW FROM v_d) < 6 THEN
      IF v_d = ANY(v_valid_dates) THEN
        v_existing := array_append(v_existing, v_d::text);
        v_added := v_added + 1;
      ELSE
        SELECT id, status, priority
          INTO v_existing_row
          FROM public.tw_bsr_sync_queue
         WHERE stock_id = p_stock_id AND trade_date = v_d
         ORDER BY CASE status
                    WHEN 'done' THEN 4
                    WHEN 'running' THEN 1
                    WHEN 'pending' THEN 2
                    WHEN 'failed' THEN 3
                    WHEN 'skipped' THEN 3
                    ELSE 5 END, updated_at DESC
         LIMIT 1;

        IF v_existing_row.id IS NULL THEN
          BEGIN
            INSERT INTO public.tw_bsr_sync_queue
              (stock_id, trade_date, priority, status, next_run_at,
               enqueued_by, correlation_id, post_close_only)
            VALUES
              (p_stock_id, v_d, 1, 'pending', now(),
               'ensure_bsr_window', gen_random_uuid(), false);
            v_newly_queued := array_append(v_newly_queued, v_d::text);
            v_added := v_added + 1;
          EXCEPTION WHEN unique_violation THEN
            -- 併發競態：其他呼叫剛剛插入，視同已排程
            v_promoted := array_append(v_promoted, v_d::text);
            v_added := v_added + 1;
          END;
        ELSIF v_existing_row.status = 'done' THEN
          -- done 但沒有效資料 → 該日視為缺料，插入新一筆
          BEGIN
            INSERT INTO public.tw_bsr_sync_queue
              (stock_id, trade_date, priority, status, next_run_at,
               enqueued_by, correlation_id, post_close_only)
            VALUES
              (p_stock_id, v_d, 1, 'pending', now(),
               'ensure_bsr_window', gen_random_uuid(), false);
            v_newly_queued := array_append(v_newly_queued, v_d::text);
            v_added := v_added + 1;
          EXCEPTION WHEN unique_violation THEN
            v_promoted := array_append(v_promoted, v_d::text);
            v_added := v_added + 1;
          END;
        ELSE
          -- pending / running / failed / skipped → 提到最高優先、重排
          UPDATE public.tw_bsr_sync_queue
             SET priority = LEAST(priority, 1),
                 status = CASE WHEN status IN ('failed','skipped') THEN 'pending' ELSE status END,
                 next_run_at = LEAST(COALESCE(next_run_at, now()), now()),
                 updated_at = now()
           WHERE id = v_existing_row.id;
          v_promoted := array_append(v_promoted, v_d::text);
          v_added := v_added + 1;
        END IF;
      END IF;
    END IF;
    v_d := v_d - 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'stock_id', p_stock_id,
    'window_days', v_target,
    'today', v_today,
    'have_valid_days', array_length(v_valid_dates, 1),
    'existing_in_window', v_existing,
    'newly_queued', v_newly_queued,
    'promoted', v_promoted,
    'upstream_exhausted', COALESCE(v_probe_exhausted, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_bsr_window(text, int, int) TO anon, authenticated, service_role;

-- 立即補齊 3443
DO $$
DECLARE r jsonb;
BEGIN
  r := public.ensure_bsr_window('3443', 5, 10);
  RAISE NOTICE 'ensure_bsr_window 3443 => %', r::text;
END $$;
