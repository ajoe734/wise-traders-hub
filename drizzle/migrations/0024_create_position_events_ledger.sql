CREATE TABLE public.position_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL,
  source_signal_id uuid,
  symbol text NOT NULL,
  instrument text NOT NULL,
  action text NOT NULL CHECK (action IN ('buy','add','trim','sell','exit','correction')),
  quantity_delta numeric NOT NULL,
  quantity_after numeric NOT NULL CHECK (quantity_after >= 0),
  quantity_unit text NOT NULL,
  trade_price numeric,
  currency text NOT NULL CHECK (currency IN ('TWD','USD')),
  asset_class text NOT NULL,
  event_at timestamptz NOT NULL,
  source_kind text NOT NULL DEFAULT 'live' CHECK (source_kind IN ('live','reconstructed','correction')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_signal_id)
);

GRANT SELECT ON public.position_events TO authenticated;
GRANT ALL ON public.position_events TO service_role;
ALTER TABLE public.position_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX position_events_expert_time_idx ON public.position_events (expert_id, event_at DESC);
CREATE INDEX position_events_expert_symbol_time_idx ON public.position_events (expert_id, symbol, event_at DESC);

CREATE POLICY "Subscribers can view current expert position events"
ON public.position_events
FOR SELECT
TO authenticated
USING (
  expert_id IN (SELECT expert_id FROM public.has_active_subscription(auth.uid()))
  OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
  OR public.has_role(auth.uid(), 'company_admin'::public.app_role)
  OR public.is_tester(auth.uid())
);

CREATE OR REPLACE FUNCTION public.prevent_position_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'position_events is append-only';
END;
$$;

CREATE TRIGGER position_events_no_update
BEFORE UPDATE OR DELETE ON public.position_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_position_event_mutation();

CREATE OR REPLACE FUNCTION public.append_position_event_from_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_symbol text;
  v_asset_class text;
  v_currency text;
  v_unit text;
  v_requested numeric;
  v_previous numeric;
  v_delta numeric;
  v_after numeric;
