
-- 1. Remove Realtime publication for sensitive tables
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_performances'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.user_performances;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_summaries'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.user_summaries;
  END IF;
END $$;

-- 2. audit_logs: remove client INSERT
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_logs;

-- 3. LINE user_id masking: analyst-safe view
CREATE OR REPLACE VIEW public.member_line_bindings_analyst
WITH (security_invoker = true) AS
SELECT id, user_id, expert_id, display_name, is_active, bound_at
FROM public.member_line_bindings;

-- Replace analyst policy: remove direct base table access, force view usage
DROP POLICY IF EXISTS "Analysts can view own expert line bindings" ON public.member_line_bindings;

CREATE POLICY "Analysts can view own expert line bindings"
ON public.member_line_bindings
FOR SELECT
TO authenticated
USING (expert_id IN (
  SELECT id FROM public.experts WHERE user_id = auth.uid()
));
