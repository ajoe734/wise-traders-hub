CREATE POLICY "Anyone can view closed trades for active experts"
ON public.trade_records
FOR SELECT
TO public
USING (
  status IN ('closed'::trade_status, 'stopped'::trade_status)
  AND expert_id IN (
    SELECT id FROM public.experts WHERE status = 'active'
  )
);