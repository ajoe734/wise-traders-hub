
CREATE TRIGGER on_signal_insert_trade
  AFTER INSERT ON public.expert_signals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_signal_trade();
