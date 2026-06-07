
CREATE OR REPLACE FUNCTION public.perf_metrics_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count integer;
BEGIN
  -- 1) session_id 維度：60 秒內同 session 最多 20 筆
  IF NEW.session_id IS NOT NULL THEN
    SELECT count(*) INTO recent_count
    FROM public.perf_metrics
    WHERE session_id = NEW.session_id
      AND created_at > now() - interval '60 seconds';
    IF recent_count >= 20 THEN
      RETURN NULL; -- 靜默丟棄，不噴錯
    END IF;
  END IF;

  -- 2) user_id 維度：60 秒內同 user 最多 60 筆
  IF NEW.user_id IS NOT NULL THEN
    SELECT count(*) INTO recent_count
    FROM public.perf_metrics
    WHERE user_id = NEW.user_id
      AND created_at > now() - interval '60 seconds';
    IF recent_count >= 60 THEN
      RETURN NULL;
    END IF;
  END IF;

  -- 3) 完全匿名 (無 session_id、無 user_id)：60 秒內同 route 全域最多 100 筆
  IF NEW.session_id IS NULL AND NEW.user_id IS NULL THEN
    SELECT count(*) INTO recent_count
    FROM public.perf_metrics
    WHERE route = NEW.route
      AND session_id IS NULL
      AND user_id IS NULL
      AND created_at > now() - interval '60 seconds';
    IF recent_count >= 100 THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_perf_metrics_rate_limit ON public.perf_metrics;
CREATE TRIGGER trg_perf_metrics_rate_limit
  BEFORE INSERT ON public.perf_metrics
  FOR EACH ROW
  EXECUTE FUNCTION public.perf_metrics_rate_limit();

REVOKE EXECUTE ON FUNCTION public.perf_metrics_rate_limit() FROM PUBLIC, anon, authenticated;
