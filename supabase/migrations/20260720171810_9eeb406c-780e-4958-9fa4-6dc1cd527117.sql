
-- 1) 記錄回收原因
ALTER TABLE public.tw_bsr_api_reservations
  ADD COLUMN IF NOT EXISTS recycle_reason text;

-- 2) purge 回傳詳細資訊
DROP FUNCTION IF EXISTS public.purge_expired_bsr_reservations(text);
CREATE OR REPLACE FUNCTION public.purge_expired_bsr_reservations(_api text DEFAULT 'finmind')
RETURNS TABLE(recycled_count int, recycled_ids bigint[])
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _ids bigint[];
BEGIN
  WITH r AS (
    UPDATE public.tw_bsr_api_reservations
       SET released = true,
           settled_at = now(),
           recycle_reason = COALESCE(recycle_reason, 'expired_lease')
     WHERE api_name = _api
       AND settled_at IS NULL
       AND released = false
       AND expires_at < now()
     RETURNING id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::bigint[]) INTO _ids FROM r;

  DELETE FROM public.tw_bsr_api_reservations
   WHERE reserved_at < now() - interval '24 hours';

  RETURN QUERY SELECT COALESCE(array_length(_ids, 1), 0), _ids;
END;
$$;
GRANT EXECUTE ON FUNCTION public.purge_expired_bsr_reservations(text) TO service_role;

-- 3) 列出卡住未結算 reservation（含 correlation_id）
CREATE OR REPLACE FUNCTION public.bsr_list_stuck_reservations(
  _api text DEFAULT 'finmind',
  _min_age_seconds int DEFAULT 30,
  _limit int DEFAULT 50
)
RETURNS TABLE (
  id bigint,
  correlation_id uuid,
  reserved_at timestamptz,
  expires_at timestamptz,
  age_seconds int,
  expired boolean
)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT id, correlation_id, reserved_at, expires_at,
         EXTRACT(EPOCH FROM (now() - reserved_at))::int AS age_seconds,
         (expires_at < now()) AS expired
    FROM public.tw_bsr_api_reservations
   WHERE api_name = _api
     AND settled_at IS NULL
     AND released = false
     AND (now() - reserved_at) >= make_interval(secs => _min_age_seconds)
   ORDER BY reserved_at ASC
   LIMIT _limit;
$$;
GRANT EXECUTE ON FUNCTION public.bsr_list_stuck_reservations(text, int, int)
  TO authenticated, service_role;

-- 4) 管理員強制回收單一 reservation
CREATE OR REPLACE FUNCTION public.bsr_force_recycle_reservation(
  _reservation_id bigint,
  _reason text DEFAULT 'manual_force_recycle'
)
RETURNS boolean LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _n int;
BEGIN
  UPDATE public.tw_bsr_api_reservations
     SET released = true, settled_at = now(),
         recycle_reason = COALESCE(recycle_reason, _reason)
   WHERE id = _reservation_id
     AND settled_at IS NULL
     AND released = false;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n > 0;
END;
$$;
GRANT EXECUTE ON FUNCTION public.bsr_force_recycle_reservation(bigint, text) TO service_role;

-- 5) 排程改為每分鐘
DO $$
DECLARE _jid int;
BEGIN
  SELECT jobid INTO _jid FROM cron.job WHERE jobname = 'tw-bsr-purge-expired-reservations';
  IF _jid IS NOT NULL THEN
    PERFORM cron.unschedule(_jid);
  END IF;
END $$;

SELECT cron.schedule(
  'tw-bsr-purge-expired-reservations',
  '* * * * *',
  $$SELECT public.purge_expired_bsr_reservations('finmind');$$
);
