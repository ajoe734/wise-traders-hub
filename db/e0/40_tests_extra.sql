-- E0 extra tests: E2 replay equivalence, E5 migration order, E6 role-level enforcement, retention

-- =============================================================== E2 replay equivalence
INSERT INTO public.experts(id, slug, base_currency, starting_capital) VALUES
  ('12121212-0000-0000-0000-000000000011','tx-single','TWD',100000),
  ('13131313-0000-0000-0000-000000000012','tx-split','TWD',100000);

CREATE OR REPLACE FUNCTION t.run_seq(p_expert uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_ledger.canonical_apply_effect(jsonb_build_object('action','buy','expert_id',p_expert,
    'instrument_key','2330:TW','instrument','2330','market','TW','currency','TWD',
    'qty',1000,'price',100,'effective_at','2026-08-03T05:00:00Z','reason','r'));
  PERFORM app_ledger.canonical_apply_effect(jsonb_build_object('action','add','expert_id',p_expert,
    'instrument_key','2330:TW','instrument','2330','market','TW','currency','TWD',
    'qty',1000,'price',110,'effective_at','2026-08-04T05:00:00Z','reason','r'));
  PERFORM app_ledger.canonical_apply_effect(jsonb_build_object('action','trim','expert_id',p_expert,
    'instrument_key','2330:TW','instrument','2330','market','TW','currency','TWD',
    'qty',500,'price',120,'effective_at','2026-08-05T05:00:00Z','reason','r'));
END $$;

BEGIN;
SELECT t.run_seq('12121212-0000-0000-0000-000000000011');
COMMIT;

BEGIN; SELECT app_ledger.canonical_apply_effect(jsonb_build_object('action','buy','expert_id',
  '13131313-0000-0000-0000-000000000012','instrument_key','2330:TW','instrument','2330','market','TW',
  'currency','TWD','qty',1000,'price',100,'effective_at','2026-08-03T05:00:00Z','reason','r')); COMMIT;
BEGIN; SELECT app_ledger.canonical_apply_effect(jsonb_build_object('action','add','expert_id',
  '13131313-0000-0000-0000-000000000012','instrument_key','2330:TW','instrument','2330','market','TW',
  'currency','TWD','qty',1000,'price',110,'effective_at','2026-08-04T05:00:00Z','reason','r')); COMMIT;
BEGIN; SELECT app_ledger.canonical_apply_effect(jsonb_build_object('action','trim','expert_id',
  '13131313-0000-0000-0000-000000000012','instrument_key','2330:TW','instrument','2330','market','TW',
  'currency','TWD','qty',500,'price',120,'effective_at','2026-08-05T05:00:00Z','reason','r')); COMMIT;

SELECT t.eq('E2.single_vs_split_trade_rows_identical',
  (SELECT md5(string_agg(x,'|' ORDER BY x)) FROM (
     SELECT (quantity::text||entry_price||coalesce(exit_price,-1)||status||instrument_key) x
       FROM public.trade_records WHERE expert_id='12121212-0000-0000-0000-000000000011') s),
  (SELECT md5(string_agg(x,'|' ORDER BY x)) FROM (
     SELECT (quantity::text||entry_price||coalesce(exit_price,-1)||status||instrument_key) x
       FROM public.trade_records WHERE expert_id='13131313-0000-0000-0000-000000000012') s));

SELECT t.eq('E2.single_vs_split_cash_identical',
  (SELECT md5(string_agg(x,'|' ORDER BY x)) FROM (
     SELECT (entry_kind||amount::text) x FROM app_ledger.portfolio_cash_ledger
      WHERE expert_id='12121212-0000-0000-0000-000000000011') s),
  (SELECT md5(string_agg(x,'|' ORDER BY x)) FROM (
     SELECT (entry_kind||amount::text) x FROM app_ledger.portfolio_cash_ledger
      WHERE expert_id='13131313-0000-0000-0000-000000000012') s));

SELECT app_ledger.canonical_publish('12121212-0000-0000-0000-000000000011', DATE '2026-08-07');
SELECT app_ledger.canonical_publish('13131313-0000-0000-0000-000000000012', DATE '2026-08-07');
SELECT t.eq('E2.single_vs_split_projection_identical',
  (SELECT md5(string_agg(quantity::text||avg_cost||coalesce(market_value,-1),'|' ORDER BY instrument_key))
     FROM public.public_position_active WHERE expert_id='12121212-0000-0000-0000-000000000011'),
  (SELECT md5(string_agg(quantity::text||avg_cost||coalesce(market_value,-1),'|' ORDER BY instrument_key))
     FROM public.public_position_active WHERE expert_id='13131313-0000-0000-0000-000000000012'));

-- =============================================================== E5 migration order (add → backfill → not null → trigger)
DO $$
DECLARE v_ok boolean := true; v_msg text := '';
BEGIN
  CREATE TABLE t.legacy_signals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text);
  INSERT INTO t.legacy_signals(status) SELECT 'published' FROM generate_series(1,173);
  ALTER TABLE t.legacy_signals ADD COLUMN logical_effect_id uuid;
  UPDATE t.legacy_signals SET logical_effect_id = gen_random_uuid()
   WHERE logical_effect_id IS NULL;
  ALTER TABLE t.legacy_signals ALTER COLUMN logical_effect_id SET NOT NULL;
  PERFORM t.ok('E5.backfill_order_173_legacy_rows',
    (SELECT count(*) = 173 AND count(DISTINCT logical_effect_id) = 173 FROM t.legacy_signals));
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  PERFORM t.ok('E5.backfill_order_173_legacy_rows', false, v_msg);
END $$;

