CREATE OR REPLACE FUNCTION public.get_ig_conversion_report(_since date, _until date)
RETURNS TABLE(date date, utm_source text, utm_medium text, utm_campaign text, visitors bigint, signups bigint, purchases bigint, revenue bigint, holdings_board_conversions bigint, event_signups bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '30s'
AS $$
DECLARE _from timestamptz; _to timestamptz;
BEGIN
  IF _since IS NULL OR _until IS NULL OR _until < _since OR _until - _since > 30 THEN RAISE EXCEPTION 'invalid range'; END IF;
  _from := (_since::timestamp AT TIME ZONE 'Asia/Taipei');
  _to := ((_until + 1)::timestamp AT TIME ZONE 'Asia/Taipei');
  RETURN QUERY
  WITH v AS (
    SELECT (t.first_seen_at AT TIME ZONE 'Asia/Taipei')::date d, t.utm_source s0, t.utm_medium m0, t.utm_campaign c0, t.visitor_id vid
    FROM traffic_visits t WHERE t.first_seen_at >= _from AND t.first_seen_at < _to
  ), vg AS (SELECT d, s0, m0, c0, count(DISTINCT vid) n FROM v GROUP BY 1,2,3,4
  ), u AS (SELECT au.id, (au.created_at AT TIME ZONE 'Asia/Taipei')::date d FROM auth.users au WHERE au.created_at >= _from AND au.created_at < _to
  ), ua AS (
    SELECT u.d, coalesce(ra.utm_source, tv.utm_source) s0, coalesce(ra.utm_medium, tv.utm_medium) m0, coalesce(ra.utm_campaign, tv.utm_campaign) c0
    FROM u
    LEFT JOIN LATERAL (SELECT r.utm_source, r.utm_medium, r.utm_campaign, r.utm_content FROM referral_attributions r WHERE r.user_id=u.id ORDER BY coalesce(r.first_touch_at, r.created_at) LIMIT 1) ra ON true
    LEFT JOIN LATERAL (SELECT x.utm_source, x.utm_medium, x.utm_campaign FROM traffic_visits x WHERE x.user_id=u.id AND x.utm_source IS NOT NULL ORDER BY x.first_seen_at LIMIT 1) tv
      ON ra.utm_medium IS NULL AND ra.utm_campaign IS NULL AND ra.utm_content IS NULL
  ), sg AS (SELECT d, s0, m0, c0, count(*) n FROM ua GROUP BY 1,2,3,4
  ), pg AS (
    SELECT (cv.occurred_at AT TIME ZONE 'Asia/Taipei')::date d, cv.utm_source s0, cv.utm_medium m0, cv.utm_campaign c0,
           count(*) n, coalesce(sum(cv.gross_amount),0)::bigint g, count(*) FILTER (WHERE cv.order_kind='checkup_sub') hb
    FROM conversions cv WHERE cv.occurred_at >= _from AND cv.occurred_at < _to GROUP BY 1,2,3,4
  ), lg AS (
    SELECT (e.created_at AT TIME ZONE 'Asia/Taipei')::date d, e.utm_source s0, e.utm_medium m0, e.utm_campaign c0, count(*) n
    FROM event_registrations e WHERE e.created_at >= _from AND e.created_at < _to GROUP BY 1,2,3,4
  ), allrows AS (
    SELECT d, s0, m0, c0, n vis, 0::bigint sig, 0::bigint pur, 0::bigint rev, 0::bigint hb, 0::bigint ev FROM vg
    UNION ALL SELECT d, s0, m0, c0, 0, n, 0, 0, 0, 0 FROM sg
    UNION ALL SELECT d, s0, m0, c0, 0, 0, n, g, hb, 0 FROM pg
    UNION ALL SELECT d, s0, m0, c0, 0, 0, 0, 0, 0, n FROM lg
  ), norm AS (
    SELECT d,
      CASE WHEN nullif(s0,'') IS NULL OR s0='direct' THEN '(direct)' ELSE s0 END s,
      CASE WHEN nullif(m0,'') IS NULL OR m0='direct' THEN '(direct)' ELSE m0 END m,
      CASE WHEN nullif(c0,'') IS NULL OR c0='direct' THEN '(direct)' ELSE c0 END c,
      vis, sig, pur, rev, hb, ev FROM allrows
  )
  SELECT d, s, m, c, sum(vis)::bigint, sum(sig)::bigint, sum(pur)::bigint, sum(rev)::bigint, sum(hb)::bigint, sum(ev)::bigint
  FROM norm GROUP BY d, s, m, c ORDER BY d, sum(rev) DESC, sum(vis) DESC;
END; $$;
REVOKE ALL ON FUNCTION public.get_ig_conversion_report(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ig_conversion_report(date, date) TO service_role;