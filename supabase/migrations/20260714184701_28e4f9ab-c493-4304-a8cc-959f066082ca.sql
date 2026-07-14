CREATE OR REPLACE FUNCTION public.get_user_subscription_timeline(_user_id uuid, _expert_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF v_caller <> _user_id AND NOT public.has_role(v_caller, 'company_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.expert_name)
    FROM (
      SELECT
        e.id AS expert_id,
        e.name AS expert_name,
        e.slug AS expert_slug,
        e.avatar_url AS expert_avatar_url,
        e.role AS expert_role,
        EXISTS (
          SELECT 1
          FROM public.member_subscriptions ms2
          JOIN public.expert_plans ep2 ON ep2.id = ms2.plan_id
          WHERE ms2.user_id = _user_id
            AND ep2.expert_id = e.id
            AND ms2.status = 'active'
            AND (ms2.expires_at IS NULL OR ms2.expires_at > now())
        ) AS has_active_now,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'id', ms.id,
            'plan_name', ep.name,
            'started_at', ms.started_at,
            'expires_at', ms.expires_at,
            'status', ms.status,
            'canceled_at', ms.canceled_at,
            'is_currently_active', (ms.status = 'active' AND (ms.expires_at IS NULL OR ms.expires_at > now()))
          ) ORDER BY ms.started_at)
          FROM public.member_subscriptions ms
          JOIN public.expert_plans ep ON ep.id = ms.plan_id
          WHERE ms.user_id = _user_id
            AND ep.expert_id = e.id
        ) AS segments
      FROM public.experts e
      WHERE e.role = 'mentor'
        AND (_expert_id IS NULL OR e.id = _expert_id)
        AND EXISTS (
          SELECT 1
          FROM public.member_subscriptions ms
          JOIN public.expert_plans ep ON ep.id = ms.plan_id
          WHERE ms.user_id = _user_id
            AND ep.expert_id = e.id
        )
    ) t
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_subscription_timeline(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_subscription_timeline(uuid, uuid) TO authenticated, service_role;