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
  $$INSERT INTO app_ledger.economic_effect(event_id) VALUES (gen_random_uuid())$$,
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
     WHERE id = (SELECT id FROM app_ledger.portfolio_cash_ledger LIMIT 1)$$,
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
           last_mutation_id = v_mut, last_event_id = gen_random_uuid()
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
      "qty_delta":50,"realized_pnl_delta":9999,"expected_mutation_count":1}',
     '[{"row_role":"open_position","qty_delta":50}]')$$,
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
