CREATE OR REPLACE FUNCTION public.handle_signal_takedown()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining_published integer;
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
      -- No more published signals for this instrument — delete records entirely
      DELETE FROM public.trade_records
      WHERE expert_id = NEW.expert_id
        AND instrument = NEW.instrument;

      -- Get the expert's user_id for trade_signals cleanup
      SELECT user_id INTO _user_id
      FROM public.experts
      WHERE id = NEW.expert_id;

      IF _user_id IS NOT NULL THEN
        -- Parse symbol from instrument (format: "2330 台積電")
        DELETE FROM public.trade_signals
        WHERE user_id = _user_id
          AND symbol = split_part(NEW.instrument, ' ', 1);

        -- Also clean up user_performances
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
$$;