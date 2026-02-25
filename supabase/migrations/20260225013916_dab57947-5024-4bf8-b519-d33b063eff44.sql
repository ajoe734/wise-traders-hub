
-- Fix: restrict audit_logs insert to authenticated users with a real actor_id
DROP POLICY "System can insert audit logs" ON public.audit_logs;

CREATE POLICY "Authenticated users can insert audit logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());
