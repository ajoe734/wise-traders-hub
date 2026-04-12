
CREATE POLICY "Company admins can insert audit logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role) AND actor_id = auth.uid());
