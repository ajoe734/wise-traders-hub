-- E0: public projection (F1 per-expert active pointer, F2 correction/return semantics)

CREATE TABLE public.public_position_projection (
  projection_version bigint NOT NULL,
  expert_id uuid NOT NULL,
  instrument_key text NOT NULL,
  instrument text NOT NULL,
  market text NOT NULL,
  currency text NOT NULL,
  quantity integer NOT NULL,
  quantity_unit text NOT NULL DEFAULT 'share',
  avg_cost numeric NOT NULL,
  cost_value numeric NOT NULL,
  valuation_price numeric NULL,
  price_as_of date NULL,
  price_source text NULL,
  valuation_status text NOT NULL
    CHECK (valuation_status IN ('valued','stale','unpriced','unsupported')),
  market_value numeric NULL,
  -- E7 fail-closed: a money number may exist only for an actually priced status
  CONSTRAINT ppp_valuation_ck CHECK
    ((market_value IS NOT NULL) = (valuation_status IN ('valued','stale'))),
  fx_rate numeric NULL,
  fx_as_of date NULL,
  fx_source text NULL,
  PRIMARY KEY (projection_version, expert_id, instrument_key)
);

CREATE TABLE public.public_portfolio_state (
  projection_version bigint NOT NULL,
  expert_id uuid NOT NULL,
  currency text NOT NULL,
  starting_capital numeric NOT NULL,
  external_capital_flow_total numeric NOT NULL DEFAULT 0,
  data_correction_adjustment_total numeric NOT NULL DEFAULT 0,
  realized_pnl numeric NOT NULL DEFAULT 0,
  open_cost numeric NOT NULL,
  cash numeric NOT NULL,
  market_value numeric NULL,
  equity numeric NULL,
  incomplete_reason text NULL,
  -- E7 fail-closed: equity is published only when nothing is missing
  CONSTRAINT pps_equity_ck CHECK ((equity IS NULL) = (incomplete_reason IS NOT NULL)),
  PRIMARY KEY (projection_version, expert_id, currency)
);

CREATE TABLE public.public_nav_daily (
  projection_version bigint NOT NULL,
  expert_id uuid NOT NULL,
  currency text NOT NULL,
  trade_date date NOT NULL,
  cash numeric NOT NULL,
  market_value numeric NULL,
  equity numeric NULL,
  external_capital_flow numeric NOT NULL DEFAULT 0,
  data_correction_adjustment numeric NOT NULL DEFAULT 0,
  daily_return numeric NULL,
  price_as_of date NULL,
  fx_as_of date NULL,
  completeness text NOT NULL CHECK (completeness IN ('complete','partial','unavailable')),
  correction_flag boolean NOT NULL DEFAULT false,
  correction_kind text NULL,
  reporting_basis text NOT NULL CHECK (reporting_basis IN ('as_reported','restated')),
  PRIMARY KEY (projection_version, expert_id, currency, trade_date, reporting_basis)
);

-- F1: per-expert active pointer
CREATE TABLE public.public_projection_active (
  expert_id uuid PRIMARY KEY,
  active_version bigint NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now()
);

-- F1: the pointer is monotonic per expert and may only point at a materialised version
CREATE OR REPLACE FUNCTION app_ledger.projection_pointer_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.active_version <= OLD.active_version THEN
    RAISE EXCEPTION 'projection_pointer_regression: % -> %', OLD.active_version, NEW.active_version
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.public_position_projection p
                  WHERE p.expert_id = NEW.expert_id AND p.projection_version = NEW.active_version)
     AND NOT EXISTS (SELECT 1 FROM public.public_portfolio_state s
                  WHERE s.expert_id = NEW.expert_id AND s.projection_version = NEW.active_version)
  THEN
    RAISE EXCEPTION 'projection_pointer_unmaterialised: expert=% version=%',
      NEW.expert_id, NEW.active_version USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_projection_pointer_guard
  BEFORE INSERT OR UPDATE ON public.public_projection_active
  FOR EACH ROW EXECUTE FUNCTION app_ledger.projection_pointer_guard();

