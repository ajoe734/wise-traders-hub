
-- Drop the old subscription policy
DROP POLICY IF EXISTS "Subscribers can view subscribed experts" ON public.experts;

-- Recreate with status check: subscribers can only see active experts (or all if tester)
CREATE POLICY "Subscribers can view subscribed experts"
ON public.experts
FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT has_active_subscription.expert_id
    FROM has_active_subscription(auth.uid()) has_active_subscription(plan_id, expert_id)
  )
  AND (status = 'active' OR is_tester(auth.uid()))
);
