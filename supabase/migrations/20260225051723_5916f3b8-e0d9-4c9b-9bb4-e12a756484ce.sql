
-- Create a security definer function to check subscription without triggering RLS recursion
CREATE OR REPLACE FUNCTION public.is_subscribed_to_plan(_user_id uuid, _plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.member_subscriptions
    WHERE user_id = _user_id
      AND plan_id = _plan_id
      AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION public.has_active_subscription(_user_id uuid)
RETURNS TABLE(plan_id uuid, expert_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ms.plan_id, ep.expert_id
  FROM public.member_subscriptions ms
  JOIN public.expert_plans ep ON ep.id = ms.plan_id
  WHERE ms.user_id = _user_id
    AND ms.status = 'active'
$$;

-- Drop old recursive policies
DROP POLICY IF EXISTS "Subscribers can view signals for subscribed plans" ON public.expert_signals;
DROP POLICY IF EXISTS "Subscribers can view subscribed experts" ON public.experts;
DROP POLICY IF EXISTS "Subscribers can view subscribed plans" ON public.expert_plans;

-- Recreate with security definer functions (no recursion)
CREATE POLICY "Subscribers can view signals for subscribed plans"
ON public.expert_signals
FOR SELECT
TO authenticated
USING (
  status = 'published'
  AND public.is_subscribed_to_plan(auth.uid(), plan_id)
);

CREATE POLICY "Subscribers can view subscribed experts"
ON public.experts
FOR SELECT
TO authenticated
USING (
  id IN (SELECT expert_id FROM public.has_active_subscription(auth.uid()))
);

CREATE POLICY "Subscribers can view subscribed plans"
ON public.expert_plans
FOR SELECT
TO authenticated
USING (
  public.is_subscribed_to_plan(auth.uid(), id)
);
