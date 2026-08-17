-- E0 test suite (ephemeral cluster only). Run after 11_fixture.sql.
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
\set C '''cccccccc-0000-0000-0000-000000000003'''

-- =============================================================== E6 roles / privileges
SELECT t.ok('E6.create_role_capability',
  (SELECT count(*)=4 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','ledger_owner')),
  'CREATE ROLE works in disposable cluster');

SELECT t.ok('E6.no_public_execute_canonical_apply',
  (SELECT NOT coalesce(array_to_string(proacl,',') LIKE '%=X/%', false)
     FROM pg_proc WHERE proname='canonical_apply_effect'));
SELECT t.ok('E6.no_public_execute_canonical_publish',
  (SELECT NOT coalesce(array_to_string(proacl,',') LIKE '%=X/%', false)
     FROM pg_proc WHERE proname='canonical_publish'));
SELECT t.ok('E6.no_public_execute_canonical_review',
  (SELECT NOT coalesce(array_to_string(proacl,',') LIKE '%=X/%', false)
     FROM pg_proc WHERE proname='canonical_review'));
SELECT t.ok('E6.definer_search_path_empty',
  (SELECT bool_and('search_path=' = ANY(proconfig)) FROM pg_proc
    WHERE proname IN ('canonical_apply_effect','canonical_publish','canonical_review',
                      'trade_records_economic_guard','cash_ledger_guard','tr_econ_hash')));
SELECT t.ok('E6.service_role_cannot_write_trade_records',
  NOT has_table_privilege('service_role','public.trade_records','INSERT')
  AND NOT has_table_privilege('service_role','public.trade_records','DELETE'));
SELECT t.ok('E6.service_role_price_column_update_only',
  has_column_privilege('service_role','public.trade_records','current_price','UPDATE')
  AND NOT has_column_privilege('service_role','public.trade_records','quantity','UPDATE'));
SELECT t.ok('E6.ledger_schema_not_exposed',
  NOT has_schema_privilege('authenticated','app_ledger','USAGE')
  AND NOT has_schema_privilege('service_role','app_ledger','USAGE'));
SELECT t.ok('E6.public_base_tables_not_readable',
  NOT has_table_privilege('anon','public.public_position_projection','SELECT')
  AND has_table_privilege('anon','public.public_position_active','SELECT'));

-- shadow-object negative test: definer functions must ignore a shadowing search_path object
CREATE SCHEMA IF NOT EXISTS evil;
CREATE OR REPLACE FUNCTION evil.tr_econ_hash(r public.trade_records) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT 'pwned' $$;
SET search_path = evil, public;
SELECT t.ok('E6.shadow_object_ignored',
  app_ledger.tr_econ_hash(tr.*) <> 'pwned') FROM public.trade_records tr LIMIT 1;
RESET search_path;

-- =============================================================== E3 guard whitelist
SELECT t.expect_ok('E3.price_only_fast_path',
  $$UPDATE public.trade_records SET current_price=999, price_updated_at=now()
     WHERE status='open'$$);
SELECT t.expect_error('E3.qty_direct_update_blocked',
  $$UPDATE public.trade_records SET quantity=quantity+50 WHERE instrument_key='2330:TW' AND status='open'$$,
  'unauthorized_trade_records_mutation');
SELECT t.expect_error('E3.signal_id_change_blocked',
  $$UPDATE public.trade_records SET signal_id=gen_random_uuid() WHERE status='open'$$,
  'unauthorized_trade_records_mutation');
SELECT t.expect_error('E3.last_mutation_id_change_blocked',
  $$UPDATE public.trade_records SET last_projection_mutation_id=gen_random_uuid() WHERE status='open'$$,
  'unauthorized_trade_records_mutation');
SELECT t.expect_error('E3.last_event_id_change_blocked',
  $$UPDATE public.trade_records SET last_event_id=gen_random_uuid() WHERE status='open'$$,
  'unauthorized_trade_records_mutation');
SELECT t.expect_error('E3.pnl_percent_change_blocked',
  $$UPDATE public.trade_records SET pnl_percent=99 WHERE status='open'$$,
  'unauthorized_trade_records_mutation');
SELECT t.expect_error('E3.price_plus_qty_blocked',
  $$UPDATE public.trade_records SET current_price=1, quantity=quantity+1 WHERE status='open'$$,
  'unauthorized_trade_records_mutation');
SELECT t.expect_error('E3.direct_insert_blocked',
  $$INSERT INTO public.trade_records(expert_id,market,instrument,instrument_key,currency,
      quantity,entry_price,status,entry_date)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001','TW','x','X:TW','TWD',1,1,'open',now())$$,
  'unauthorized_trade_records_mutation');
SELECT t.expect_error('E3.direct_delete_blocked',
  $$DELETE FROM public.trade_records WHERE status='open'$$,
  'unauthorized_trade_records_mutation');
SELECT t.expect_error('E3.cash_ledger_direct_insert_blocked',
  $$INSERT INTO app_ledger.portfolio_cash_ledger(expert_id,currency,entry_kind,amount,
      effective_at,event_id)
    SELECT 'aaaaaaaa-0000-0000-0000-000000000001','TWD','external_capital_flow',1,now(),event_id
      FROM app_ledger.economic_effect LIMIT 1$$,
  'unauthorized_cash_ledger_mutation');
SELECT t.expect_error('E3.cash_ledger_update_blocked',
  $$UPDATE app_ledger.portfolio_cash_ledger SET amount=0$$, 'cash_ledger_append_only');
SELECT t.expect_error('E3.cash_ledger_delete_blocked',
  $$DELETE FROM app_ledger.portfolio_cash_ledger$$, 'cash_ledger_append_only');

-- =============================================================== E1 semantic invariants
-- helper that forges an effect + tokens (already "consumed") to exercise the deferred trigger
CREATE OR REPLACE FUNCTION t.forge(p_over jsonb DEFAULT '{}'::jsonb, p_tokens jsonb DEFAULT '[]'::jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_event uuid := gen_random_uuid(); tk jsonb; i int := 0;
BEGIN
  INSERT INTO app_ledger.economic_effect(event_id, logical_effect_id, expert_id, market,
    instrument_key, action, qty_delta, currency, cash_delta, effective_at, provenance,
    actor_via, reason, expected_mutation_count, state)
  VALUES (v_event, gen_random_uuid(),
    coalesce((p_over->>'expert_id')::uuid,'aaaaaaaa-0000-0000-0000-000000000001'),
    coalesce(p_over->>'market','TW'), coalesce(p_over->>'instrument_key','2330:TW'),
    coalesce(p_over->>'action','trim'), coalesce((p_over->>'qty_delta')::int, -100),
    coalesce(p_over->>'currency','TWD'), (p_over->>'cash_delta')::numeric,
    now(), 'quantity_adjustment', 'test', 'forge',
    coalesce((p_over->>'expected_mutation_count')::int, jsonb_array_length(p_tokens)), 'applied');
  FOR tk IN SELECT * FROM jsonb_array_elements(p_tokens) LOOP
    i := i + 1;
    INSERT INTO app_ledger.effect_projection_mutation(event_id, mutation_seq, target_table,
      target_row_id, op, row_role, expert_id, currency, market, instrument_key,
      qty_delta, cash_delta, cost_delta, realized_delta, before_hash, after_hash, consumed)
    VALUES (v_event, coalesce((tk->>'seq')::int, i),
      coalesce(tk->>'target_table','trade_records'), gen_random_uuid(),
      coalesce(tk->>'op','update'), coalesce(tk->>'row_role','open_position'),
      coalesce((tk->>'expert_id')::uuid,'aaaaaaaa-0000-0000-0000-000000000001'),
      coalesce(tk->>'currency','TWD'),
      CASE WHEN coalesce(tk->>'row_role','open_position')='cash_leg' THEN NULL
           ELSE coalesce(tk->>'market','TW') END,
      CASE WHEN coalesce(tk->>'row_role','open_position')='cash_leg' THEN NULL
           ELSE coalesce(tk->>'instrument_key','2330:TW') END,
      coalesce((tk->>'qty_delta')::int,0), (tk->>'cash_delta')::numeric,
      coalesce((tk->>'cost_delta')::numeric,0), coalesce((tk->>'realized_delta')::numeric,0),
      CASE WHEN coalesce(tk->>'op','update')='insert' THEN NULL ELSE 'BEFORE' END,
      'AFTER', true);
  END LOOP;
END $$;

SELECT t.expect_error('E1.closed_lot_positive_qty_mismatch',
  $$SELECT t.forge('{"qty_delta":-100}',
     '[{"row_role":"open_position","qty_delta":-100},
       {"row_role":"closed_lot","op":"insert","qty_delta":50}]')$$,
  'closed_lot_reclass_mismatch');
SELECT t.expect_error('E1.open_minus30_closed_plus50',
  $$SELECT t.forge('{"qty_delta":-30}',
     '[{"row_role":"open_position","qty_delta":-30},
       {"row_role":"closed_lot","op":"insert","qty_delta":50}]')$$,
  'closed_lot_reclass_mismatch');
SELECT t.expect_error('E1.cash_delta_mismatch',
  $$SELECT t.forge('{"action":"buy","qty_delta":100,"cash_delta":-1000}',
     '[{"row_role":"open_position","op":"insert","qty_delta":100},
       {"row_role":"cash_leg","op":"insert","target_table":"portfolio_cash_ledger","cash_delta":-999}]')$$,
  'cash_delta_mismatch');
SELECT t.expect_error('E1.unexpected_cash_leg',
  $$SELECT t.forge('{"action":"quantity_adjustment","qty_delta":10}',
     '[{"row_role":"open_position","qty_delta":10},
       {"row_role":"cash_leg","op":"insert","target_table":"portfolio_cash_ledger","cash_delta":500}]')$$,
  'unexpected_cash_leg');
SELECT t.expect_error('E1.token_context_currency_mismatch',
  $$SELECT t.forge('{"action":"quantity_adjustment","qty_delta":10}',
     '[{"row_role":"open_position","qty_delta":10,"currency":"USD"}]')$$,
  'effect_token_context_mismatch');
SELECT t.expect_error('E1.open_qty_delta_mismatch',
  $$SELECT t.forge('{"action":"quantity_adjustment","qty_delta":10}',
     '[{"row_role":"open_position","qty_delta":11}]')$$,
  'open_qty_delta_mismatch');
SELECT t.expect_error('E1.mutation_count_mismatch',
  $$SELECT t.forge('{"action":"quantity_adjustment","qty_delta":10,"expected_mutation_count":3}',
     '[{"row_role":"open_position","qty_delta":10}]')$$,
  'effect_mutation_set_mismatch');
SELECT t.expect_error('E1.mutation_seq_gap',
  $$SELECT t.forge('{"action":"quantity_adjustment","qty_delta":10}',
     '[{"row_role":"open_position","qty_delta":10,"seq":1},
       {"row_role":"open_position","qty_delta":0,"seq":5}]')$$,
  'effect_mutation_seq_gap');
SELECT t.expect_error('E1.closed_lot_cost_conservation',
  $$SELECT t.forge('{"action":"trim","qty_delta":-100,"cash_delta":12000,"expected_mutation_count":3}',
     '[{"row_role":"open_position","qty_delta":-100,"cost_delta":-10500},
       {"row_role":"closed_lot","op":"insert","qty_delta":100,"realized_delta":99999},
       {"row_role":"cash_leg","op":"insert","target_table":"portfolio_cash_ledger","cash_delta":12000}]')$$,
  'closed_lot_conservation_violation');

-- =============================================================== E2 multi-step in one transaction
SELECT t.expect_ok('E2.buy_add_trim_same_transaction', $$
  SELECT app_ledger.canonical_apply_effect(jsonb_build_object('action','buy','expert_id',
    'bbbbbbbb-0000-0000-0000-000000000002','instrument_key','3008:TW','instrument','3008',
    'market','TW','currency','TWD','qty',100,'price',10,'reason','x'));
  SELECT app_ledger.canonical_apply_effect(jsonb_build_object('action','add','expert_id',
    'bbbbbbbb-0000-0000-0000-000000000002','instrument_key','3008:TW','instrument','3008',
    'market','TW','currency','TWD','qty',100,'price',20,'reason','x'));
  SELECT app_ledger.canonical_apply_effect(jsonb_build_object('action','trim','expert_id',
    'bbbbbbbb-0000-0000-0000-000000000002','instrument_key','3008:TW','instrument','3008',
    'market','TW','currency','TWD','qty',50,'price',30,'reason','x'));
$$);

-- =============================================================== E4 append-only economic_effect
DO $$
DECLARE col text; v_msg text; v_bad text := '';
BEGIN
  FOR col IN SELECT column_name FROM information_schema.columns
              WHERE table_schema='app_ledger' AND table_name='economic_effect'
                AND column_name NOT IN ('state','visible_at','state_changed_at')
  LOOP
    BEGIN
      EXECUTE format('UPDATE app_ledger.economic_effect SET %I = %s WHERE true',
        col, CASE
          WHEN col IN ('qty_delta','event_version','expected_mutation_count','generation','effect_no')
            THEN '999'
          WHEN col IN ('cash_delta','price','fees') THEN '123.45'
          WHEN col IN ('effective_at','recorded_at') THEN 'now()'
          WHEN col='provenance' THEN '''break_glass''::public.effect_provenance'
          WHEN col LIKE '%_id' THEN 'gen_random_uuid()'
          ELSE '''tampered'''
        END);
      v_bad := v_bad || col || ' ';
      RAISE EXCEPTION 'rollback' USING ERRCODE='P0002';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      IF v_msg = 'rollback' THEN NULL;
      ELSIF position('effect_payload_immutable' in v_msg) = 0
        AND position('cannot' in v_msg) = 0 AND position('invalid' in v_msg) = 0 THEN
        v_bad := v_bad || col || '(' || v_msg || ') ';
      END IF;
    END;
  END LOOP;
  PERFORM t.ok('E4.all_payload_columns_immutable', v_bad = '', v_bad);
END $$;

SELECT t.expect_error('E4.delete_effect_forbidden',
  $$DELETE FROM app_ledger.economic_effect$$, 'effect_delete_forbidden');
SELECT t.expect_error('E4.illegal_state_applied_to_reserved',
  $$UPDATE app_ledger.economic_effect SET state='reserved' WHERE state='applied'$$,
  'effect_illegal_state_transition');
SELECT t.expect_error('E4.illegal_state_applied_to_failed',
  $$UPDATE app_ledger.economic_effect SET state='failed' WHERE state='applied'$$,
  'effect_illegal_state_transition');
SELECT t.expect_ok('E4.legal_state_applied_to_superseded',
  $$UPDATE app_ledger.economic_effect SET state='superseded' WHERE state='applied'$$);
SELECT t.expect_error('E4.publish_requires_applied_state',
  $$UPDATE app_ledger.economic_effect SET state='superseded', visible_at=now() WHERE state='applied'$$,
  'publish_requires_applied_state');
SELECT t.expect_ok('E4.first_publish_sets_visible_at',
  $$UPDATE app_ledger.economic_effect SET visible_at=now() WHERE state='applied'$$);
SELECT t.expect_error('E4.visible_at_immutable_once_set',
  $$UPDATE app_ledger.economic_effect SET visible_at=now() WHERE state='applied';
    UPDATE app_ledger.economic_effect SET visible_at=now()+interval '1 day' WHERE state='applied'$$,
  'visible_at_immutable_once_set');

-- =============================================================== E5 logical id / signal delete
SELECT t.expect_error('E5.delete_applied_signal_forbidden', $$
  UPDATE public.expert_signals SET status='published' WHERE id='11111111-0000-0000-0000-000000000001';
  INSERT INTO app_ledger.economic_effect(event_id, logical_effect_id, expert_id, action,
    qty_delta, currency, effective_at, provenance, actor_via, reason,
    expected_mutation_count, state)
  SELECT gen_random_uuid(), s.logical_effect_id, s.expert_id, 'buy', 0, 'TWD', now(),
    'signal_execution','test','x',0,'applied' FROM public.expert_signals s
   WHERE s.id='11111111-0000-0000-0000-000000000001';
  DELETE FROM public.expert_signals WHERE id='11111111-0000-0000-0000-000000000001';
$$, 'signal_delete_forbidden_after_effect');

SELECT t.expect_ok('E5.delete_pure_draft_allowed', $$
  INSERT INTO public.expert_signals(id, expert_id) VALUES
    ('22222222-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001');
  DELETE FROM public.expert_signals WHERE id='22222222-0000-0000-0000-000000000002';
$$);

-- =============================================================== F3 token constraints
SELECT t.expect_error('F3.cash_leg_with_instrument_key',
  $$INSERT INTO app_ledger.effect_projection_mutation(event_id,mutation_seq,target_table,
      target_row_id,op,row_role,expert_id,currency,market,instrument_key,qty_delta,cash_delta,after_hash)
    SELECT event_id,99,'portfolio_cash_ledger',gen_random_uuid(),'insert','cash_leg',expert_id,
      'TWD','TW','2330:TW',0,1,'h' FROM app_ledger.economic_effect LIMIT 1$$,
  'epm_ikey_ck');
SELECT t.expect_error('F3.non_cash_leg_missing_market',
  $$INSERT INTO app_ledger.effect_projection_mutation(event_id,mutation_seq,target_table,
      target_row_id,op,row_role,expert_id,currency,qty_delta,after_hash)
    SELECT event_id,98,'trade_records',gen_random_uuid(),'insert','open_position',expert_id,
      'TWD',1,'h' FROM app_ledger.economic_effect LIMIT 1$$,
  'epm_market_ck');
SELECT t.expect_error('F3.insert_with_before_hash',
  $$INSERT INTO app_ledger.effect_projection_mutation(event_id,mutation_seq,target_table,
      target_row_id,op,row_role,expert_id,currency,market,instrument_key,qty_delta,
      before_hash,after_hash)
    SELECT event_id,97,'trade_records',gen_random_uuid(),'insert','open_position',expert_id,
      'TWD','TW','2330:TW',1,'b','h' FROM app_ledger.economic_effect LIMIT 1$$,
  'epm_before_ck');
SELECT t.expect_error('F3.target_row_id_null',
  $$INSERT INTO app_ledger.effect_projection_mutation(event_id,mutation_seq,target_table,
      target_row_id,op,row_role,expert_id,currency,market,instrument_key,qty_delta,after_hash)
    SELECT event_id,96,'trade_records',NULL,'insert','open_position',expert_id,
      'TWD','TW','2330:TW',1,'h' FROM app_ledger.economic_effect LIMIT 1$$,
  'null value in column "target_row_id"');
SELECT t.expect_error('F3.expert_id_null',
  $$INSERT INTO app_ledger.effect_projection_mutation(event_id,mutation_seq,target_table,
      target_row_id,op,row_role,expert_id,currency,market,instrument_key,qty_delta,after_hash)
    SELECT event_id,95,'trade_records',gen_random_uuid(),'insert','open_position',NULL,
      'TWD','TW','2330:TW',1,'h' FROM app_ledger.economic_effect LIMIT 1$$,
  'null value in column "expert_id"');
SELECT t.expect_error('F3.currency_null',
  $$INSERT INTO app_ledger.effect_projection_mutation(event_id,mutation_seq,target_table,
      target_row_id,op,row_role,expert_id,currency,market,instrument_key,qty_delta,after_hash)
    SELECT event_id,94,'trade_records',gen_random_uuid(),'insert','open_position',expert_id,
      NULL,'TW','2330:TW',1,'h' FROM app_ledger.economic_effect LIMIT 1$$,
  'null value in column "currency"');
SELECT t.expect_error('F3.cash_leg_wrong_table',
  $$INSERT INTO app_ledger.effect_projection_mutation(event_id,mutation_seq,target_table,
      target_row_id,op,row_role,expert_id,currency,qty_delta,cash_delta,after_hash)
    SELECT event_id,93,'trade_records',gen_random_uuid(),'insert','cash_leg',expert_id,
      'TWD',0,1,'h' FROM app_ledger.economic_effect LIMIT 1$$,
  'epm_cash_ck');
SELECT t.expect_error('F3.cash_leg_nonzero_qty',
  $$INSERT INTO app_ledger.effect_projection_mutation(event_id,mutation_seq,target_table,
      target_row_id,op,row_role,expert_id,currency,qty_delta,cash_delta,after_hash)
    SELECT event_id,92,'portfolio_cash_ledger',gen_random_uuid(),'insert','cash_leg',expert_id,
      'TWD',5,1,'h' FROM app_ledger.economic_effect LIMIT 1$$,
  'epm_cash_qty_ck');
SELECT t.expect_error('F3.mutation_seq_zero',
  $$INSERT INTO app_ledger.effect_projection_mutation(event_id,mutation_seq,target_table,
      target_row_id,op,row_role,expert_id,currency,market,instrument_key,qty_delta,after_hash)
    SELECT event_id,0,'trade_records',gen_random_uuid(),'insert','open_position',expert_id,
      'TWD','TW','2330:TW',1,'h' FROM app_ledger.economic_effect LIMIT 1$$,
  'epm_seq_pos');
SELECT t.expect_error('F3.insert_token_row_mismatch', $$
  WITH e AS (
    INSERT INTO app_ledger.economic_effect(event_id, logical_effect_id, expert_id, market,
      instrument, instrument_key, action, qty_delta, currency, cash_delta, effective_at,
      provenance, actor_via, reason, expected_mutation_count, state)
    VALUES (gen_random_uuid(), gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001','TW',
      'x','X:TW','buy',1,'TWD',NULL,now(),'signal_execution','test','x',1,'applied')
    RETURNING event_id)
  INSERT INTO app_ledger.effect_projection_mutation(event_id,mutation_seq,target_table,
    target_row_id,op,row_role,expert_id,currency,market,instrument_key,qty_delta,after_hash)
  SELECT event_id,1,'trade_records',gen_random_uuid(),'insert','open_position',
    'aaaaaaaa-0000-0000-0000-000000000001','TWD','TW','X:TW',1,'nope' FROM e;
  INSERT INTO public.trade_records(expert_id,market,instrument,instrument_key,currency,quantity,
    entry_price,status,entry_date)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','TW','x','X:TW','TWD',1,1,'open',now());
$$, 'unauthorized_trade_records_mutation');

-- =============================================================== F3 review chain
SELECT t.ok('F3.review_first_manual_review',
  app_ledger.canonical_review('99999999-0000-0000-0000-000000000009','manual_review','r',NULL,'test') = 1);
SELECT t.expect_error('F3.review_dup_manual_review',
  $$SELECT app_ledger.canonical_review('99999999-0000-0000-0000-000000000009','manual_review','r',NULL,'t')$$,
  'illegal_review_transition');
SELECT t.ok('F3.review_manual_to_cleared',
  app_ledger.canonical_review('99999999-0000-0000-0000-000000000009','cleared','r',NULL,'test') = 2);
SELECT t.expect_error('F3.review_cleared_to_cleared',
  $$SELECT app_ledger.canonical_review('99999999-0000-0000-0000-000000000009','cleared','r',NULL,'t')$$,
  'illegal_review_transition');
SELECT t.ok('F3.review_cleared_to_quarantined',
  app_ledger.canonical_review('99999999-0000-0000-0000-000000000009','quarantined','r',NULL,'test') = 3);
SELECT t.expect_error('F3.review_quarantined_to_cleared',
  $$SELECT app_ledger.canonical_review('99999999-0000-0000-0000-000000000009','cleared','r',NULL,'t')$$,
  'illegal_review_transition');
SELECT t.expect_error('F3.review_quarantined_to_quarantined',
  $$SELECT app_ledger.canonical_review('99999999-0000-0000-0000-000000000009','quarantined','r',NULL,'t')$$,
  'illegal_review_transition');
SELECT t.ok('F3.review_quarantined_to_manual_review',
  app_ledger.canonical_review('99999999-0000-0000-0000-000000000009','manual_review','r',NULL,'test') = 4);
SELECT t.expect_error('F3.review_none_to_cleared',
  $$SELECT app_ledger.canonical_review(gen_random_uuid(),'cleared','r',NULL,'t')$$,
  'illegal_review_transition');
SELECT t.ok('F3.review_current_deterministic',
  (SELECT review_no FROM app_ledger.effect_review_current
    WHERE logical_effect_id='99999999-0000-0000-0000-000000000009') = 4);
SELECT t.expect_error('F3.review_update_forbidden',
  $$UPDATE app_ledger.effect_review_event SET reason='x'$$, 'review_event_append_only');
SELECT t.expect_error('F3.review_delete_forbidden',
  $$DELETE FROM app_ledger.effect_review_event$$, 'review_event_append_only');
SELECT t.ok('F3.review_not_writable_by_app_roles',
  NOT has_table_privilege('service_role','app_ledger.effect_review_event','INSERT')
  AND NOT has_table_privilege('authenticated','app_ledger.effect_review_event','SELECT'));
