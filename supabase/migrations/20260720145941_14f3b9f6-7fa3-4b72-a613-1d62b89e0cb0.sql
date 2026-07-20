
-- ============================================================================
-- 1. Reservation 表：每筆 API 呼叫必先寫入一筆
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tw_bsr_api_reservations (
  id bigserial PRIMARY KEY,
  api_name text NOT NULL DEFAULT 'finmind',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  settled_at timestamptz,
  success boolean,
  rate_limited boolean NOT NULL DEFAULT false,
  released boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS tw_bsr_api_reservations_active_idx
  ON public.tw_bsr_api_reservations (api_name, reserved_at DESC)
  WHERE settled_at IS NULL AND released = false;

CREATE INDEX IF NOT EXISTS tw_bsr_api_reservations_recent_idx
  ON public.tw_bsr_api_reservations (api_name, reserved_at DESC);

GRANT SELECT ON public.tw_bsr_api_reservations TO authenticated;
GRANT ALL ON public.tw_bsr_api_reservations TO service_role;

ALTER TABLE public.tw_bsr_api_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_admin_can_read_bsr_reservations" ON public.tw_bsr_api_reservations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE POLICY "service_role_manages_bsr_reservations" ON public.tw_bsr_api_reservations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- 2. 原子預留 RPC：check + insert 在同一個 advisory lock 內完成
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reserve_bsr_api_quota(
  _limit int DEFAULT 1500,
  _api text DEFAULT 'finmind',
  _lease_seconds int DEFAULT 30
)
RETURNS TABLE (reservation_id bigint, used int, remaining int, granted boolean)
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _usage int;
  _active_res int;
  _total int;
  _new_id bigint;
BEGIN
  -- 每個 api 一把 lock，序列化 reserve 操作，保證 check+insert 原子
  PERFORM pg_advisory_xact_lock(hashtextextended('bsr_rate_limit:' || _api, 0));

  -- 過期未結算的 reservation 先自動釋放，避免額度永久占用
  UPDATE public.tw_bsr_api_reservations
     SET released = true, settled_at = now()
   WHERE api_name = _api
     AND settled_at IS NULL
     AND released = false
     AND expires_at < now();

  -- 已結算的 usage（近 60 分鐘）
  SELECT COALESCE(SUM(call_count), 0)::int INTO _usage
    FROM public.tw_bsr_api_usage
   WHERE api_name = _api
     AND bucket_start >= now() - interval '60 minutes';

  -- 尚在 in-flight 的 reservation（近 60 分鐘）
  SELECT COUNT(*)::int INTO _active_res
    FROM public.tw_bsr_api_reservations
   WHERE api_name = _api
     AND settled_at IS NULL
     AND released = false
     AND reserved_at >= now() - interval '60 minutes';

  _total := _usage + _active_res;

  IF _total >= _limit THEN
    reservation_id := NULL;
    used := _total;
    remaining := 0;
    granted := false;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.tw_bsr_api_reservations (api_name, expires_at)
  VALUES (_api, now() + make_interval(secs => _lease_seconds))
  RETURNING id INTO _new_id;

  reservation_id := _new_id;
  used := _total + 1;
  remaining := _limit - _total - 1;
  granted := true;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_bsr_api_quota(int, text, int) TO service_role;

-- ============================================================================
-- 3. 結算 RPC：把 reservation 轉為正式 usage 計數
-- ============================================================================
CREATE OR REPLACE FUNCTION public.settle_bsr_reservation(
  _reservation_id bigint,
  _success boolean DEFAULT true,
  _rate_limited boolean DEFAULT false
)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _api text;
  _bucket timestamptz := date_trunc('minute', now());
BEGIN
  UPDATE public.tw_bsr_api_reservations
     SET settled_at = now(),
         success = _success,
         rate_limited = _rate_limited
   WHERE id = _reservation_id
     AND settled_at IS NULL
     AND released = false
   RETURNING api_name INTO _api;

  IF _api IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.tw_bsr_api_usage (
    bucket_start, api_name, call_count, success_count, error_count, rate_limited_count
  ) VALUES (
    _bucket, _api, 1,
    CASE WHEN _success THEN 1 ELSE 0 END,
    CASE WHEN _success THEN 0 ELSE 1 END,
    CASE WHEN _rate_limited THEN 1 ELSE 0 END
  )
  ON CONFLICT (bucket_start, api_name) DO UPDATE SET
    call_count = tw_bsr_api_usage.call_count + 1,
    success_count = tw_bsr_api_usage.success_count + CASE WHEN _success THEN 1 ELSE 0 END,
    error_count = tw_bsr_api_usage.error_count + CASE WHEN _success THEN 0 ELSE 1 END,
    rate_limited_count = tw_bsr_api_usage.rate_limited_count + CASE WHEN _rate_limited THEN 1 ELSE 0 END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_bsr_reservation(bigint, boolean, boolean) TO service_role;

-- ============================================================================
-- 4. 釋放（未使用時）RPC：僅釋放，不計入 usage
-- ============================================================================
CREATE OR REPLACE FUNCTION public.release_bsr_reservation(_reservation_id bigint)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.tw_bsr_api_reservations
     SET released = true, settled_at = now()
   WHERE id = _reservation_id
     AND settled_at IS NULL
     AND released = false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_bsr_reservation(bigint) TO service_role;

-- ============================================================================
-- 5. 定期清理 RPC（可掛 cron）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.purge_expired_bsr_reservations(_api text DEFAULT 'finmind')
RETURNS int LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _n int;
BEGIN
  UPDATE public.tw_bsr_api_reservations
     SET released = true, settled_at = now()
   WHERE api_name = _api
     AND settled_at IS NULL
     AND released = false
     AND expires_at < now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  -- 超過 24 小時的舊資料刪掉
  DELETE FROM public.tw_bsr_api_reservations
   WHERE reserved_at < now() - interval '24 hours';
  RETURN _n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_expired_bsr_reservations(text) TO service_role;

-- ============================================================================
-- 6. 讓 check_bsr_rate_limit 也反映 in-flight reservation
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_bsr_rate_limit(
  _limit int DEFAULT 1500,
  _api text DEFAULT 'finmind'
)
RETURNS TABLE (used int, remaining int, allowed boolean)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  _usage int;
  _active_res int;
  _total int;
BEGIN
  SELECT COALESCE(SUM(call_count), 0)::int INTO _usage
    FROM public.tw_bsr_api_usage
   WHERE api_name = _api
     AND bucket_start >= now() - interval '60 minutes';

  SELECT COUNT(*)::int INTO _active_res
    FROM public.tw_bsr_api_reservations
   WHERE api_name = _api
     AND settled_at IS NULL
     AND released = false
     AND reserved_at >= now() - interval '60 minutes'
     AND expires_at >= now();

  _total := _usage + _active_res;
  used := _total;
  remaining := GREATEST(0, _limit - _total);
  allowed := _total < _limit;
  RETURN NEXT;
END;
$$;
