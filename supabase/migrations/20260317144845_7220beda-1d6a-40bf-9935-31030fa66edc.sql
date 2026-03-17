
CREATE POLICY "Analysts can delete own signals"
ON public.expert_signals
FOR DELETE
TO authenticated
USING (expert_id IN (
  SELECT experts.id FROM experts WHERE experts.user_id = auth.uid()
));
