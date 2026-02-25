
CREATE OR REPLACE FUNCTION public.handle_signal_trade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'published' THEN
    IF NEW.action = 'buy' THEN
      INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status)
      VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, NEW.published_at, 'open'::trade_status);
    ELSIF NEW.action IN ('sell', 'exit') THEN
      UPDATE public.trade_records
      SET exit_price = NEW.price_hint,
          exit_date = NEW.published_at,
          pnl_percent = CASE
            WHEN entry_price IS NOT NULL AND entry_price > 0
            THEN ROUND(((NEW.price_hint - entry_price) / entry_price) * 100, 2)
            ELSE NULL
          END,
          status = CASE WHEN NEW.action = 'exit' THEN 'stopped'::trade_status ELSE 'closed'::trade_status END
      WHERE expert_id = NEW.expert_id
        AND instrument = NEW.instrument
        AND status = 'open'
        AND exit_price IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS on_signal_insert ON public.expert_signals;
CREATE TRIGGER on_signal_insert
  AFTER INSERT ON public.expert_signals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_signal_trade();
