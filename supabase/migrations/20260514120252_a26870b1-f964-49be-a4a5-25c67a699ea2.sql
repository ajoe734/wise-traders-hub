CREATE OR REPLACE FUNCTION public.handle_signal_trade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  existing_record RECORD;
  signal_shares integer;
  sell_qty integer;
  remaining_qty integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = NEW.status THEN
      RETURN NEW;
    END IF;
    IF NOT (OLD.status = 'pending' AND NEW.status = 'published') THEN
      RETURN NEW;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  signal_shares := CASE
    WHEN COALESCE(NEW.quantity, 0) <= 0 THEN 1
    WHEN COALESCE(NEW.quantity_unit, '張') = '張' THEN COALESCE(NEW.quantity, 1) * 1000
    ELSE COALESCE(NEW.quantity, 1)
  END;

  IF NEW.action = 'buy' THEN
    INSERT INTO public.trade_records (
      expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit
    )
    VALUES (
      NEW.expert_id,
      NEW.id,
      NEW.instrument,
      NEW.price_hint,
      COALESCE(NEW.published_at, NOW()),
      'open'::trade_status,
      signal_shares,
      '股'
    );

  ELSIF NEW.action = 'add' THEN
    SELECT * INTO existing_record
    FROM public.trade_records
    WHERE expert_id = NEW.expert_id
      AND instrument = NEW.instrument
      AND status = 'open'
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      UPDATE public.trade_records
      SET entry_price = CASE
            WHEN (existing_record.quantity + signal_shares) > 0
            THEN ROUND(
              (existing_record.quantity * COALESCE(existing_record.entry_price, 0)
               + signal_shares * COALESCE(NEW.price_hint, 0))
              / (existing_record.quantity + signal_shares)
            , 2)
            ELSE existing_record.entry_price
          END,
          quantity = existing_record.quantity + signal_shares,
          quantity_unit = '股'
      WHERE id = existing_record.id;
    ELSE
      INSERT INTO public.trade_records (
        expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit
      )
      VALUES (
        NEW.expert_id,
        NEW.id,
        NEW.instrument,
        NEW.price_hint,
        COALESCE(NEW.published_at, NOW()),
        'open'::trade_status,
        signal_shares,
        '股'
      );
    END IF;

  ELSIF NEW.action IN ('sell', 'trim') THEN
    SELECT * INTO existing_record
    FROM public.trade_records
    WHERE expert_id = NEW.expert_id
      AND instrument = NEW.instrument
      AND status = 'open'
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      sell_qty := LEAST(signal_shares, existing_record.quantity);
      remaining_qty := existing_record.quantity - sell_qty;

      IF remaining_qty <= 0 THEN
        UPDATE public.trade_records
        SET exit_price = NEW.price_hint,
            exit_date = COALESCE(NEW.published_at, NOW()),
            pnl_percent = CASE
              WHEN existing_record.entry_price IS NOT NULL AND existing_record.entry_price > 0
              THEN ROUND(((NEW.price_hint - existing_record.entry_price) / existing_record.entry_price) * 100, 2)
              ELSE NULL
            END,
            quantity = 0,
            quantity_unit = '股',
            status = 'closed'::trade_status
        WHERE id = existing_record.id;
      ELSE
        UPDATE public.trade_records
        SET quantity = remaining_qty,
            quantity_unit = '股'
        WHERE id = existing_record.id;

        INSERT INTO public.trade_records (
          expert_id, signal_id, instrument,
          entry_price, entry_date,
          exit_price, exit_date,
          pnl_percent, quantity, quantity_unit, status
        ) VALUES (
          NEW.expert_id, NEW.id, NEW.instrument,
          existing_record.entry_price, existing_record.entry_date,
          NEW.price_hint, COALESCE(NEW.published_at, NOW()),
          CASE
            WHEN existing_record.entry_price IS NOT NULL AND existing_record.entry_price > 0
            THEN ROUND(((NEW.price_hint - existing_record.entry_price) / existing_record.entry_price) * 100, 2)
            ELSE NULL
          END,
          sell_qty,
          '股',
          'closed'::trade_status
        );
      END IF;
    END IF;

  ELSIF NEW.action = 'exit' THEN
    UPDATE public.trade_records
    SET exit_price = NEW.price_hint,
        exit_date = COALESCE(NEW.published_at, NOW()),
        pnl_percent = CASE
          WHEN entry_price IS NOT NULL AND entry_price > 0
          THEN ROUND(((NEW.price_hint - entry_price) / entry_price) * 100, 2)
          ELSE NULL
        END,
        quantity = 0,
        quantity_unit = '股',
        status = 'closed'::trade_status
    WHERE expert_id = NEW.expert_id
      AND instrument = NEW.instrument
      AND status = 'open'
      AND exit_price IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY signal_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.trade_records
  WHERE signal_id IS NOT NULL
)
DELETE FROM public.trade_records tr
USING ranked r
WHERE tr.id = r.id
  AND r.rn > 1;