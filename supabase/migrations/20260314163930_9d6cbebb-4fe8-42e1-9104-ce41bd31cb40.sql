CREATE OR REPLACE FUNCTION public.handle_signal_takedown()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  remaining_published integer;
  has_open_trades boolean;
  _user_id uuid;
BEGIN
  IF NEW.status = 'taken_down' AND OLD.status = 'published' THEN
    -- Check if there are any other published signals for the same instrument+expert
    SELECT COUNT(*) INTO remaining_published
    FROM public.expert_signals
    WHERE expert_id = NEW.expert_id
      AND instrument = NEW.instrument
      AND status = 'published'
      AND id != NEW.id;

    IF remaining_published = 0 THEN
      -- No more published signals — check if there are any open trade_records
      SELECT EXISTS (
        SELECT 1 FROM public.trade_records
        WHERE expert_id = NEW.expert_id
          AND instrument = NEW.instrument
          AND status = 'open'
      ) INTO has_open_trades;

      -- Get the expert's user_id
      SELECT user_id INTO _user_id
      FROM public.experts
      WHERE id = NEW.expert_id;

      IF has_open_trades THEN
        -- Close all open trades (mark as closed with current price)
        UPDATE public.trade_records
        SET status = 'closed'::trade_status,
            exit_date = NOW(),
            exit_price = current_price,
            pnl_percent = CASE
              WHEN entry_price IS NOT NULL AND entry_price > 0 AND current_price IS NOT NULL
              THEN ROUND(((current_price - entry_price) / entry_price) * 100, 2)
              ELSE pnl_percent
            END
        WHERE expert_id = NEW.expert_id
          AND instrument = NEW.instrument
          AND status = 'open';
      ELSE
        -- No open trades — delete any closed trade_records for this instrument
        DELETE FROM public.trade_records
        WHERE expert_id = NEW.expert_id
          AND instrument = NEW.instrument
          AND status = 'closed';
      END IF;

      -- Update trade_signals to closed and clean up user_performances
      IF _user_id IS NOT NULL THEN
        -- Delete closed trade_signals for this instrument
        DELETE FROM public.trade_signals
        WHERE user_id = _user_id
          AND symbol = split_part(NEW.instrument, ' ', 1)
          AND status = 'closed';

        -- Also close any remaining open ones
        UPDATE public.trade_signals
        SET status = 'closed',
            closed_at = NOW()
        WHERE user_id = _user_id
          AND symbol = split_part(NEW.instrument, ' ', 1)
          AND status = 'open';

        -- Clean up user_performances
        DELETE FROM public.user_performances
        WHERE user_id = _user_id
          AND symbol = split_part(NEW.instrument, ' ', 1);
      END IF;
    ELSE
      -- Still has other published signals — just close open trades for this signal
      UPDATE public.trade_records
      SET status = 'stopped'::trade_status,
          exit_date = NOW(),
          exit_price = current_price
      WHERE signal_id = NEW.id
        AND status = 'open';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;