-- E0 anti-cheat negative suite: one machine-decidable negative per protection class.
-- Every case asserts (a) an error IS raised, (b) exact SQLSTATE, (c) the failure reason
-- string is hit. Wrong error class => FAIL (never counted as PASS).

-- ---------------------------------------------------------------- (1) privilege
CREATE OR REPLACE FUNCTION t.expect_error_as(p_name text, p_role text, p_sql text,
                                             p_needle text, p_sqlstate text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_msg text; v_state text; v_pass boolean := false; v_detail text := 'no error raised';
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql;
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'e0_rollback_marker' USING ERRCODE='P0002';
  EXCEPTION
    WHEN SQLSTATE 'P0002' THEN v_pass := false; v_state := NULL;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
      v_pass := position(p_needle in v_msg) > 0 AND v_state = p_sqlstate;
      v_detail := v_state||': '||v_msg;
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO t.result(name,passed,detail,kind,expected_sqlstate,actual_sqlstate,expected_needle)
  VALUES (p_name, v_pass, v_detail, 'negative', p_sqlstate, v_state, p_needle);
END $$;

SELECT t.expect_error_as('NEG.privilege.service_role_qty_dml','service_role',
  $$UPDATE public.trade_records SET quantity = quantity + 1 WHERE status='open'$$,
  'permission denied', '42501');
SELECT t.expect_error_as('NEG.privilege.service_role_effect_insert','service_role',
  $$INSERT INTO app_ledger.economic_effect(event_id, expert_id, action, state,
      expected_mutation_count, effective_at, provenance, reason, actor_via, currency,
      logical_effect_id, qty_delta)
    VALUES (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001','add','reserved',0,
      now(),'signal_execution','x','test','TWD',gen_random_uuid(),0)$$,
  'permission denied', '42501');
SELECT t.expect_error_as('NEG.privilege.authenticated_cash_ledger_read','authenticated',
  $$SELECT 1 FROM app_ledger.portfolio_cash_ledger LIMIT 1$$,
  'permission denied', '42501');
SELECT t.expect_error_as('NEG.privilege.anon_reads_raw_projection','anon',
  $$SELECT 1 FROM public.public_position_projection LIMIT 1$$,
  'permission denied', '42501');
SELECT t.expect_error_as('NEG.privilege.service_role_executes_canonical','service_role',
  $$SELECT app_ledger.canonical_publish('aaaaaaaa-0000-0000-0000-000000000001'::uuid, CURRENT_DATE)$$,
  'permission denied', '42501');

-- an old SECURITY DEFINER writer owned by a non-ledger role must not bypass the guard
CREATE OR REPLACE FUNCTION public.legacy_secdef_writer(p_expert uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.trade_records SET quantity = quantity + 1
   WHERE expert_id = p_expert AND status = 'open';
END $$;
ALTER FUNCTION public.legacy_secdef_writer(uuid) OWNER TO service_role;

SELECT t.expect_error_as('NEG.privilege.legacy_secdef_writer_cannot_bypass','service_role',
  $$SELECT public.legacy_secdef_writer('aaaaaaaa-0000-0000-0000-000000000001'::uuid)$$,
  'permission denied', '42501');

-- positive control for the exact price-only whitelist (proves the deny above is not blanket)
DO $$
DECLARE v_msg text; v_state text;
BEGIN
  SET LOCAL ROLE service_role;
  UPDATE public.trade_records SET current_price = 999, price_updated_at = now()
   WHERE status = 'open';
  RESET ROLE;
  PERFORM t.ok('POS.privilege.service_role_price_only_allowed', true);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
  RESET ROLE;
  PERFORM t.ok('POS.privilege.service_role_price_only_allowed', false, v_state||': '||v_msg);
END $$;

-- ---------------------------------------------------------------- (2) append-only
SELECT t.expect_error('NEG.append_only.effect_payload_update',
  $$UPDATE app_ledger.economic_effect SET qty_delta = qty_delta + 1
     WHERE event_id = (SELECT event_id FROM app_ledger.economic_effect LIMIT 1)$$,
  'effect_payload_immutable', 'P0001');
SELECT t.expect_error('NEG.append_only.effect_delete',
  $$DELETE FROM app_ledger.economic_effect
     WHERE event_id = (SELECT event_id FROM app_ledger.economic_effect LIMIT 1)$$,
  'effect_delete_forbidden', 'P0001');
SELECT t.expect_error('NEG.append_only.cash_ledger_update',
  $$UPDATE app_ledger.portfolio_cash_ledger SET amount = amount + 1
     WHERE cash_entry_id = (SELECT cash_entry_id FROM app_ledger.portfolio_cash_ledger LIMIT 1)$$,
  'cash_ledger_append_only', 'P0001');
SELECT t.expect_error('NEG.append_only.review_event_update',
  $$UPDATE app_ledger.effect_review_event SET review_state = 'cleared'
     WHERE review_no = (SELECT min(review_no) FROM app_ledger.effect_review_event)$$,
  'review_event_append_only', 'P0001');

-- ---------------------------------------------------------------- (3) mutation hash / token binding
SELECT t.expect_error('NEG.hash.direct_qty_update_without_token',
  $$UPDATE public.trade_records SET quantity = quantity + 1 WHERE status='open'$$,
  'unauthorized_trade_records_mutation', 'P0001');

-- a token minted for row X cannot authorise a write to row Y (hash binds the target row)
DO $$
DECLARE v_ev uuid; v_mut uuid; v_other uuid; v_msg text; v_state text; v_pass boolean := false;
BEGIN
  SELECT m.mutation_id, m.target_row_id INTO v_mut, v_other
    FROM app_ledger.effect_projection_mutation m
    JOIN public.trade_records r ON r.id = m.target_row_id
   WHERE m.op = 'update' LIMIT 1;
  BEGIN
    UPDATE public.trade_records SET quantity = quantity + 1,
           last_projection_mutation_id = v_mut, last_event_id = gen_random_uuid()
     WHERE id <> v_other AND status = 'open';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_pass := v_state = 'P0001'
      AND position('unauthorized_trade_records_mutation' in v_msg) > 0;
  END;
  INSERT INTO t.result(name,passed,detail,kind,expected_sqlstate,actual_sqlstate,expected_needle)
  VALUES ('NEG.hash.token_replay_on_other_row', v_pass,
          coalesce(v_state||': '||v_msg,'no error raised'), 'negative', 'P0001', v_state,
          'unauthorized_trade_records_mutation');
END $$;

-- a token with the correct before_hash but a wrong after_hash cannot authorise the write
DO $$
DECLARE v_ev uuid := gen_random_uuid(); v_row uuid; v_before text;
        v_mut uuid; v_msg text; v_state text; v_pass boolean := false;
BEGIN
  SELECT id INTO v_row FROM public.trade_records
   WHERE status='open' AND expert_id='aaaaaaaa-0000-0000-0000-000000000001' LIMIT 1;
  SELECT app_ledger.tr_econ_hash(r.*) INTO v_before FROM public.trade_records r WHERE r.id=v_row;

  INSERT INTO app_ledger.economic_effect(
      event_id, logical_effect_id, expert_id, market, instrument, instrument_key, currency,
      action, qty_delta, cash_delta, effective_at, provenance, reason, actor_via,
      state, expected_mutation_count)
  VALUES (v_ev, gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001',
      'TW','2330','2330:TW','TWD','add', 1, NULL, now(), 'signal_execution',
      'hash tamper','test','applied', 1);

  INSERT INTO app_ledger.effect_projection_mutation(
      event_id, mutation_seq, target_table, target_row_id, op, row_role, expert_id,
      market, instrument_key, currency, qty_delta, before_hash, after_hash)
  VALUES (v_ev, 1, 'trade_records', v_row, 'update', 'open_position',
      'aaaaaaaa-0000-0000-0000-000000000001','TW','2330:TW','TWD', 1,
      v_before, 'deadbeef_not_the_real_after_hash')
  RETURNING mutation_id INTO v_mut;

  BEGIN
    UPDATE public.trade_records SET quantity = quantity + 1 WHERE id = v_row;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_pass := v_state='P0001' AND position('unauthorized_trade_records_mutation' in v_msg) > 0;
  END;
  INSERT INTO t.result(name,passed,detail,kind,expected_sqlstate,actual_sqlstate,expected_needle)
  VALUES ('NEG.hash.after_hash_mismatch_rejected', v_pass,
          coalesce(v_state||': '||v_msg,'no error raised'), 'negative','P0001', v_state,
          'unauthorized_trade_records_mutation');

  -- control: the same token with the correct after_hash DOES authorise exactly this write
  UPDATE app_ledger.effect_projection_mutation SET after_hash = (
    SELECT app_ledger.tr_econ_hash(x.*) FROM (
      SELECT r.* FROM public.trade_records r WHERE r.id=v_row) x)
   WHERE mutation_id = v_mut;
  UPDATE app_ledger.effect_projection_mutation SET after_hash = (
    SELECT pg_catalog.md5(((pg_catalog.to_jsonb(r) || jsonb_build_object('quantity', r.quantity+1))
      - 'current_price' - 'price_updated_at' - 'updated_at'
      - 'last_event_id' - 'last_projection_mutation_id')::text)
      FROM public.trade_records r WHERE r.id=v_row)
   WHERE mutation_id = v_mut;
  BEGIN
    UPDATE public.trade_records SET quantity = quantity + 1 WHERE id = v_row;
    PERFORM t.ok('POS.hash.correct_after_hash_authorises_write',
      (SELECT consumed FROM app_ledger.effect_projection_mutation WHERE mutation_id=v_mut));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    PERFORM t.ok('POS.hash.correct_after_hash_authorises_write', false, v_state||': '||v_msg);
  END;
END $$;

-- ---------------------------------------------------------------- (4) per-expert pointer
SELECT t.expect_error('NEG.pointer.version_regression',
  $$UPDATE public.public_projection_active
       SET active_version = active_version - 1
     WHERE expert_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'projection_pointer_regression', 'P0001');
SELECT t.expect_error('NEG.pointer.unmaterialised_version',
  $$UPDATE public.public_projection_active
       SET active_version = active_version + 10000
     WHERE expert_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'projection_pointer_unmaterialised', 'P0001');
SELECT t.expect_error('NEG.pointer.foreign_expert_activation',
  $$INSERT INTO public.public_projection_active(expert_id, active_version)
    VALUES ('77777777-0000-0000-0000-000000000077',
            (SELECT max(projection_version) FROM public.public_position_projection))$$,
  'projection_pointer_unmaterialised', 'P0001');

-- ---------------------------------------------------------------- (5) correction accounting
-- quantity_adjustment must be cash-neutral: any cash movement is rejected
SELECT t.expect_error('NEG.correction.qadj_with_cash_delta',
  $$SELECT t.forge('{"action":"quantity_adjustment","provenance":"quantity_adjustment",
      "qty_delta":50,"cash_delta":-500,"expected_mutation_count":2}',
     '[{"row_role":"open_position","qty_delta":50},
       {"row_role":"cash_leg","target_table":"portfolio_cash_ledger","op":"insert","cash_delta":-500}]')$$,
  'quantity_adjustment_must_be_cash_neutral', 'P0001');
-- quantity_adjustment must not manufacture realized P&L
SELECT t.expect_error('NEG.correction.qadj_fake_realized_pnl',
  $$SELECT t.forge('{"action":"quantity_adjustment","provenance":"quantity_adjustment",
      "qty_delta":50,"expected_mutation_count":1}',
     '[{"row_role":"open_position","qty_delta":50,"realized_delta":9999}]')$$,
  'quantity_adjustment_must_not_create_pnl', 'P0001');
