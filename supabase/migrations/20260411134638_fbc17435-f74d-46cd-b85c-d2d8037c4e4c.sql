
-- Drop the dependent RLS policy first
DROP POLICY IF EXISTS "Anyone can view active approved plans" ON public.expert_plans;

-- Remove review columns
ALTER TABLE public.expert_plans DROP COLUMN IF EXISTS review_status;
ALTER TABLE public.expert_plans DROP COLUMN IF EXISTS review_note;
ALTER TABLE public.expert_plans DROP COLUMN IF EXISTS reviewed_by;
ALTER TABLE public.expert_plans DROP COLUMN IF EXISTS reviewed_at;

-- Drop the enum type
DROP TYPE IF EXISTS public.review_status;

-- Re-create simplified public access policy
CREATE POLICY "Anyone can view active plans"
ON public.expert_plans
FOR SELECT
USING (is_active = true);
