
-- 1) 排程 purge_expired_bsr_reservations 每 5 分鐘執行，回收過期未結算的 reservation
--    避免 worker crash / timeout 造成額度被永久占用。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tw-bsr-purge-expired-reservations') THEN
    PERFORM cron.unschedule('tw-bsr-purge-expired-reservations');
  END IF;
END $$;

SELECT cron.schedule(
  'tw-bsr-purge-expired-reservations',
  '*/5 * * * *',
  $$SELECT public.purge_expired_bsr_reservations('finmind');$$
);

-- 2) 監控用 helper：一次回傳 in-flight / 即將到期 / 24h 已結算統計
CREATE OR REPLACE FUNCTION public.bsr_reservation_stats(_api text DEFAULT 'finmind')
RETURNS TABLE(
  in_flight int,
  expiring_soon int,
  expired_unsettled int,
  settled_last_hour int,
  rate_limited_last_hour int,
  oldest_in_flight_age_seconds int
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    (SELECT count(*)::int FROM public.tw_bsr_api_reservations
       WHERE api_name = _api AND settled_at IS NULL AND released = false
         AND expires_at > now()) AS in_flight,
    (SELECT count(*)::int FROM public.tw_bsr_api_reservations
       WHERE api_name = _api AND settled_at IS NULL AND released = false
         AND expires_at > now() AND expires_at <= now() + interval '10 seconds') AS expiring_soon,
    (SELECT count(*)::int FROM public.tw_bsr_api_reservations
       WHERE api_name = _api AND settled_at IS NULL AND released = false
         AND expires_at <= now()) AS expired_unsettled,
    (SELECT count(*)::int FROM public.tw_bsr_api_reservations
       WHERE api_name = _api AND settled_at IS NOT NULL
         AND settled_at >= now() - interval '1 hour') AS settled_last_hour,
    (SELECT COALESCE(sum(rate_limited_count),0)::int FROM public.tw_bsr_api_usage
       WHERE api_name = _api AND bucket_start >= now() - interval '1 hour') AS rate_limited_last_hour,
    (SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(reserved_at)))::int, 0)
       FROM public.tw_bsr_api_reservations
      WHERE api_name = _api AND settled_at IS NULL AND released = false
        AND expires_at > now()) AS oldest_in_flight_age_seconds;
$$;

GRANT EXECUTE ON FUNCTION public.bsr_reservation_stats(text) TO authenticated, service_role;
