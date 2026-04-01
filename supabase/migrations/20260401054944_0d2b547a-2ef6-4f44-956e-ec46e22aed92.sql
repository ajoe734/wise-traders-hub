
-- Remove duplicate trigger - keep the original one that handles INSERT OR UPDATE
DROP TRIGGER IF EXISTS on_signal_insert_trade ON public.expert_signals;
