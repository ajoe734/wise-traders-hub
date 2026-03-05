-- Drop duplicate triggers, keep only on_signal_insert_or_update (covers both INSERT and UPDATE)
DROP TRIGGER IF EXISTS on_signal_insert ON public.expert_signals;
DROP TRIGGER IF EXISTS on_signal_published ON public.expert_signals;