CREATE VIEW public.public_position_active AS
  SELECT p.* FROM public.public_position_projection p
  JOIN public.public_projection_active a
    ON a.expert_id = p.expert_id AND a.active_version = p.projection_version;

CREATE VIEW public.public_portfolio_active AS
  SELECT s.* FROM public.public_portfolio_state s
  JOIN public.public_projection_active a
    ON a.expert_id = s.expert_id AND a.active_version = s.projection_version;

CREATE VIEW public.public_nav_active AS
  SELECT n.* FROM public.public_nav_daily n
  JOIN public.public_projection_active a
    ON a.expert_id = n.expert_id AND a.active_version = n.projection_version;

GRANT SELECT ON public.public_position_active, public.public_portfolio_active,
                public.public_nav_active, public.public_projection_active
  TO anon, authenticated, service_role;
REVOKE ALL ON public.public_position_projection, public.public_portfolio_state,
              public.public_nav_daily
  FROM anon, authenticated, service_role, PUBLIC;

-- ---------------------------------------------------------------- valuation helper
CREATE OR REPLACE FUNCTION app_ledger.value_instrument(
  p_ikey text, p_market text, p_as_of date,
  OUT price numeric, OUT price_as_of date, OUT status text)
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_lag int;
BEGIN
  IF p_ikey LIKE '%/%' OR p_ikey LIKE '%+%' THEN     -- US native combo: unsupported
    price := NULL; price_as_of := NULL; status := 'unsupported'; RETURN;
  END IF;
  SELECT d.close_price, d.trade_date INTO price, price_as_of
    FROM public.daily_price_snapshots d
   WHERE d.symbol = pg_catalog.split_part(p_ikey,':',1) AND d.trade_date <= p_as_of
   ORDER BY d.trade_date DESC LIMIT 1;
  IF price IS NULL THEN status := 'unpriced'; RETURN; END IF;
  SELECT pg_catalog.count(*) INTO v_lag
    FROM public.daily_price_snapshots d
   WHERE d.market = p_market AND d.trade_date > price_as_of AND d.trade_date <= p_as_of;
  status := CASE WHEN v_lag > 20 THEN 'unpriced' WHEN v_lag > 5 THEN 'stale' ELSE 'valued' END;
  IF status = 'unpriced' THEN price := NULL; END IF;
END $$;

