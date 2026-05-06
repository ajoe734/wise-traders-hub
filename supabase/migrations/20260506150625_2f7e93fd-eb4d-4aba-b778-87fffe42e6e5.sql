CREATE POLICY "Anyone can view open trades for active experts"
ON public.trade_records
FOR SELECT
TO public
USING (
  status = 'open'::trade_status
  AND expert_id IN (
    SELECT id FROM public.experts WHERE status = 'active'
  )
);