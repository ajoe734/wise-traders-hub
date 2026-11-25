CREATE OR REPLACE FUNCTION public.get_publish_batch_status()
 RETURNS TABLE(expert_id uuid, expert_name text, expert_slug text, market text, asset_class text, pending_count integer, published_this_week integer, failed_pending_count integer, last_attempt_at timestamp with time zone, last_error_kind text, last_error_msg text, last_error_signal_id uuid, last_run_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(),'company_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH us_classes AS (
    SELECT unnest(ARRAY['us_stock','us_futures','crypto']) AS c
  ),
  base AS (
    SELECT e.id, e.name, e.slug AS b_slug, e.asset_class AS b_class,
           CASE WHEN lower(e.asset_class) IN (SELECT c FROM us_classes)
                THEN 'US' ELSE 'TW' END AS mk
    FROM public.experts e
  ),
  sig_stats AS (
    SELECT s.expert_id AS eid,
           count(*) FILTER (WHERE s.status='pending')::int AS p_cnt,
           count(*) FILTER (WHERE s.status='published' AND s.published_at >= now() - interval '7 days')::int AS w_cnt
    FROM public.expert_signals s
    WHERE s.status='pending' OR s.published_at >= now() - interval '14 days'
    GROUP BY s.expert_id
  ),
  err_logs AS (
    SELECT l.expert_id AS eid, l.signal_id AS sid, l.msg AS m, l.run_id AS rid, l.created_at AS ts,
           l.payload->>'kind' AS kind
    FROM public.function_run_logs l
    WHERE l.fn='publish-weekly-journals'
      AND l.stage='mark_published_iter'
      AND l.level='error'
      AND l.expert_id IS NOT NULL
      AND l.created_at >= now() - interval '14 days'
  ),
  latest_err AS (
    SELECT DISTINCT ON (el.eid) el.eid, el.ts, el.kind, el.m, el.sid, el.rid
    FROM err_logs el
    ORDER BY el.eid, el.ts DESC
  ),
  failed_pending AS (
    SELECT el.eid, count(DISTINCT el.sid)::int AS cnt
    FROM err_logs el
    JOIN public.expert_signals s ON s.id = el.sid AND s.status='pending'
    GROUP BY el.eid
  )
  SELECT b.id, b.name, b.b_slug, b.mk, b.b_class,
         COALESCE(ss.p_cnt,0), COALESCE(ss.w_cnt,0), COALESCE(fp.cnt,0),
         le.ts, le.kind, le.m, le.sid, le.rid
  FROM base b
  LEFT JOIN sig_stats ss ON ss.eid = b.id
  LEFT JOIN latest_err le ON le.eid = b.id
  LEFT JOIN failed_pending fp ON fp.eid = b.id
  WHERE COALESCE(ss.p_cnt,0) > 0 OR COALESCE(ss.w_cnt,0) > 0 OR le.ts IS NOT NULL
  ORDER BY b.mk, b.name;
END $function$;
REVOKE EXECUTE ON FUNCTION public.get_publish_batch_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_publish_batch_status() TO authenticated, service_role;