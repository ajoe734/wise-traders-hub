DROP POLICY "Authenticated can insert notifications" ON public.notifications;

CREATE POLICY "System can insert notifications"
ON public.notifications FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'company_admin') OR
  user_id = auth.uid()
);
