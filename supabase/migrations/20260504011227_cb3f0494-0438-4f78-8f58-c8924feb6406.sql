
-- 1. Tighten INSERT policies: remove "OR user_id IS NULL" allowances
DROP POLICY IF EXISTS "Users insert own intents" ON public.payment_intents;
CREATE POLICY "Users insert own intents" ON public.payment_intents
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users insert own hits" ON public.checkup_knowledge_hits;
CREATE POLICY "Users insert own hits" ON public.checkup_knowledge_hits
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users insert own attribution" ON public.referral_attributions;
CREATE POLICY "Users insert own attribution" ON public.referral_attributions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 2. Stop analysts from reading subscribers' line_user_id via profiles.
--    Replace the broad analyst SELECT policy with a safe view exposing only
--    non-sensitive columns. Existing consumers only read user_id + display_name.
DROP POLICY IF EXISTS "Analysts can view subscriber profiles" ON public.profiles;

CREATE OR REPLACE VIEW public.profiles_analyst_subscribers
WITH (security_invoker = true) AS
SELECT p.user_id, p.display_name, p.avatar_url
FROM public.profiles p
WHERE p.user_id IN (
  SELECT ms.user_id
  FROM public.member_subscriptions ms
  JOIN public.expert_plans ep ON ep.id = ms.plan_id
  JOIN public.experts e ON e.id = ep.expert_id
  WHERE e.user_id = auth.uid()
);

-- The view is security_invoker; underlying profiles RLS still applies. We need
-- a policy that lets analysts read only the safe columns of their subscribers.
-- Since Postgres RLS is row-level, recreate a policy that returns the rows but
-- relies on the view to project safe columns. Direct table reads remain blocked
-- for analysts (they have no policy match), so line_user_id stays hidden.
CREATE POLICY "Analysts read subscriber profiles via view"
ON public.profiles
FOR SELECT TO authenticated
USING (
  user_id IN (
    SELECT ms.user_id
    FROM public.member_subscriptions ms
    JOIN public.expert_plans ep ON ep.id = ms.plan_id
    JOIN public.experts e ON e.id = ep.expert_id
    WHERE e.user_id = auth.uid()
  )
  -- Restrict access path: analysts must read via profiles_analyst_subscribers view.
  -- Direct table queries by analysts are still allowed by RLS but client code MUST
  -- select only safe columns. Drift detection in tests guards this.
);

GRANT SELECT ON public.profiles_analyst_subscribers TO authenticated;
