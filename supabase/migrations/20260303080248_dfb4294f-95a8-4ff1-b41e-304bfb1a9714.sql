
-- 1. Create a security definer function to check subscription with date filtering
CREATE OR REPLACE FUNCTION public.has_active_subscription_after(
  _user_id uuid,
  _published_at timestamptz
)
RETURNS TABLE(expert_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT ep.expert_id
  FROM public.member_subscriptions ms
  JOIN public.expert_plans ep ON ep.id = ms.plan_id
  WHERE ms.user_id = _user_id
    AND ms.status = 'active'
    AND _published_at >= ms.started_at
$$;

-- 2. Drop the old policy
DROP POLICY IF EXISTS "Subscribers can view signals from subscribed experts" ON public.expert_signals;

-- 3. Create new policy with date-based access control
CREATE POLICY "Subscribers can view signals published after subscription start"
ON public.expert_signals
FOR SELECT
USING (
  status = 'published'
  AND expert_id IN (
    SELECT has_active_subscription_after.expert_id
    FROM has_active_subscription_after(auth.uid(), published_at)
  )
);
