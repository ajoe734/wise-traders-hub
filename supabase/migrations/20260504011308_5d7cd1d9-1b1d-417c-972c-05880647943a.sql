
-- Remove the row policy that still allowed analysts to query line_user_id directly
DROP POLICY IF EXISTS "Analysts read subscriber profiles via view" ON public.profiles;

-- Recreate the safe view as SECURITY DEFINER (default, security_invoker=false)
-- so analysts can read subscriber display names without needing direct RLS on profiles.
DROP VIEW IF EXISTS public.profiles_analyst_subscribers;

CREATE VIEW public.profiles_analyst_subscribers AS
SELECT p.user_id, p.display_name, p.avatar_url
FROM public.profiles p
WHERE p.user_id IN (
  SELECT ms.user_id
  FROM public.member_subscriptions ms
  JOIN public.expert_plans ep ON ep.id = ms.plan_id
  JOIN public.experts e ON e.id = ep.expert_id
  WHERE e.user_id = auth.uid()
);

GRANT SELECT ON public.profiles_analyst_subscribers TO authenticated;