-- equity_bridge must move cash by exactly the declared amount
SELECT t.expect_error('NEG.correction.bridge_cash_mismatch',
  $$SELECT t.forge('{"action":"capital_flow","provenance":"equity_bridge","instrument_key":null,
      "qty_delta":0,"cash_delta":5000,"expected_mutation_count":1}',
     '[{"row_role":"cash_leg","target_table":"portfolio_cash_ledger","op":"insert","cash_delta":4000}]')$$,
  'cash_delta_mismatch', 'P0001');
-- equity_bridge may never move quantity
SELECT t.expect_error('NEG.correction.bridge_moves_quantity',
  $$SELECT t.forge('{"action":"capital_flow","provenance":"equity_bridge",
      "qty_delta":10,"cash_delta":5000,"expected_mutation_count":2}',
     '[{"row_role":"open_position","qty_delta":10},
       {"row_role":"cash_leg","target_table":"portfolio_cash_ledger","op":"insert","cash_delta":5000}]')$$,
  'equity_bridge_must_not_move_quantity', 'P0001');

-- ---------------------------------------------------------------- (6) unsupported valuation
SELECT t.expect_error('NEG.valuation.unsupported_with_market_value',
  $$INSERT INTO public.public_position_projection(projection_version, expert_id, instrument_key,
      instrument, market, currency, quantity, avg_cost, cost_value, valuation_status, market_value)
    VALUES (999999,'cccccccc-0000-0000-0000-000000000003','LUNR 11/8P + 16/19C',
            'LUNR','US','USD',1,10,10,'unsupported',123)$$,
  'ppp_valuation_ck', '23514');
