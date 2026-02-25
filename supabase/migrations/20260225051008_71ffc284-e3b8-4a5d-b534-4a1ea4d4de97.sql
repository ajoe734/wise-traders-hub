
-- Drop the restrictive subscriber policies
DROP POLICY IF EXISTS "Subscribers can view signals for subscribed plans" ON public.expert_signals;
DROP POLICY IF EXISTS "Subscribers can view subscribed experts" ON public.experts;
DROP POLICY IF EXISTS "Subscribers can view subscribed plans" ON public.expert_plans;

-- Recreate as PERMISSIVE policies
CREATE POLICY "Subscribers can view signals for subscribed plans"
ON public.expert_signals
FOR SELECT
TO authenticated
USING (
  status = 'published'
  AND plan_id IN (
    SELECT ms.plan_id FROM public.member_subscriptions ms
    WHERE ms.user_id = auth.uid()
      AND ms.status = 'active'
  )
);

CREATE POLICY "Subscribers can view subscribed experts"
ON public.experts
FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT ep.expert_id FROM public.expert_plans ep
    JOIN public.member_subscriptions ms ON ms.plan_id = ep.id
    WHERE ms.user_id = auth.uid()
      AND ms.status = 'active'
  )
);

CREATE POLICY "Subscribers can view subscribed plans"
ON public.expert_plans
FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT ms.plan_id FROM public.member_subscriptions ms
    WHERE ms.user_id = auth.uid()
      AND ms.status = 'active'
  )
);
