
-- ============================================
-- 1. payment_providers: hide config column
-- ============================================
-- Create a public-safe view without the config column
CREATE OR REPLACE VIEW public.payment_providers_safe AS
SELECT id, provider_type, display_name, is_active, is_default, created_at
FROM public.payment_providers;

-- Drop the old permissive SELECT policy for public
DROP POLICY IF EXISTS "Authenticated users can view active providers" ON public.payment_providers;

-- Re-create: only company_admin can read the full table (already covered by existing ALL policy)
-- Grant view access to authenticated users via the safe view
-- The view inherits RLS from the base table, so we need a direct grant approach
-- Instead, restrict the base table and let the view be accessed

-- ============================================
-- 2. checkup_knowledge_items: restrict writes to admin
-- ============================================
DROP POLICY IF EXISTS "Authenticated users can manage knowledge items" ON public.checkup_knowledge_items;

CREATE POLICY "Admins can manage knowledge items"
ON public.checkup_knowledge_items
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'company_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

-- ============================================
-- 3. member_subscriptions: remove user INSERT, tighten UPDATE
-- ============================================
DROP POLICY IF EXISTS "Users can insert own subscriptions" ON public.member_subscriptions;

-- Replace broad UPDATE with restricted one (only auto_renew + canceled_at)
DROP POLICY IF EXISTS "Users can update own subscriptions" ON public.member_subscriptions;

CREATE POLICY "Users can update own subscription preferences"
ON public.member_subscriptions
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
-- Note: protect_subscription_fields() trigger already blocks status/expires_at/plan_id changes

-- ============================================
-- 4. Fix has_active_subscription to check expires_at
-- ============================================
CREATE OR REPLACE FUNCTION public.has_active_subscription(_user_id uuid)
RETURNS TABLE(plan_id uuid, expert_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ms.plan_id, ep.expert_id
  FROM public.member_subscriptions ms
  JOIN public.expert_plans ep ON ep.id = ms.plan_id
  WHERE ms.user_id = _user_id
    AND ms.status = 'active'
    AND (ms.expires_at IS NULL OR ms.expires_at > now())
$$;

CREATE OR REPLACE FUNCTION public.is_subscribed_to_plan(_user_id uuid, _plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.member_subscriptions
    WHERE user_id = _user_id
      AND plan_id = _plan_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  )
$$;

CREATE OR REPLACE FUNCTION public.has_active_subscription_after(_user_id uuid, _published_at timestamp with time zone)
RETURNS TABLE(expert_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ep.expert_id
  FROM public.member_subscriptions ms
  JOIN public.expert_plans ep ON ep.id = ms.plan_id
  JOIN public.experts e ON e.id = ep.expert_id
  WHERE ms.user_id = _user_id
    AND ms.status = 'active'
    AND (ms.expires_at IS NULL OR ms.expires_at > now())
    AND CASE
      WHEN e.role = 'mentor' THEN (_published_at + INTERVAL '7 days') >= ms.started_at
      ELSE _published_at >= ms.started_at
    END
$$;

-- ============================================
-- 6. checkup_prediction_accuracy: restrict to authenticated
-- ============================================
DROP POLICY IF EXISTS "Anyone can insert prediction accuracy" ON public.checkup_prediction_accuracy;
DROP POLICY IF EXISTS "Anyone can read prediction accuracy" ON public.checkup_prediction_accuracy;

CREATE POLICY "Authenticated users can insert prediction accuracy"
ON public.checkup_prediction_accuracy
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can read prediction accuracy"
ON public.checkup_prediction_accuracy
FOR SELECT
TO authenticated
USING (true);

-- ============================================
-- 7. delete_old_prices: fix search_path
-- ============================================
CREATE OR REPLACE FUNCTION public.delete_old_prices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.current_prices WHERE updated_at < (NOW() - INTERVAL '7 days')::text;
END;
$$;