BEGIN
  IF NEW.status <> 'published' OR NEW.action::text NOT IN ('buy','add','trim','sell','exit') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.position_events pe WHERE pe.source_signal_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_symbol := split_part(btrim(COALESCE(NEW.instrument, '')), ' ', 1);
  SELECT COALESCE(e.asset_class, CASE WHEN e.currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END),
         COALESCE(NULLIF(e.currency, ''), CASE WHEN e.asset_class IN ('us_stock','us_option','us_future','crypto') THEN 'USD' ELSE 'TWD' END)
    INTO v_asset_class, v_currency
  FROM public.experts e WHERE e.id = NEW.expert_id;
  v_asset_class := COALESCE(v_asset_class, 'tw_stock');
  v_currency := COALESCE(v_currency, CASE WHEN v_asset_class IN ('us_stock','us_option','us_future','crypto') THEN 'USD' ELSE 'TWD' END);
  v_unit := COALESCE(NULLIF(btrim(NEW.quantity_unit), ''), CASE WHEN v_asset_class = 'tw_stock' THEN '張' WHEN v_asset_class IN ('us_option','us_future') THEN '口' WHEN v_asset_class = 'crypto' THEN '顆' ELSE '股' END);
  v_requested := CASE WHEN COALESCE(NEW.quantity, 0) <= 0 THEN 1 WHEN v_asset_class = 'tw_stock' AND v_unit = '張' THEN NEW.quantity * 1000 ELSE NEW.quantity END;

  SELECT pe.quantity_after INTO v_previous
  FROM public.position_events pe
  WHERE pe.expert_id = NEW.expert_id AND pe.symbol = v_symbol
  ORDER BY pe.event_at DESC, pe.created_at DESC LIMIT 1;

  IF v_previous IS NULL THEN
    IF NEW.action::text IN ('buy','add') THEN
      SELECT GREATEST(0, COALESCE(SUM(tr.quantity), 0) - v_requested) INTO v_previous
      FROM public.trade_records tr
      WHERE tr.expert_id = NEW.expert_id AND split_part(btrim(tr.instrument), ' ', 1) = v_symbol AND tr.status = 'open';
    ELSE
      SELECT COALESCE(SUM(tr.quantity), 0) INTO v_previous
      FROM public.trade_records tr
      WHERE tr.expert_id = NEW.expert_id AND split_part(btrim(tr.instrument), ' ', 1) = v_symbol
        AND (tr.status = 'open' OR (tr.exit_date = COALESCE(NEW.published_at, NEW.executed_at, NEW.created_at)));
    END IF;
  END IF;

  IF NEW.action::text IN ('buy','add') THEN
    v_delta := v_requested;
  ELSIF NEW.action::text = 'exit' THEN
    v_delta := -v_previous;
  ELSE
    v_delta := -LEAST(v_requested, v_previous);
  END IF;
  v_after := GREATEST(0, v_previous + v_delta);

  INSERT INTO public.position_events (
    expert_id, source_signal_id, symbol, instrument, action, quantity_delta,
    quantity_after, quantity_unit, trade_price, currency, asset_class, event_at, source_kind
  ) VALUES (
    NEW.expert_id, NEW.id, v_symbol, NEW.instrument, NEW.action::text, v_delta,
    v_after, v_unit, NEW.price_hint, v_currency, v_asset_class,
    COALESCE(NEW.published_at, NEW.executed_at, NEW.created_at, now()), 'live'
  ) ON CONFLICT (source_signal_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER z_append_position_event
AFTER INSERT OR UPDATE OF status ON public.expert_signals
FOR EACH ROW EXECUTE FUNCTION public.append_position_event_from_signal();

DO $$
DECLARE
  s record;
  v_symbol text;
  v_asset_class text;
  v_currency text;
  v_unit text;
  v_requested numeric;
  v_previous numeric;
  v_delta numeric;
  v_after numeric;
BEGIN
  FOR s IN
    SELECT es.*, e.asset_class AS expert_asset_class, e.currency AS expert_currency
    FROM public.expert_signals es
    JOIN public.experts e ON e.id = es.expert_id
    WHERE es.status = 'published' AND es.action::text IN ('buy','add','trim','sell','exit')
    ORDER BY COALESCE(es.published_at, es.executed_at, es.created_at), es.created_at, es.id
  LOOP
    IF EXISTS (SELECT 1 FROM public.position_events pe WHERE pe.source_signal_id = s.id) THEN CONTINUE; END IF;
    v_symbol := split_part(btrim(COALESCE(s.instrument, '')), ' ', 1);
    v_asset_class := COALESCE(s.expert_asset_class, CASE WHEN s.expert_currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END, 'tw_stock');
    v_currency := COALESCE(NULLIF(s.expert_currency, ''), CASE WHEN v_asset_class IN ('us_stock','us_option','us_future','crypto') THEN 'USD' ELSE 'TWD' END);
    v_unit := COALESCE(NULLIF(btrim(s.quantity_unit), ''), CASE WHEN v_asset_class = 'tw_stock' THEN '張' WHEN v_asset_class IN ('us_option','us_future') THEN '口' WHEN v_asset_class = 'crypto' THEN '顆' ELSE '股' END);
    v_requested := CASE WHEN COALESCE(s.quantity, 0) <= 0 THEN 1 WHEN v_asset_class = 'tw_stock' AND v_unit = '張' THEN s.quantity * 1000 ELSE s.quantity END;
    SELECT pe.quantity_after INTO v_previous FROM public.position_events pe
      WHERE pe.expert_id = s.expert_id AND pe.symbol = v_symbol
      ORDER BY pe.event_at DESC, pe.created_at DESC LIMIT 1;
    v_previous := COALESCE(v_previous, 0);
    IF s.action::text IN ('buy','add') THEN v_delta := v_requested;
    ELSIF s.action::text = 'exit' THEN v_delta := -v_previous;
    ELSE v_delta := -LEAST(v_requested, v_previous);
    END IF;
    v_after := GREATEST(0, v_previous + v_delta);
    INSERT INTO public.position_events (
      expert_id, source_signal_id, symbol, instrument, action, quantity_delta,
      quantity_after, quantity_unit, trade_price, currency, asset_class, event_at, source_kind
    ) VALUES (
      s.expert_id, s.id, v_symbol, s.instrument, s.action::text, v_delta,
      v_after, v_unit, s.price_hint, v_currency, v_asset_class,
      COALESCE(s.published_at, s.executed_at, s.created_at), 'reconstructed'
    ) ON CONFLICT (source_signal_id) DO NOTHING;
  END LOOP;
END;
$$;