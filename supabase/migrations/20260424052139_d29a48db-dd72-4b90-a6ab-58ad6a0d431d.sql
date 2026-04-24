-- 1. Create review_status enum
DO $$ BEGIN
  CREATE TYPE public.plan_review_status AS ENUM ('draft', 'pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Add columns to expert_plans
ALTER TABLE public.expert_plans
  ADD COLUMN IF NOT EXISTS review_status public.plan_review_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- 3. Backfill existing active plans as approved (so we don't break current frontend)
UPDATE public.expert_plans
SET review_status = 'approved', reviewed_at = now()
WHERE is_active = true AND review_status = 'draft';

-- 4. Drop old public read policy and recreate with review_status condition
DROP POLICY IF EXISTS "Anyone can view active plans" ON public.expert_plans;
CREATE POLICY "Anyone can view approved active plans"
ON public.expert_plans
FOR SELECT
TO public
USING (is_active = true AND review_status = 'approved');

-- 5. Trigger: when an analyst updates their own plan, force review_status back to pending
CREATE OR REPLACE FUNCTION public.enforce_plan_review_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin boolean;
  is_owner boolean;
BEGIN
  is_admin := has_role(auth.uid(), 'company_admin');

  -- Admins can change anything (including review_status / review_note / reviewed_by / reviewed_at)
  IF is_admin THEN
    -- Auto-fill reviewer metadata when status changes
    IF NEW.review_status IS DISTINCT FROM OLD.review_status THEN
      NEW.reviewed_by := auth.uid();
      NEW.reviewed_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- Check ownership
  SELECT EXISTS (
    SELECT 1 FROM public.experts
    WHERE id = NEW.expert_id AND user_id = auth.uid()
  ) INTO is_owner;

  IF is_owner THEN
    -- Block analyst from changing review fields directly
    NEW.review_status := 'pending';
    NEW.review_note := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_plan_review_workflow_trigger ON public.expert_plans;
CREATE TRIGGER enforce_plan_review_workflow_trigger
BEFORE UPDATE ON public.expert_plans
FOR EACH ROW
EXECUTE FUNCTION public.enforce_plan_review_workflow();

-- 6. Trigger on INSERT: new plans by analysts default to 'pending'
CREATE OR REPLACE FUNCTION public.set_plan_initial_review_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin boolean;
BEGIN
  is_admin := has_role(auth.uid(), 'company_admin');
  
  IF NOT is_admin THEN
    -- Force pending for non-admin inserts
    NEW.review_status := 'pending';
    NEW.review_note := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_plan_initial_review_status_trigger ON public.expert_plans;
CREATE TRIGGER set_plan_initial_review_status_trigger
BEFORE INSERT ON public.expert_plans
FOR EACH ROW
EXECUTE FUNCTION public.set_plan_initial_review_status();