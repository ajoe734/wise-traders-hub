-- Drop the old plan-specific policy
DROP POLICY "Subscribers can view signals for subscribed plans" ON public.expert_signals;

-- Create new policy: subscribers see ALL signals from their subscribed experts
CREATE POLICY "Subscribers can view signals from subscribed experts"
ON public.expert_signals
FOR SELECT
USING (
  status = 'published'::signal_status
  AND expert_id IN (
    SELECT has_active_subscription.expert_id
    FROM has_active_subscription(auth.uid()) has_active_subscription(plan_id, expert_id)
  )
);