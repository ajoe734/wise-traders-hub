CREATE OR REPLACE FUNCTION public.admin_checkup_usage_overview()
RETURNS TABLE(
  user_id uuid,
  display_name text,
  email text,
  tier text,
  period text,
  used int,
  quota_limit int,
  remaining int,
  usage_pct numeric,
  resets_at timestamptz,
  is_near_limit boolean,
  is_exhausted boolean,
  last_used_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'Forbidden: company_admin role required';
  END IF;

  RETURN QUERY
  WITH all_users AS (
    SELECT DISTINCT cu.user_id
    FROM public.checkup_usage cu
    WHERE cu.used_at >= (date_trunc('month', (now() AT TIME ZONE 'Asia/Taipei')) AT TIME ZONE 'Asia/Taipei')
    UNION
    SELECT cs.user_id
    FROM public.checkup_subscriptions cs
    WHERE cs.status = 'active' AND (cs.expires_at IS NULL OR cs.expires_at > now())
  ),
  enriched AS (
    SELECT
      u.user_id,
      public.check_checkup_quota(u.user_id) AS q
    FROM all_users u
  )
  SELECT
    e.user_id,
    p.display_name,
    au.email::text,
    (e.q->>'tier')::text,
    (e.q->>'period')::text,
    (e.q->>'used')::int,
    (e.q->>'limit')::int,
    (e.q->>'remaining')::int,
    CASE WHEN (e.q->>'limit')::int > 0
      THEN ROUND(((e.q->>'used')::numeric / (e.q->>'limit')::numeric) * 100, 1)
      ELSE 0 END,
    (e.q->>'resets_at')::timestamptz,
    CASE WHEN (e.q->>'limit')::int > 0
      THEN ((e.q->>'used')::numeric / (e.q->>'limit')::numeric) >= 0.8
      ELSE false END,
    ((e.q->>'remaining')::int <= 0),
    (SELECT MAX(used_at) FROM public.checkup_usage WHERE checkup_usage.user_id = e.user_id)
  FROM enriched e
  LEFT JOIN public.profiles p ON p.user_id = e.user_id
  LEFT JOIN auth.users au ON au.id = e.user_id
  ORDER BY
    ((e.q->>'remaining')::int) ASC,
    CASE WHEN (e.q->>'limit')::int > 0
      THEN ((e.q->>'used')::numeric / (e.q->>'limit')::numeric)
      ELSE 0 END DESC;
END;
$$;