
-- ── 1. Fix handle_signal_trade: keep quantity on close (don't zero it out) ──
CREATE OR REPLACE FUNCTION public.handle_signal_trade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint,
      COALESCE(NEW.published_at, NOW()), 'open'::trade_status, signal_shares, '股'
    );

  ELSIF NEW.action = 'add' THEN
    SELECT * INTO existing_record FROM public.trade_records
    WHERE expert_id = NEW.expert_id AND instrument = NEW.instrument AND status = 'open'
    ORDER BY created_at DESC LIMIT 1;

    IF FOUND THEN
      UPDATE public.trade_records
      SET entry_price = CASE
            WHEN (existing_record.quantity + signal_shares) > 0
            THEN ROUND(
              (existing_record.quantity * COALESCE(existing_record.entry_price, 0)
               + signal_shares * COALESCE(NEW.price_hint, 0))
              / (existing_record.quantity + signal_shares), 2)
            ELSE existing_record.entry_price
          END,
          quantity = existing_record.quantity + signal_shares,
          quantity_unit = '股'
      WHERE id = existing_record.id;
    ELSE
      INSERT INTO public.trade_records (
        expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit
      ) VALUES (
        NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint,
        COALESCE(NEW.published_at, NOW()), 'open'::trade_status, signal_shares, '股'
      );
    END IF;

  ELSIF NEW.action IN ('sell', 'trim') THEN
    SELECT * INTO existing_record FROM public.trade_records
    WHERE expert_id = NEW.expert_id AND instrument = NEW.instrument AND status = 'open'
    ORDER BY created_at DESC LIMIT 1;

    IF FOUND THEN
      sell_qty := LEAST(signal_shares, existing_record.quantity);
      remaining_qty := existing_record.quantity - sell_qty;

      IF remaining_qty <= 0 THEN
        -- 平倉：保留實際成交股數（sell_qty）以便績效金額計算正確
        UPDATE public.trade_records
        SET exit_price = NEW.price_hint,
            exit_date = COALESCE(NEW.published_at, NOW()),
            pnl_percent = CASE
              WHEN existing_record.entry_price IS NOT NULL AND existing_record.entry_price > 0
              THEN ROUND(((NEW.price_hint - existing_record.entry_price) / existing_record.entry_price) * 100, 2)
              ELSE NULL
            END,
            quantity = sell_qty,
            quantity_unit = '股',
            status = 'closed'::trade_status
        WHERE id = existing_record.id;
      ELSE
        UPDATE public.trade_records
        SET quantity = remaining_qty, quantity_unit = '股'
        WHERE id = existing_record.id;

        INSERT INTO public.trade_records (
          expert_id, signal_id, instrument,
          entry_price, entry_date, exit_price, exit_date,
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
          sell_qty, '股', 'closed'::trade_status
        );
      END IF;
    END IF;

  ELSIF NEW.action = 'exit' THEN
    -- exit：保留 quantity 不歸零
    UPDATE public.trade_records
    SET exit_price = NEW.price_hint,
        exit_date = COALESCE(NEW.published_at, NOW()),
        pnl_percent = CASE
          WHEN entry_price IS NOT NULL AND entry_price > 0
          THEN ROUND(((NEW.price_hint - entry_price) / entry_price) * 100, 2)
          ELSE NULL
        END,
        quantity_unit = '股',
        status = 'closed'::trade_status
    WHERE expert_id = NEW.expert_id
      AND instrument = NEW.instrument
      AND status = 'open'
      AND exit_price IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 2. Rewrite calculate_expert_performance with correct algorithms ──
