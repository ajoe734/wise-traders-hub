
-- auth trigger already exists, skip it.

-- 2. Trigger: handle_signal_trade on expert_signals (INSERT or UPDATE)
DROP TRIGGER IF EXISTS on_signal_insert_or_update ON public.expert_signals;
CREATE TRIGGER on_signal_insert_or_update
  AFTER INSERT OR UPDATE ON public.expert_signals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_signal_trade();

-- 3. Trigger: handle_signal_takedown on expert_signals (UPDATE)
DROP TRIGGER IF EXISTS on_signal_takedown ON public.expert_signals;
CREATE TRIGGER on_signal_takedown
  AFTER UPDATE ON public.expert_signals
  FOR EACH ROW
  WHEN (NEW.status = 'taken_down' AND OLD.status = 'published')
  EXECUTE FUNCTION public.handle_signal_takedown();

-- 4. Trigger: update_updated_at on profiles
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Trigger: update_updated_at on expert_line_channels
DROP TRIGGER IF EXISTS update_expert_line_channels_updated_at ON public.expert_line_channels;
CREATE TRIGGER update_expert_line_channels_updated_at
  BEFORE UPDATE ON public.expert_line_channels
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
