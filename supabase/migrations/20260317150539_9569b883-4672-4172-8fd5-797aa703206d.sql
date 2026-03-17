-- Allow analysts to delete trade_records for their own expert
CREATE POLICY "Analysts can delete own trade records"
ON public.trade_records
FOR DELETE
TO authenticated
USING (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()));

-- Allow analysts to delete trade_signals for their own user_id
CREATE POLICY "Analysts can delete own trade signals"
ON public.trade_signals
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Allow analysts to delete user_performances for their own user_id
CREATE POLICY "Analysts can delete own user performances"
ON public.user_performances
FOR DELETE
TO authenticated
USING (user_id = auth.uid());