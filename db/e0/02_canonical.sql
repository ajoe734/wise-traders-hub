-- E0: canonical writers (only path allowed to mutate economics)

CREATE OR REPLACE FUNCTION app_ledger.canonical_apply_effect(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event uuid := pg_catalog.gen_random_uuid();
  v_action text := p->>'action';
  v_expert uuid := (p->>'expert_id')::uuid;
  v_ikey text := p->>'instrument_key';
  v_market text := p->>'market';
  v_cur text := coalesce(p->>'currency','TWD');
  v_qty int := coalesce((p->>'qty')::int, 0);
  v_price numeric := (p->>'price')::numeric;
  v_fees numeric := coalesce((p->>'fees')::numeric, 0);
  v_eff timestamptz := coalesce((p->>'effective_at')::timestamptz, pg_catalog.now());
  v_prov public.effect_provenance := coalesce((p->>'provenance')::public.effect_provenance,'signal_execution');
  v_reason text := coalesce(p->>'reason','');
  v_logical uuid := coalesce((p->>'logical_effect_id')::uuid, pg_catalog.gen_random_uuid());
  v_signal uuid := (p->>'signal_id')::uuid;
  v_open public.trade_records;
  v_openid uuid; v_closedid uuid; v_cashid uuid;
  v_cash numeric; v_cost numeric; v_realized numeric := 0;
  v_expected int; v_qdelta int;
  v_newopen public.trade_records; v_newclosed public.trade_records;
  v_cashrow app_ledger.portfolio_cash_ledger;
  v_avg numeric;
BEGIN
  IF v_ikey IS NOT NULL THEN
    SELECT * INTO v_open FROM public.trade_records t
     WHERE t.expert_id=v_expert AND t.instrument_key=v_ikey
       AND t.status='open' AND t.quantity > 0
     FOR UPDATE;
  END IF;

  IF v_action IN ('buy','add') THEN
    v_cost := v_qty * v_price; v_cash := -(v_cost) - v_fees; v_qdelta := v_qty;
    v_expected := 2;
  ELSIF v_action IN ('trim','exit') THEN
    IF v_open IS NULL THEN RAISE EXCEPTION 'no_open_position' USING ERRCODE='P0001'; END IF;
    IF v_qty > v_open.quantity THEN RAISE EXCEPTION 'oversell' USING ERRCODE='P0001'; END IF;
    v_avg := v_open.entry_price;
    v_cost := -(v_qty * v_avg);
    v_realized := v_qty * (v_price - v_avg) - v_fees;
    v_cash := v_qty * v_price - v_fees;
    v_qdelta := -v_qty; v_expected := 3;
  ELSIF v_action = 'capital_flow' THEN
    v_cash := (p->>'amount')::numeric; v_cost := 0; v_qdelta := 0; v_expected := 1;
  ELSIF v_action = 'equity_bridge' THEN
    v_cash := (p->>'amount')::numeric; v_cost := 0; v_qdelta := 0; v_expected := 1;
  ELSIF v_action = 'quantity_adjustment' THEN
    IF v_open IS NULL THEN RAISE EXCEPTION 'no_open_position' USING ERRCODE='P0001'; END IF;
    v_cash := NULL; v_qdelta := v_qty;                       -- qty may be +/-
    v_cost := coalesce((p->>'cost_delta')::numeric, v_qty * v_open.entry_price);
    v_expected := 1;
  ELSE
    RAISE EXCEPTION 'unsupported_action: %', v_action USING ERRCODE='P0001';
  END IF;

  INSERT INTO app_ledger.economic_effect(
    event_id, logical_effect_id, expert_id, origin_signal_id, market, instrument,
    instrument_key, action, qty_delta, currency, cash_delta, price, fees, effective_at,
    provenance, actor_via, reason, expected_mutation_count, state)
  VALUES (v_event, v_logical, v_expert, v_signal, v_market, coalesce(p->>'instrument', v_ikey),
    v_ikey, v_action, v_qdelta, v_cur, v_cash, v_price, v_fees, v_eff,
    v_prov, coalesce(p->>'actor_via','canonical'), v_reason, v_expected, 'reserved');

  ------------------------------------------------------------------ position mutations
  IF v_action = 'buy' OR (v_action='add' AND v_open IS NULL) THEN
    v_openid := pg_catalog.gen_random_uuid();
    v_newopen := ROW(v_openid, v_expert, v_market, coalesce(p->>'instrument', v_ikey), v_ikey,
      v_cur, v_qty, v_price, NULL, 'open', v_eff, NULL, v_signal, NULL, NULL, NULL, NULL, NULL);
    INSERT INTO app_ledger.effect_projection_mutation(
      event_id, mutation_seq, target_table, target_row_id, op, row_role, expert_id, currency,
      market, instrument_key, qty_delta, cost_delta, after_hash)
    VALUES (v_event, 1, 'trade_records', v_openid, 'insert', 'open_position', v_expert, v_cur,
      v_market, v_ikey, v_qty, v_cost, app_ledger.tr_econ_hash(v_newopen));
    INSERT INTO public.trade_records VALUES (v_newopen.*);

  ELSIF v_action = 'add' THEN
    v_openid := v_open.id;
    v_avg := (v_open.quantity * v_open.entry_price + v_qty * v_price) / (v_open.quantity + v_qty);
    v_newopen := v_open;
    v_newopen.quantity := v_open.quantity + v_qty;
    v_newopen.entry_price := v_avg;
    INSERT INTO app_ledger.effect_projection_mutation(
      event_id, mutation_seq, target_table, target_row_id, op, row_role, expert_id, currency,
      market, instrument_key, qty_delta, cost_delta, before_hash, after_hash)
    VALUES (v_event, 1, 'trade_records', v_openid, 'update', 'open_position', v_expert, v_cur,
      v_market, v_ikey, v_qty, v_cost,
      app_ledger.tr_econ_hash(v_open), app_ledger.tr_econ_hash(v_newopen));
    UPDATE public.trade_records SET quantity=v_newopen.quantity, entry_price=v_newopen.entry_price
      WHERE id=v_openid;

  ELSIF v_action IN ('trim','exit') THEN
    v_openid := v_open.id;
    v_newopen := v_open;
    v_newopen.quantity := v_open.quantity - v_qty;
    IF v_newopen.quantity = 0 THEN v_newopen.status := 'closed'; v_newopen.exit_date := v_eff; END IF;
    INSERT INTO app_ledger.effect_projection_mutation(
      event_id, mutation_seq, target_table, target_row_id, op, row_role, expert_id, currency,
      market, instrument_key, qty_delta, cost_delta, before_hash, after_hash)
    VALUES (v_event, 1, 'trade_records', v_openid, 'update', 'open_position', v_expert, v_cur,
      v_market, v_ikey, -v_qty, v_cost,
      app_ledger.tr_econ_hash(v_open), app_ledger.tr_econ_hash(v_newopen));
    UPDATE public.trade_records SET quantity=v_newopen.quantity, status=v_newopen.status,
      exit_date=v_newopen.exit_date WHERE id=v_openid;

    v_closedid := pg_catalog.gen_random_uuid();
    v_newclosed := ROW(v_closedid, v_expert, v_market, v_open.instrument, v_ikey, v_cur,
      v_qty, v_avg, v_price, 'closed', v_open.entry_date, v_eff, v_signal, NULL,
      NULL, NULL, NULL, NULL);
    INSERT INTO app_ledger.effect_projection_mutation(
      event_id, mutation_seq, target_table, target_row_id, op, row_role, expert_id, currency,
      market, instrument_key, qty_delta, cost_delta, realized_delta, after_hash)
    VALUES (v_event, 2, 'trade_records', v_closedid, 'insert', 'closed_lot', v_expert, v_cur,
      v_market, v_ikey, v_qty, 0, v_realized, app_ledger.tr_econ_hash(v_newclosed));
    INSERT INTO public.trade_records VALUES (v_newclosed.*);

  ELSIF v_action = 'quantity_adjustment' THEN
    v_openid := v_open.id;
    v_newopen := v_open;
    v_newopen.quantity := v_open.quantity + v_qty;
    INSERT INTO app_ledger.effect_projection_mutation(
      event_id, mutation_seq, target_table, target_row_id, op, row_role, expert_id, currency,
      market, instrument_key, qty_delta, cost_delta, before_hash, after_hash)
    VALUES (v_event, 1, 'trade_records', v_openid, 'update', 'open_position', v_expert, v_cur,
      v_market, v_ikey, v_qty, v_cost,
      app_ledger.tr_econ_hash(v_open), app_ledger.tr_econ_hash(v_newopen));
    UPDATE public.trade_records SET quantity=v_newopen.quantity WHERE id=v_openid;
  END IF;

  ------------------------------------------------------------------ cash leg
  IF v_cash IS NOT NULL THEN
    v_cashid := pg_catalog.gen_random_uuid();
    v_cashrow := ROW(v_cashid, v_expert, v_cur,
      CASE WHEN v_action='capital_flow' THEN 'external_capital_flow'
           WHEN v_action='equity_bridge' THEN 'data_correction_adjustment'
           ELSE 'trade_settlement' END,
      v_cash, v_eff, v_event, pg_catalog.now());
    INSERT INTO app_ledger.effect_projection_mutation(
      event_id, mutation_seq, target_table, target_row_id, op, row_role, expert_id, currency,
      qty_delta, cash_delta, realized_delta, after_hash)
    VALUES (v_event, CASE WHEN v_action IN ('trim','exit') THEN 3 ELSE
                          CASE WHEN v_action IN ('capital_flow','equity_bridge') THEN 1 ELSE 2 END END,
      'portfolio_cash_ledger', v_cashid, 'insert', 'cash_leg', v_expert, v_cur,
      0, v_cash, 0, app_ledger.cash_econ_hash(v_cashrow));
    INSERT INTO app_ledger.portfolio_cash_ledger VALUES (v_cashrow.*);
  END IF;

  UPDATE app_ledger.economic_effect SET state='applied', state_changed_at=pg_catalog.now()
    WHERE event_id=v_event;
  RETURN v_event;
END $$;

REVOKE EXECUTE ON FUNCTION app_ledger.canonical_apply_effect(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_ledger.canonical_review(uuid,text,text,uuid,text) FROM PUBLIC;
