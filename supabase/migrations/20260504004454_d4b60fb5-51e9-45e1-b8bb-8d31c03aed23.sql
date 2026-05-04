-- Fix 1: Remove user_performances and user_summaries from realtime publication.
-- These tables broadcast PnL / financial summaries via realtime.messages, which lacks
-- topic-level RLS. Their RLS policies already restrict SELECT to the row owner, so
-- postgres_changes events only ever reached the owner; non-owners gained nothing.
-- Removing from the publication eliminates any residual broadcast exposure.
ALTER PUBLICATION supabase_realtime DROP TABLE public.user_performances;
ALTER PUBLICATION supabase_realtime DROP TABLE public.user_summaries;

-- Fix 2: Tighten checkup_prediction_accuracy INSERT policy.
-- Replaces WITH CHECK (true) with an explicit authenticated-user check.
DROP POLICY IF EXISTS "Authenticated users can insert prediction accuracy"
  ON public.checkup_prediction_accuracy;

CREATE POLICY "Authenticated users can insert prediction accuracy"
ON public.checkup_prediction_accuracy
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);
