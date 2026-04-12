
-- ============================================================
-- 1. Fix member_subscriptions RLS: restrict INSERT/UPDATE
-- ============================================================

-- Drop overly permissive policies
DROP POLICY IF EXISTS "Users can insert own subscriptions" ON public.member_subscriptions;
DROP POLICY IF EXISTS "Users can update own subscriptions" ON public.member_subscriptions;

-- Recreate INSERT: authenticated only
CREATE POLICY "Users can insert own subscriptions"
ON public.member_subscriptions
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Recreate UPDATE: authenticated only, restrict to safe columns
-- We use a WITH CHECK that ensures sensitive fields remain unchanged
CREATE POLICY "Users can update own subscriptions"
ON public.member_subscriptions
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Create a trigger to block users from modifying sensitive subscription fields
CREATE OR REPLACE FUNCTION public.protect_subscription_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow service_role (edge functions) to update anything
  -- Check if the caller has company_admin role; if so, allow all changes
  IF has_role(auth.uid(), 'company_admin') THEN
    RETURN NEW;
  END IF;

  -- For regular users, block changes to sensitive fields
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'You cannot modify subscription status';
  END IF;
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'You cannot modify subscription expiry';
  END IF;
  IF NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'You cannot modify subscription start date';
  END IF;
  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    RAISE EXCEPTION 'You cannot modify subscription plan';
  END IF;
  IF NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN
    RAISE EXCEPTION 'You cannot modify payment provider';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_subscription_fields
BEFORE UPDATE ON public.member_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.protect_subscription_fields();

-- ============================================================
-- 2. Fix profiles: prevent is_tester / expert_slug tampering
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_profile_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow company_admin to change anything
  IF has_role(auth.uid(), 'company_admin') THEN
    RETURN NEW;
  END IF;

  -- Block non-admin users from changing privileged fields
  IF NEW.is_tester IS DISTINCT FROM OLD.is_tester THEN
    RAISE EXCEPTION 'You cannot modify tester status';
  END IF;
  IF NEW.expert_slug IS DISTINCT FROM OLD.expert_slug THEN
    RAISE EXCEPTION 'You cannot modify expert slug';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_profile_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_fields();
