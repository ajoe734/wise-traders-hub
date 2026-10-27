CREATE OR REPLACE FUNCTION public.latest_quote(_symbol text)
RETURNS TABLE(price numeric, price_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT x.price, x.d FROM (
    (SELECT h.close::numeric AS price, h.trade_date AS d, 1 AS pri
       FROM public.tw_price_history h WHERE h.symbol = _symbol
      ORDER BY h.trade_date DESC LIMIT 1)
    UNION ALL
    (SELECT cp.price::numeric, (cp.updated_at AT TIME ZONE 'Asia/Taipei')::date, 2
       FROM public.current_prices cp WHERE cp.symbol = _symbol LIMIT 1)
  ) x
  WHERE x.price IS NOT NULL AND x.price > 0
  ORDER BY x.d DESC, x.pri ASC
  LIMIT 1
$$;
COMMENT ON FUNCTION public.latest_quote(text) IS '持倉現價唯一規則：官方收盤歷史與即時現價取日期較新者（同日以官方收盤為準），並回傳價格日期。';
REVOKE ALL ON FUNCTION public.latest_quote(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.latest_quote(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_expert_capital_status(_expert_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_starting numeric := 0;
  v_realized numeric := 0;
  v_open_cost numeric := 0;
  v_open_market numeric := 0;
  v_available numeric := 0;
  v_positions jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
  v_expert_currency text := 'TWD';
  v_expert_asset_class text := 'tw_stock';
BEGIN
  SELECT
    COALESCE(starting_capital, 0),
    COALESCE(NULLIF(currency, ''), 'TWD'),
    COALESCE(NULLIF(asset_class, ''), CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END)
  INTO v_starting, v_expert_currency, v_expert_asset_class
  FROM public.experts
  WHERE id = _expert_id;

  SELECT COALESCE(SUM(
    COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))
  ), 0)
  INTO v_realized
  FROM public.trade_records
  WHERE expert_id = _expert_id
    AND status IN ('closed','stopped');

  SELECT COALESCE(SUM(COALESCE(quantity,0) * COALESCE(entry_price,0)), 0),
         COALESCE(SUM(COALESCE(quantity,0) * COALESCE(
           (SELECT q.price FROM public.latest_quote(SPLIT_PART(tr.instrument, ' ', 1)) q),
           tr.current_price, tr.entry_price, 0)), 0)
  INTO v_open_cost, v_open_market
  FROM public.trade_records tr
  WHERE expert_id = _expert_id AND status = 'open';

  v_available := v_starting + v_realized - v_open_cost;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tr.id,
    'instrument', tr.instrument,
    'symbol', SPLIT_PART(tr.instrument, ' ', 1),
    'quantity_shares', tr.quantity,
    'quantity_unit', COALESCE(NULLIF(tr.quantity_unit, ''), CASE
      WHEN COALESCE(NULLIF(tr.currency, ''), v_expert_currency) = 'USD'
        AND v_expert_asset_class IN ('us_future', 'us_option') THEN '口'
      WHEN COALESCE(NULLIF(tr.currency, ''), v_expert_currency) = 'USD'
        AND v_expert_asset_class = 'crypto' THEN '顆'
      ELSE '股'
    END),
    'market', COALESCE(NULLIF(tr.market, ''), CASE WHEN COALESCE(NULLIF(tr.currency, ''), v_expert_currency) = 'USD' THEN 'US' ELSE 'TW' END),
    'currency', COALESCE(NULLIF(tr.currency, ''), v_expert_currency),
    'asset_class', CASE
      WHEN COALESCE(NULLIF(tr.currency, ''), v_expert_currency) = 'USD' THEN COALESCE(NULLIF(v_expert_asset_class, ''), 'us_stock')
      ELSE 'tw_stock'
    END,
    'entry_price', tr.entry_price,
    'entry_date', tr.entry_date,
    'current_price', COALESCE(cp.price, tr.current_price, tr.entry_price),
    'price_date', cp.price_date,
    'market_value', ROUND(COALESCE(tr.quantity,0) * COALESCE(cp.price, tr.current_price, tr.entry_price, 0), 0),
    'cost_value', ROUND(COALESCE(tr.quantity,0) * COALESCE(tr.entry_price,0), 0),
    'unrealized_pnl', ROUND(COALESCE(tr.quantity,0) * (COALESCE(cp.price, tr.current_price, tr.entry_price, 0) - COALESCE(tr.entry_price,0)), 0),
    'unrealized_pct', CASE WHEN COALESCE(tr.entry_price,0) > 0
      THEN ROUND(((COALESCE(cp.price, tr.current_price, tr.entry_price, 0) - tr.entry_price) / tr.entry_price) * 100, 2)
      ELSE 0 END
  ) ORDER BY tr.created_at DESC), '[]'::jsonb)
  INTO v_positions
  FROM public.trade_records tr
  LEFT JOIN LATERAL public.latest_quote(SPLIT_PART(tr.instrument, ' ', 1)) cp ON true
  WHERE tr.expert_id = _expert_id AND tr.status = 'open';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'instrument', instrument,
    'symbol', SPLIT_PART(instrument, ' ', 1),
    'status', status,
    'quantity_shares', quantity,
    'quantity_unit', COALESCE(NULLIF(quantity_unit, ''), CASE
      WHEN COALESCE(NULLIF(currency, ''), v_expert_currency) = 'USD'
        AND v_expert_asset_class IN ('us_future', 'us_option') THEN '口'
      WHEN COALESCE(NULLIF(currency, ''), v_expert_currency) = 'USD'
        AND v_expert_asset_class = 'crypto' THEN '顆'
      ELSE '股'
    END),
    'market', COALESCE(NULLIF(market, ''), CASE WHEN COALESCE(NULLIF(currency, ''), v_expert_currency) = 'USD' THEN 'US' ELSE 'TW' END),
    'currency', COALESCE(NULLIF(currency, ''), v_expert_currency),
    'asset_class', CASE
      WHEN COALESCE(NULLIF(currency, ''), v_expert_currency) = 'USD' THEN COALESCE(NULLIF(v_expert_asset_class, ''), 'us_stock')
      ELSE 'tw_stock'
    END,
    'entry_price', entry_price,
    'entry_date', entry_date,
    'exit_price', exit_price,
    'exit_date', exit_date,
    'pnl_percent', pnl_percent,
    'created_at', created_at
  ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT * FROM public.trade_records
    WHERE expert_id = _expert_id
    ORDER BY created_at DESC
    LIMIT 20
  ) sub;

  RETURN jsonb_build_object(
    'starting_capital', ROUND(v_starting, 0),
    'realized_pnl_amount', ROUND(v_realized, 0),
    'open_cost_value', ROUND(v_open_cost, 0),
    'open_market_value', ROUND(v_open_market, 0),
    'unrealized_pnl_amount', ROUND(v_open_market - v_open_cost, 0),
    'available_cash', ROUND(v_available, 0),
    'currency', v_expert_currency,
    'asset_class', v_expert_asset_class,
    'open_positions', v_positions,
    'recent_trades', v_recent
  );
END;
$function$;

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
  SELECT COALESCE(starting_capital, 0) INTO v_starting_capital
  FROM public.experts WHERE id = _expert_id;

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

  SELECT COALESCE(SUM(
    COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))
  ), 0)
  INTO return_1y
  FROM public.trade_records
  WHERE expert_id = _expert_id AND status IN ('closed', 'stopped')
    AND exit_date >= one_year_ago;

  SELECT COALESCE(AVG(
    EXTRACT(EPOCH FROM (COALESCE(exit_date, NOW()) - entry_date)) / 86400
  ), 0)
  INTO avg_hold
  FROM public.trade_records
  WHERE expert_id = _expert_id AND status IN ('open', 'closed', 'stopped');

  SELECT
    COALESCE(SUM(tr.quantity * COALESCE(cp.price, tr.current_price, tr.entry_price, 0)), 0),
    COALESCE(SUM(tr.quantity * COALESCE(tr.entry_price, 0)), 0)
  INTO v_open_market_value, v_open_cost_value
  FROM public.trade_records tr
  LEFT JOIN LATERAL public.latest_quote(SPLIT_PART(tr.instrument, ' ', 1)) cp ON true
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