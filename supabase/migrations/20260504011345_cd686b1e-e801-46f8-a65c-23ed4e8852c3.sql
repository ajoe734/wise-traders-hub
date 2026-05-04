
DROP VIEW IF EXISTS public.profiles_analyst_subscribers;

CREATE OR REPLACE FUNCTION public.get_analyst_subscriber_profiles()
RETURNS TABLE(user_id uuid, display_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.display_name, p.avatar_url
  FROM public.profiles p
  WHERE p.user_id IN (
    SELECT ms.user_id
    FROM public.member_subscriptions ms
    JOIN public.expert_plans ep ON ep.id = ms.plan_id
    JOIN public.experts e ON e.id = ep.expert_id
    WHERE e.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.get_analyst_subscriber_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analyst_subscriber_profiles() TO authenticated;
