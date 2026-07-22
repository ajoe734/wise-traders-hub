CREATE OR REPLACE FUNCTION public.get_expert_capital_status(_expert_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
           (SELECT price FROM public.current_prices cp
            WHERE cp.symbol = SPLIT_PART(tr.instrument, ' ', 1)
            LIMIT 1),
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
      WHEN COALESCE(NULLIF(tr.asset_class, ''), v_expert_asset_class) = 'tw_stock' THEN '股'
      WHEN COALESCE(NULLIF(tr.asset_class, ''), v_expert_asset_class) IN ('us_future', 'us_option') THEN '口'
      WHEN COALESCE(NULLIF(tr.asset_class, ''), v_expert_asset_class) = 'crypto' THEN '顆'
      ELSE '股'
    END),
    'market', COALESCE(NULLIF(tr.market, ''), CASE WHEN COALESCE(NULLIF(tr.currency, ''), v_expert_currency) = 'USD' THEN 'US' ELSE 'TW' END),
    'currency', COALESCE(NULLIF(tr.currency, ''), v_expert_currency),
    'asset_class', COALESCE(NULLIF(tr.asset_class, ''), v_expert_asset_class, CASE WHEN COALESCE(NULLIF(tr.currency, ''), v_expert_currency) = 'USD' THEN 'us_stock' ELSE 'tw_stock' END),
    'entry_price', tr.entry_price,
    'entry_date', tr.entry_date,
    'current_price', COALESCE(cp.price, tr.current_price, tr.entry_price),
    'market_value', ROUND(COALESCE(tr.quantity,0) * COALESCE(cp.price, tr.current_price, tr.entry_price, 0), 0),
    'cost_value', ROUND(COALESCE(tr.quantity,0) * COALESCE(tr.entry_price,0), 0),
    'unrealized_pnl', ROUND(COALESCE(tr.quantity,0) * (COALESCE(cp.price, tr.current_price, tr.entry_price, 0) - COALESCE(tr.entry_price,0)), 0),
    'unrealized_pct', CASE WHEN COALESCE(tr.entry_price,0) > 0
      THEN ROUND(((COALESCE(cp.price, tr.current_price, tr.entry_price, 0) - tr.entry_price) / tr.entry_price) * 100, 2)
      ELSE 0 END
  ) ORDER BY tr.created_at DESC), '[]'::jsonb)
  INTO v_positions
  FROM public.trade_records tr
  LEFT JOIN public.current_prices cp ON cp.symbol = SPLIT_PART(tr.instrument, ' ', 1)
  WHERE tr.expert_id = _expert_id AND tr.status = 'open';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'instrument', instrument,
    'symbol', SPLIT_PART(instrument, ' ', 1),
    'status', status,
    'quantity_shares', quantity,
    'quantity_unit', COALESCE(NULLIF(quantity_unit, ''), CASE
      WHEN COALESCE(NULLIF(asset_class, ''), v_expert_asset_class) = 'tw_stock' THEN '股'
      WHEN COALESCE(NULLIF(asset_class, ''), v_expert_asset_class) IN ('us_future', 'us_option') THEN '口'
      WHEN COALESCE(NULLIF(asset_class, ''), v_expert_asset_class) = 'crypto' THEN '顆'
      ELSE '股'
    END),
    'market', COALESCE(NULLIF(market, ''), CASE WHEN COALESCE(NULLIF(currency, ''), v_expert_currency) = 'USD' THEN 'US' ELSE 'TW' END),
    'currency', COALESCE(NULLIF(currency, ''), v_expert_currency),
    'asset_class', COALESCE(NULLIF(asset_class, ''), v_expert_asset_class, CASE WHEN COALESCE(NULLIF(currency, ''), v_expert_currency) = 'USD' THEN 'us_stock' ELSE 'tw_stock' END),
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
$$;

COMMENT ON FUNCTION public.get_expert_capital_status(uuid) IS 'Returns expert capital status with open position quantity_unit/currency/asset_class so journal editor never treats actual shares as lots.';

GRANT EXECUTE ON FUNCTION public.get_expert_capital_status(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_expert_capital_status(uuid) FROM anon;