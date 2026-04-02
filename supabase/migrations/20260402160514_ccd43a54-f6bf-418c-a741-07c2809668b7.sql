
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
  _add_qty integer;
  _add_price numeric;
  _open_rec RECORD;
  _new_qty integer;
  _new_entry numeric;
BEGIN
  IF NEW.status = 'taken_down' AND OLD.status = 'published' THEN

    -- NEW-002: If this is an ADD signal being recalled, reverse the weighted average
    IF OLD.action = 'add' AND OLD.quantity IS NOT NULL AND OLD.price_hint IS NOT NULL THEN
      SELECT * INTO _open_rec
      FROM public.trade_records
      WHERE expert_id = NEW.expert_id
        AND instrument = NEW.instrument
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1;

      IF FOUND AND _open_rec.quantity > OLD.quantity THEN
        _add_qty := OLD.quantity;
        _add_price := OLD.price_hint;
        _new_qty := _open_rec.quantity - _add_qty;

        IF _new_qty > 0 THEN
          _new_entry := ROUND(
            (_open_rec.quantity * COALESCE(_open_rec.entry_price, 0) - _add_qty * _add_price)
            / _new_qty
          , 2);

          UPDATE public.trade_records
          SET quantity = _new_qty,
              entry_price = _new_entry
          WHERE id = _open_rec.id;
        END IF;
      ELSIF FOUND AND _open_rec.quantity <= OLD.quantity THEN
        DELETE FROM public.trade_records WHERE id = _open_rec.id;
      END IF;

      RETURN NEW;
    END IF;

    -- Check if there are any other published signals for the same instrument+expert
    SELECT COUNT(*) INTO remaining_published
    FROM public.expert_signals
    WHERE expert_id = NEW.expert_id
      AND instrument = NEW.instrument
      AND status = 'published'
      AND id != NEW.id;

    IF remaining_published = 0 THEN
      SELECT EXISTS (
        SELECT 1 FROM public.trade_records
        WHERE expert_id = NEW.expert_id
          AND instrument = NEW.instrument
          AND status = 'open'
      ) INTO has_open_trades;

      SELECT user_id INTO _user_id
      FROM public.experts
      WHERE id = NEW.expert_id;

      IF has_open_trades THEN
        UPDATE public.trade_records
        SET status = 'closed'::trade_status,
            exit_date = NOW(),
            exit_price = COALESCE(current_price, entry_price),
            pnl_percent = CASE
              WHEN entry_price IS NOT NULL AND entry_price > 0 AND COALESCE(current_price, entry_price) IS NOT NULL
              THEN ROUND(((COALESCE(current_price, entry_price) - entry_price) / entry_price) * 100, 2)
              ELSE pnl_percent
            END
        WHERE expert_id = NEW.expert_id
          AND instrument = NEW.instrument
          AND status = 'open';
      ELSE
        DELETE FROM public.trade_records
        WHERE expert_id = NEW.expert_id
          AND instrument = NEW.instrument
          AND status = 'closed';
      END IF;

      IF _user_id IS NOT NULL THEN
        DELETE FROM public.trade_signals
        WHERE user_id = _user_id
          AND symbol = split_part(NEW.instrument, ' ', 1)
          AND status = 'closed';

        UPDATE public.trade_signals
        SET status = 'closed',
            closed_at = NOW()
        WHERE user_id = _user_id
          AND symbol = split_part(NEW.instrument, ' ', 1)
          AND status = 'open';

        DELETE FROM public.user_performances
        WHERE user_id = _user_id
          AND symbol = split_part(NEW.instrument, ' ', 1);
      END IF;
    ELSE
      UPDATE public.trade_records
      SET status = 'stopped'::trade_status,
          exit_date = NOW(),
          exit_price = COALESCE(current_price, entry_price)
      WHERE signal_id = NEW.id
        AND status = 'open';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
