
-- Allow subscribers to view published signals for their subscribed plans
CREATE POLICY "Subscribers can view signals for subscribed plans"
ON public.expert_signals
FOR SELECT
USING (
  status = 'published'
  AND plan_id IN (
    SELECT ms.plan_id FROM public.member_subscriptions ms
    WHERE ms.user_id = auth.uid()
      AND ms.status = 'active'
  )
);

-- Allow subscribers to view experts they're subscribed to
CREATE POLICY "Subscribers can view subscribed experts"
ON public.experts
FOR SELECT
USING (
  id IN (
    SELECT ep.expert_id FROM public.expert_plans ep
    JOIN public.member_subscriptions ms ON ms.plan_id = ep.id
    WHERE ms.user_id = auth.uid()
      AND ms.status = 'active'
  )
);

-- Allow subscribers to view their subscribed plans
CREATE POLICY "Subscribers can view subscribed plans"
ON public.expert_plans
FOR SELECT
USING (
  id IN (
    SELECT ms.plan_id FROM public.member_subscriptions ms
    WHERE ms.user_id = auth.uid()
      AND ms.status = 'active'
  )
);
