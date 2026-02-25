DROP POLICY IF EXISTS "Subscribers can view signals for subscribed plans" ON public.expert_signals;

CREATE POLICY "Subscribers can view signals for subscribed plans"
ON public.expert_signals
FOR SELECT
TO authenticated
USING (
  status = 'published'
  AND (
    (
      plan_id IS NOT NULL
      AND public.is_subscribed_to_plan(auth.uid(), plan_id)
    )
    OR (
      plan_id IS NULL
      AND expert_id IN (
        SELECT expert_id FROM public.has_active_subscription(auth.uid())
      )
    )
  )
);