CREATE OR REPLACE FUNCTION public.calculate_expert_performance(_expert_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  total_trades integer := 0;
  winning_trades integer := 0;
  avg_pnl_pct numeric := 0;
  avg_hold numeric := 0;
  rec record;
  peak_amt numeric := 0;
  running_amt numeric := 0;
  worst_dd_amt numeric := 0;
  one_year_ago timestamp with time zone := NOW() - INTERVAL '1 year';
  return_1y numeric := 0;
  v_starting_capital numeric := 0;
  v_realized_amount numeric := 0;
  v_unrealized_amount numeric := 0;
  v_open_market_value numeric := 0;
  v_open_cost_value numeric := 0;
  v_current_asset numeric := 0;
  v_total_return_pct numeric := 0;
  v_max_drawdown_pct numeric := 0;
  v_profit_sum_amt numeric := 0;
  v_loss_sum_amt numeric := 0;
  v_profit_factor numeric := 0;
  v_avg_pnl_amount numeric := 0;
BEGIN
  -- starting capital
  SELECT COALESCE(starting_capital, 0) INTO v_starting_capital
  FROM public.experts WHERE id = _expert_id;

  -- closed-trade aggregates: count, win, avg pnl%, realized $, profit/loss $
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE pnl_percent > 0),
    COALESCE(AVG(pnl_percent), 0),
    COALESCE(SUM(
      COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))
    ), 0),
    COALESCE(SUM(
      COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))
    ) FILTER (WHERE COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0)) > 0), 0),
    COALESCE(ABS(SUM(
      COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))
    ) FILTER (WHERE COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0)) < 0)), 0)
  INTO total_trades, winning_trades, avg_pnl_pct, v_realized_amount, v_profit_sum_amt, v_loss_sum_amt
  FROM public.trade_records
  WHERE expert_id = _expert_id AND status IN ('closed', 'stopped');

  -- max drawdown: running pnl_amount cumulative (closed trades, ordered)
  FOR rec IN
    SELECT (COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))) AS pnl_amt
    FROM public.trade_records
    WHERE expert_id = _expert_id AND status IN ('closed', 'stopped')
    ORDER BY exit_date ASC NULLS LAST, created_at ASC
  LOOP
    running_amt := running_amt + rec.pnl_amt;
    IF running_amt > peak_amt THEN peak_amt := running_amt; END IF;
    IF (peak_amt - running_amt) > worst_dd_amt THEN worst_dd_amt := peak_amt - running_amt; END IF;
  END LOOP;

  -- 1-year return: sum of pnl_amount in $ / starting_capital × 100
  SELECT COALESCE(SUM(
    COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))
  ), 0)
  INTO return_1y
  FROM public.trade_records
  WHERE expert_id = _expert_id AND status IN ('closed', 'stopped')
    AND exit_date >= one_year_ago;

  -- avg hold days: include open trades (treat NOW() as exit)
  SELECT COALESCE(AVG(
    EXTRACT(EPOCH FROM (COALESCE(exit_date, NOW()) - entry_date)) / 86400
  ), 0)
  INTO avg_hold
  FROM public.trade_records
  WHERE expert_id = _expert_id AND status IN ('open', 'closed', 'stopped');

  -- unrealized: open trades market value vs cost
  SELECT
    COALESCE(SUM(tr.quantity * COALESCE(cp.price, tr.current_price, tr.entry_price, 0)), 0),
    COALESCE(SUM(tr.quantity * COALESCE(tr.entry_price, 0)), 0)
  INTO v_open_market_value, v_open_cost_value
  FROM public.trade_records tr
  LEFT JOIN public.current_prices cp ON cp.symbol = SPLIT_PART(tr.instrument, ' ', 1)
  WHERE tr.expert_id = _expert_id AND tr.status = 'open';

  v_unrealized_amount := v_open_market_value - v_open_cost_value;

  IF v_starting_capital > 0 THEN
    v_current_asset := v_starting_capital + v_realized_amount + v_unrealized_amount;
    v_total_return_pct := ROUND(((v_realized_amount + v_unrealized_amount) / v_starting_capital) * 100, 2);
    v_max_drawdown_pct := ROUND((worst_dd_amt / v_starting_capital) * 100, 2);
  ELSE
    v_current_asset := v_open_market_value;
    v_total_return_pct := 0;
    v_max_drawdown_pct := 0;
  END IF;

  -- profit factor in $
  IF v_loss_sum_amt > 0 THEN
    v_profit_factor := ROUND(v_profit_sum_amt / v_loss_sum_amt, 2);
  ELSIF v_profit_sum_amt > 0 THEN
    v_profit_factor := 999.99;
  ELSE
    v_profit_factor := 0;
  END IF;

  IF total_trades > 0 THEN
    v_avg_pnl_amount := ROUND(v_realized_amount / total_trades, 0);
  END IF;

  result := jsonb_build_object(
    'total_trades', total_trades,
    'win_rate', CASE WHEN total_trades > 0 THEN ROUND((winning_trades::numeric / total_trades) * 100, 2) ELSE 0 END,
    'avg_pnl_pct', ROUND(avg_pnl_pct, 2),
    'avg_pnl_amount', v_avg_pnl_amount,
    'max_drawdown', v_max_drawdown_pct,
    'profit_factor', v_profit_factor,
    'avg_hold_days', ROUND(avg_hold, 1),
    'return_1y', CASE WHEN v_starting_capital > 0 THEN ROUND((return_1y / v_starting_capital) * 100, 2) ELSE 0 END,
    'current_asset', ROUND(v_current_asset, 0),
    'starting_capital', ROUND(v_starting_capital, 0),
    'realized_pnl_amount', ROUND(v_realized_amount, 0),
    'unrealized_pnl_amount', ROUND(v_unrealized_amount, 0),
    'total_return_pct', v_total_return_pct
  );

  RETURN result;
END;
$function$;