SELECT t.expect_error('NEG.valuation.valued_without_market_value',
  $$INSERT INTO public.public_position_projection(projection_version, expert_id, instrument_key,
      instrument, market, currency, quantity, avg_cost, cost_value, valuation_status, market_value)
    VALUES (999999,'aaaaaaaa-0000-0000-0000-000000000001','2330:TW',
            '2330','TW','TWD',1,10,10,'valued',NULL)$$,
  'ppp_valuation_ck', '23514');
SELECT t.expect_error('NEG.valuation.equity_published_while_incomplete',
  $$INSERT INTO public.public_portfolio_state(projection_version, expert_id, currency,
      starting_capital, open_cost, cash, equity, incomplete_reason)
    VALUES (999999,'cccccccc-0000-0000-0000-000000000003','USD',100000,10,10,12345,
            'unsupported_instrument')$$,
  'pps_equity_ck', '23514');

-- ============================================================ same-row multi-step hash chain (D-req)
-- Helper: forge a 2-step event that mutates ONE trade_records row twice.
-- p_chain=true  -> seq2.before_hash = seq1.after_hash (legal chain)
-- p_chain=false -> seq2.before_hash = seq1.before_hash (stale/replayed chain)
CREATE OR REPLACE FUNCTION t.two_step_same_row(p_chain boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE r public.trade_records; v_ev uuid := gen_random_uuid();
        h0 text; h1 text; h2 text; r1 public.trade_records; r2 public.trade_records;
BEGIN
  SELECT * INTO r FROM public.trade_records
   WHERE status='open' AND expert_id='aaaaaaaa-0000-0000-0000-000000000001' LIMIT 1;
  r1 := r; r1.quantity := r.quantity + 10; r1.last_event_id := NULL; r1.last_projection_mutation_id := NULL;
  r2 := r1; r2.quantity := r1.quantity + 10;
  h0 := app_ledger.tr_econ_hash(r); h1 := app_ledger.tr_econ_hash(r1); h2 := app_ledger.tr_econ_hash(r2);

  INSERT INTO app_ledger.economic_effect(event_id, logical_effect_id, expert_id, market,
    instrument_key, action, qty_delta, currency, effective_at, provenance, actor_via, reason,
    expected_mutation_count, state)
  VALUES (v_ev, gen_random_uuid(), r.expert_id, r.market, r.instrument_key,
    'quantity_adjustment', 20, r.currency, now(), 'quantity_adjustment', 'test',
    'two step same row', 2, 'applied');

  INSERT INTO app_ledger.effect_projection_mutation(event_id, mutation_seq, target_table,
    target_row_id, op, row_role, expert_id, currency, market, instrument_key,
    qty_delta, before_hash, after_hash)
  VALUES (v_ev, 1, 'trade_records', r.id, 'update', 'open_position', r.expert_id, r.currency,
          r.market, r.instrument_key, 10, h0, h1),
         (v_ev, 2, 'trade_records', r.id, 'update', 'open_position', r.expert_id, r.currency,
          r.market, r.instrument_key, 10, CASE WHEN p_chain THEN h1 ELSE h0 END, h2);

  UPDATE public.trade_records SET quantity = quantity + 10 WHERE id = r.id;
  UPDATE public.trade_records SET quantity = quantity + 10 WHERE id = r.id;

  IF (SELECT quantity FROM public.trade_records WHERE id=r.id) <> r.quantity + 20 THEN
    RAISE EXCEPTION 'two_step_quantity_wrong' USING ERRCODE='P0001'; END IF;
  IF (SELECT count(*) FROM app_ledger.effect_projection_mutation
       WHERE event_id=v_ev AND consumed) <> 2 THEN
    RAISE EXCEPTION 'two_step_tokens_not_consumed' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_ledger.effect_projection_mutation a
                   JOIN app_ledger.effect_projection_mutation b
                     ON b.event_id=a.event_id AND b.mutation_seq=a.mutation_seq+1
                    AND b.target_row_id=a.target_row_id
                  WHERE a.event_id=v_ev AND b.before_hash = a.after_hash) THEN
    RAISE EXCEPTION 'two_step_chain_not_linked' USING ERRCODE='P0001'; END IF;
END $fn$;

SELECT t.expect_ok('POS.hash.same_row_two_step_chain_accepted',
  $$SELECT t.two_step_same_row(true)$$);
SELECT t.expect_error('NEG.hash.same_row_stale_chain_rejected',
  $$SELECT t.two_step_same_row(false)$$,
  'unauthorized_trade_records_mutation', 'P0001');
