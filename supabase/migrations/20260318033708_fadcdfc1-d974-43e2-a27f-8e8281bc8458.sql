
-- Allow company_admin to DELETE trade_records
CREATE POLICY "Company admins can delete trade records"
ON public.trade_records
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'company_admin'::app_role));

-- Allow company_admin to DELETE trade_signals
CREATE POLICY "Company admins can delete trade signals"
ON public.trade_signals
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'company_admin'::app_role));

-- Allow company_admin to DELETE user_performances
CREATE POLICY "Company admins can delete user performances"
ON public.user_performances
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'company_admin'::app_role));
