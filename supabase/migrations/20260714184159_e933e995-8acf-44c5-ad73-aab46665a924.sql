CREATE OR REPLACE FUNCTION public.has_active_subscription_after(_user_id uuid, _published_at timestamp with time zone)
 RETURNS TABLE(expert_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ep.expert_id
  FROM public.member_subscriptions ms
  JOIN public.expert_plans ep ON ep.id = ms.plan_id
  JOIN public.experts e ON e.id = ep.expert_id
  WHERE ms.user_id = _user_id
    -- signal 發布時，落在該筆訂閱的可視期間內（含 mentor 7 天回溯規則）
    AND CASE
      WHEN e.role = 'mentor' THEN
        (_published_at + INTERVAL '7 days') >= ms.started_at
        AND (ms.expires_at IS NULL OR _published_at <= ms.expires_at)
      ELSE
        _published_at >= ms.started_at
        AND (ms.expires_at IS NULL OR _published_at <= ms.expires_at)
    END
    -- 且該使用者目前對此老師仍有 active 訂閱（付費牆：斷約後失去存取，續訂即解鎖歷史）
    AND EXISTS (
      SELECT 1
      FROM public.member_subscriptions ms2
      JOIN public.expert_plans ep2 ON ep2.id = ms2.plan_id
      WHERE ms2.user_id = _user_id
        AND ep2.expert_id = ep.expert_id
        AND ms2.status = 'active'
        AND (ms2.expires_at IS NULL OR ms2.expires_at > now())
    )
$function$;