DO $$
DECLARE v_ev uuid; v_log uuid; v_msg text; v_pass boolean := false;
BEGIN
  v_ev := app_ledger.canonical_apply_effect(jsonb_build_object(
    'action','capital_flow','expert_id','12121212-0000-0000-0000-000000000011',
    'currency','TWD','amount',1,'provenance','external_capital_flow','reason','x',
    'logical_effect_id','00000000-0000-0000-0000-0000000000ff'));
  SELECT logical_effect_id INTO v_log FROM app_ledger.economic_effect WHERE event_id=v_ev;
  PERFORM t.ok('D5.client_supplied_logical_id_ignored',
    v_log <> '00000000-0000-0000-0000-0000000000ff', v_log::text);

  BEGIN
    PERFORM app_ledger.canonical_apply_effect(jsonb_build_object(
      'action','capital_flow','expert_id','12121212-0000-0000-0000-000000000011',
      'currency','TWD','amount',1,'provenance','external_capital_flow','reason','x',
      'restore_logical_effect_id','00000000-0000-0000-0000-0000000000fe'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    v_pass := position('unknown_restore_logical_effect_id' in v_msg) > 0;
  END;
  PERFORM t.ok('D5.unknown_restore_logical_id_rejected', v_pass, v_msg);

  v_ev := app_ledger.canonical_apply_effect(jsonb_build_object(
    'action','capital_flow','expert_id','12121212-0000-0000-0000-000000000011',
    'currency','TWD','amount',1,'provenance','external_capital_flow','reason','x',
    'restore_logical_effect_id', v_log));
  PERFORM t.eq('D5.known_restore_logical_id_accepted',
    (SELECT logical_effect_id FROM app_ledger.economic_effect WHERE event_id=v_ev), v_log);
END $$;

-- =============================================================== E6 role-level enforcement
DO $$
DECLARE v_msg text;
BEGIN
  SET LOCAL ROLE service_role;
  UPDATE public.trade_records SET current_price=123, price_updated_at=now() WHERE status='open';
  RESET ROLE;
  PERFORM t.ok('E6.service_role_price_update_allowed', true);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  RESET ROLE;
  PERFORM t.ok('E6.service_role_price_update_allowed', false, v_msg);
END $$;

DO $$
DECLARE v_msg text; v_pass boolean := false;
BEGIN
  BEGIN
    SET LOCAL ROLE service_role;
    UPDATE public.trade_records SET quantity=quantity+1 WHERE status='open';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    v_pass := position('permission denied' in v_msg) > 0;
  END;
  RESET ROLE;
  PERFORM t.ok('E6.service_role_qty_update_denied', v_pass, v_msg);
END $$;

DO $$
DECLARE v_msg text; v_pass boolean := false;
BEGIN
  BEGIN
    SET LOCAL ROLE service_role;
    PERFORM app_ledger.canonical_apply_effect('{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    v_pass := position('permission denied' in v_msg) > 0;
  END;
  RESET ROLE;
  PERFORM t.ok('E6.service_role_cannot_execute_canonical', v_pass, v_msg);
END $$;

DO $$
DECLARE v_msg text; v_pass boolean := false;
BEGIN
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.public_position_projection LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    v_pass := position('permission denied' in v_msg) > 0;
  END;
  RESET ROLE;
  PERFORM t.ok('E6.anon_cannot_read_projection_base_table', v_pass, v_msg);
END $$;

DO $$
DECLARE v_msg text; v_n int;
BEGIN
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.public_position_active;
  RESET ROLE;
  PERFORM t.ok('E6.anon_can_read_active_view', v_n > 0, v_n::text);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT; RESET ROLE;
  PERFORM t.ok('E6.anon_can_read_active_view', false, v_msg);
END $$;

-- =============================================================== retention
DO $$
DECLARE v_expert uuid := '12121212-0000-0000-0000-000000000011'; v_active bigint; v_before text;
BEGIN
  PERFORM app_ledger.canonical_publish(v_expert, DATE '2026-08-07');
  PERFORM app_ledger.canonical_publish(v_expert, DATE '2026-08-07');
  PERFORM app_ledger.canonical_publish(v_expert, DATE '2026-08-07');
  PERFORM app_ledger.canonical_publish(v_expert, DATE '2026-08-07');
  SELECT active_version INTO v_active FROM public.public_projection_active WHERE expert_id=v_expert;
  v_before := t.expert_snapshot(v_expert);
  DELETE FROM public.public_position_projection p
   WHERE p.expert_id=v_expert AND p.projection_version NOT IN (
     SELECT projection_version FROM public.public_position_projection
      WHERE expert_id=v_expert ORDER BY projection_version DESC LIMIT 3);
  PERFORM t.ok('F1.retention_keeps_active_readable',
    t.expert_snapshot(v_expert) = v_before AND
    (SELECT active_version FROM public.public_projection_active WHERE expert_id=v_expert) = v_active);
END $$;
