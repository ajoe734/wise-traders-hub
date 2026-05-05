-- ============================================================
-- 1. RPC: get_expert_capital_status
-- ============================================================
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
BEGIN
  SELECT COALESCE(starting_capital, 0)
    INTO v_starting
    FROM public.experts WHERE id = _expert_id;

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
            WHERE cp.symbol = SPLIT_PART(tr.instrument, ' ', 1)),
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
    'open_positions', v_positions,
    'recent_trades', v_recent
  );
END;
$$;

-- ============================================================
-- 2. Trigger: enforce_signal_capital_limit
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_signal_capital_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shares integer;
  v_required numeric;
  v_available numeric;
  v_status jsonb;
BEGIN
  -- Only enforce on buy/add and only for newly-effective signals
  IF NEW.action NOT IN ('buy','add') THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('published','pending') THEN
    RETURN NEW;
  END IF;

  -- Company admin bypass
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'company_admin') THEN
    RETURN NEW;
  END IF;

  v_shares := CASE
    WHEN COALESCE(NEW.quantity, 0) <= 0 THEN 1
    WHEN COALESCE(NEW.quantity_unit, '張') = '張' THEN COALESCE(NEW.quantity, 1) * 1000
    ELSE COALESCE(NEW.quantity, 1)
  END;

  v_required := COALESCE(NEW.price_hint, 0) * v_shares;

  v_status := public.get_expert_capital_status(NEW.expert_id);
  v_available := COALESCE((v_status->>'available_cash')::numeric, 0);

  IF v_required > v_available THEN
    RAISE EXCEPTION 'CAPITAL_EXCEEDED: 此筆需 % ，可用現金僅 % ，請降低數量或先平倉釋放資金', v_required, v_available
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_signal_capital_limit_trg ON public.expert_signals;
CREATE TRIGGER enforce_signal_capital_limit_trg
BEFORE INSERT ON public.expert_signals
FOR EACH ROW
EXECUTE FUNCTION public.enforce_signal_capital_limit();