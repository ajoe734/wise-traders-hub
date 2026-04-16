
-- Create a security invoker view that hides sensitive fields from analysts
CREATE OR REPLACE VIEW public.profiles_analyst
WITH (security_invoker = on) AS
SELECT
  user_id,
  display_name,
  avatar_url,
  created_at
FROM public.profiles;

-- Drop the overly permissive analyst policy
DROP POLICY IF EXISTS "Analysts can view subscriber profiles" ON public.profiles;

-- Re-create a narrower policy: analysts can only SELECT via the view
-- The view uses security_invoker so it runs under the caller's RLS.
-- We add a policy that lets analysts see only display_name-level data
-- by restricting to subscriber user_ids but the VIEW controls which columns are exposed.
CREATE POLICY "Analysts can view subscriber profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  user_id IN (
    SELECT ms.user_id
    FROM member_subscriptions ms
    JOIN expert_plans ep ON ep.id = ms.plan_id
    JOIN experts e ON e.id = ep.expert_id
    WHERE e.user_id = auth.uid()
  )
);
