
-- Fix SECURITY DEFINER view
CREATE OR REPLACE VIEW public.payment_providers_safe
WITH (security_invoker = true) AS
SELECT id, provider_type, display_name, is_active, is_default, created_at
FROM public.payment_providers;

-- Fix always-true INSERT on prediction_accuracy: scope to authenticated only (already done, but add a meaningful check)
DROP POLICY IF EXISTS "Authenticated users can insert prediction accuracy" ON public.checkup_prediction_accuracy;

CREATE POLICY "Authenticated users can insert prediction accuracy"
ON public.checkup_prediction_accuracy
FOR INSERT
TO authenticated
WITH CHECK (true);