-- ---------------------------------------------------------------- rebuild + atomic activate
CREATE OR REPLACE FUNCTION app_ledger.canonical_publish(
  p_expert uuid, p_as_of date DEFAULT NULL, p_basis text DEFAULT 'as_reported',
  p_fail boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ver bigint; v_asof date := coalesce(p_as_of, (pg_catalog.now())::date);
  r record; v_prev numeric; v_prev_eq numeric;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('proj:'||p_expert::text, 0));
  v_ver := pg_catalog.nextval('app_ledger.projection_version_seq');

  ------------------------------------------------------------------ positions
  INSERT INTO public.public_position_projection(
    projection_version, expert_id, instrument_key, instrument, market, currency,
    quantity, avg_cost, cost_value, valuation_price, price_as_of, price_source,
    valuation_status, market_value)
  SELECT v_ver, t.expert_id, t.instrument_key, t.instrument, t.market, t.currency,
         t.quantity, t.entry_price, t.quantity*t.entry_price,
         v.price, v.price_as_of, CASE WHEN v.price IS NULL THEN NULL ELSE 'daily_snapshot' END,
         v.status,
         CASE WHEN v.price IS NULL THEN NULL ELSE t.quantity*v.price END
    FROM public.trade_records t
    CROSS JOIN LATERAL app_ledger.value_instrument(t.instrument_key, t.market, v_asof) v
   WHERE t.expert_id = p_expert AND t.status='open' AND t.quantity > 0;

  ------------------------------------------------------------------ portfolio state per currency
  INSERT INTO public.public_portfolio_state(
    projection_version, expert_id, currency, starting_capital,
    external_capital_flow_total, data_correction_adjustment_total, realized_pnl,
    open_cost, cash, market_value, equity, incomplete_reason)
  SELECT v_ver, p_expert, c.currency,
         (SELECT e.starting_capital FROM public.experts e WHERE e.id=p_expert),
         c.ext, c.corr, c.realized, c.open_cost,
         (SELECT e.starting_capital FROM public.experts e WHERE e.id=p_expert) + c.cash_sum,
         c.mv, CASE WHEN c.mv IS NULL THEN NULL ELSE
           (SELECT e.starting_capital FROM public.experts e WHERE e.id=p_expert) + c.cash_sum + c.mv END,
         CASE WHEN c.mv IS NULL THEN 'unpriced_or_unsupported_position' ELSE NULL END
    FROM (
      SELECT cur AS currency,
        coalesce(sum(amount) FILTER (WHERE entry_kind='external_capital_flow'),0) ext,
        coalesce(sum(amount) FILTER (WHERE entry_kind='data_correction_adjustment'),0) corr,
        coalesce(sum(amount),0) cash_sum,
        (SELECT coalesce(sum(m.realized_delta),0) FROM app_ledger.effect_projection_mutation m
          WHERE m.expert_id=p_expert AND m.currency=x.cur) realized,
        (SELECT coalesce(sum(t.quantity*t.entry_price),0) FROM public.trade_records t
          WHERE t.expert_id=p_expert AND t.currency=x.cur AND t.status='open' AND t.quantity>0) open_cost,
        (SELECT CASE WHEN bool_or(pp.market_value IS NULL) THEN NULL ELSE coalesce(sum(pp.market_value),0) END
           FROM public.public_position_projection pp
          WHERE pp.projection_version=v_ver AND pp.expert_id=p_expert AND pp.currency=x.cur) mv
      FROM (SELECT DISTINCT currency cur FROM app_ledger.portfolio_cash_ledger
             WHERE expert_id=p_expert
            UNION SELECT DISTINCT currency FROM public.trade_records
             WHERE expert_id=p_expert) x
      LEFT JOIN app_ledger.portfolio_cash_ledger l
        ON l.expert_id=p_expert AND l.currency=x.cur
      GROUP BY x.cur
    ) c;

  ------------------------------------------------------------------ NAV daily (per currency, per date)
  FOR r IN
    SELECT d.trade_date, cur.currency
      FROM (SELECT DISTINCT effective_at::date trade_date
              FROM app_ledger.economic_effect WHERE expert_id=p_expert
            UNION SELECT DISTINCT trade_date FROM public.daily_price_snapshots
             WHERE trade_date <= v_asof
               AND trade_date >= (SELECT min(effective_at)::date FROM app_ledger.economic_effect
                                   WHERE expert_id=p_expert)) d
      CROSS JOIN (SELECT DISTINCT currency FROM app_ledger.portfolio_cash_ledger
                   WHERE expert_id=p_expert) cur
     WHERE d.trade_date <= v_asof
     ORDER BY d.trade_date
  LOOP
    DECLARE
      v_cash numeric; v_mv numeric; v_eq numeric; v_ext numeric; v_corr numeric;
      v_qadj boolean; v_ret numeric; v_complete text; v_kind text; v_unpriced boolean;
    BEGIN
      SELECT coalesce(sum(amount),0),
             coalesce(sum(amount) FILTER (WHERE entry_kind='external_capital_flow'
                       AND effective_at::date=r.trade_date),0),
             coalesce(sum(amount) FILTER (WHERE entry_kind='data_correction_adjustment'
                       AND effective_at::date=r.trade_date),0)
        INTO v_cash, v_ext, v_corr
        FROM app_ledger.portfolio_cash_ledger
       WHERE expert_id=p_expert AND currency=r.currency AND effective_at::date <= r.trade_date;
      v_cash := v_cash + (SELECT starting_capital FROM public.experts WHERE id=p_expert);

      SELECT coalesce(sum(q.qty * v.price),0),
             bool_or(v.price IS NULL)
        INTO v_mv, v_unpriced
        FROM (SELECT m.instrument_key ikey, m.market mk, sum(m.qty_delta) qty
                FROM app_ledger.effect_projection_mutation m
                JOIN app_ledger.economic_effect e ON e.event_id=m.event_id
               WHERE m.expert_id=p_expert AND m.currency=r.currency
                 AND m.row_role='open_position' AND e.effective_at::date <= r.trade_date
               GROUP BY 1,2 HAVING sum(m.qty_delta) <> 0) q
        CROSS JOIN LATERAL app_ledger.value_instrument(q.ikey, q.mk, r.trade_date) v;
      IF coalesce(v_unpriced,false) THEN v_mv := NULL; END IF;
      v_eq := CASE WHEN v_mv IS NULL THEN NULL ELSE v_cash + v_mv END;

      SELECT EXISTS (SELECT 1 FROM app_ledger.economic_effect e
                      WHERE e.expert_id=p_expert AND e.currency=r.currency
                        AND e.effective_at::date=r.trade_date
                        AND e.provenance='quantity_adjustment')
        INTO v_qadj;

      SELECT n.equity INTO v_prev_eq FROM public.public_nav_daily n
       WHERE n.projection_version=v_ver AND n.expert_id=p_expert AND n.currency=r.currency
         AND n.trade_date < r.trade_date AND n.reporting_basis=p_basis
       ORDER BY n.trade_date DESC LIMIT 1;

      IF p_basis='as_reported' AND v_qadj THEN
        v_ret := NULL; v_complete := 'partial'; v_kind := 'quantity_adjustment';
      ELSIF v_eq IS NULL OR v_prev_eq IS NULL OR v_prev_eq = 0 THEN
        v_ret := NULL;
        v_complete := CASE WHEN v_eq IS NULL THEN 'unavailable' ELSE 'complete' END;
        v_kind := CASE WHEN v_corr <> 0 THEN 'equity_bridge' ELSE NULL END;
      ELSE
        v_ret := (v_eq - v_prev_eq - v_ext
                  - CASE WHEN p_basis='as_reported' THEN v_corr ELSE 0 END) / v_prev_eq;
        v_complete := 'complete';
        v_kind := CASE WHEN v_corr <> 0 THEN 'equity_bridge' ELSE NULL END;
      END IF;

      INSERT INTO public.public_nav_daily(
        projection_version, expert_id, currency, trade_date, cash, market_value, equity,
        external_capital_flow, data_correction_adjustment, daily_return, price_as_of,
        completeness, correction_flag, correction_kind, reporting_basis)
      VALUES (v_ver, p_expert, r.currency, r.trade_date, v_cash, v_mv, v_eq,
        v_ext, v_corr, v_ret, r.trade_date, v_complete,
        (v_qadj OR v_corr <> 0), v_kind, p_basis);
    END;
  END LOOP;

  IF p_fail THEN RAISE EXCEPTION 'simulated_replay_failure' USING ERRCODE='P0001'; END IF;

  INSERT INTO public.public_projection_active(expert_id, active_version)
  VALUES (p_expert, v_ver)
  ON CONFLICT (expert_id) DO UPDATE
    SET active_version = EXCLUDED.active_version, activated_at = pg_catalog.now()
    WHERE public.public_projection_active.active_version < EXCLUDED.active_version;

  RETURN v_ver;
END $$;

REVOKE EXECUTE ON FUNCTION app_ledger.canonical_publish(uuid,date,text,boolean) FROM PUBLIC;
