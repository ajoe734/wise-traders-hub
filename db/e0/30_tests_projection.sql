-- E0 tests: F1 (per-expert active pointer) + F2 (correction / cash / return semantics)

-- =============================================================== F1
SELECT app_ledger.canonical_publish('aaaaaaaa-0000-0000-0000-000000000001', DATE '2026-08-07');
SELECT app_ledger.canonical_publish('bbbbbbbb-0000-0000-0000-000000000002', DATE '2026-08-07');
SELECT app_ledger.canonical_publish('cccccccc-0000-0000-0000-000000000003', DATE '2026-08-07');

CREATE OR REPLACE FUNCTION t.expert_snapshot(p uuid) RETURNS text LANGUAGE sql AS $$
  SELECT md5(coalesce((SELECT string_agg(x, '|' ORDER BY x) FROM (
      SELECT (a.active_version::text||p1.instrument_key||p1.quantity||coalesce(p1.market_value,-1)) x
        FROM public.public_position_active p1
        JOIN public.public_projection_active a ON a.expert_id=p1.expert_id
       WHERE p1.expert_id=p
      UNION ALL
      SELECT (n.trade_date::text||coalesce(n.equity,-1)||coalesce(n.daily_return,-99))
        FROM public.public_nav_active n WHERE n.expert_id=p) s), 'EMPTY'))
$$;

SELECT t.ok('F1.all_experts_visible_after_publish',
  (SELECT count(DISTINCT expert_id) FROM public.public_position_active) = 3);

DO $$
DECLARE b_before text; b_after text; b_ver bigint; b_ver2 bigint; a_ver bigint;
BEGIN
  b_before := t.expert_snapshot('bbbbbbbb-0000-0000-0000-000000000002');
  SELECT active_version INTO b_ver FROM public.public_projection_active
   WHERE expert_id='bbbbbbbb-0000-0000-0000-000000000002';
  a_ver := app_ledger.canonical_publish('aaaaaaaa-0000-0000-0000-000000000001', DATE '2026-08-07');
  b_after := t.expert_snapshot('bbbbbbbb-0000-0000-0000-000000000002');
  SELECT active_version INTO b_ver2 FROM public.public_projection_active
   WHERE expert_id='bbbbbbbb-0000-0000-0000-000000000002';
  PERFORM t.ok('F1.publish_A_leaves_B_bytes_identical', b_before = b_after, b_before||' / '||b_after);
  PERFORM t.eq('F1.publish_A_leaves_B_version', b_ver2, b_ver);
  PERFORM t.ok('F1.publish_A_bumps_A_version',
    (SELECT active_version FROM public.public_projection_active
      WHERE expert_id='aaaaaaaa-0000-0000-0000-000000000001') = a_ver);
  PERFORM t.ok('F1.B_still_non_empty', b_after <> md5('EMPTY'));
END $$;

DO $$
DECLARE a_before text; b_before text; a_ver bigint;
BEGIN
  a_before := t.expert_snapshot('aaaaaaaa-0000-0000-0000-000000000001');
  b_before := t.expert_snapshot('bbbbbbbb-0000-0000-0000-000000000002');
  SELECT active_version INTO a_ver FROM public.public_projection_active
   WHERE expert_id='aaaaaaaa-0000-0000-0000-000000000001';
  BEGIN
    PERFORM app_ledger.canonical_publish('aaaaaaaa-0000-0000-0000-000000000001',
      DATE '2026-08-07','as_reported', true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM t.ok('F1.failed_replay_keeps_A_active',
    t.expert_snapshot('aaaaaaaa-0000-0000-0000-000000000001') = a_before
    AND (SELECT active_version FROM public.public_projection_active
          WHERE expert_id='aaaaaaaa-0000-0000-0000-000000000001') = a_ver);
  PERFORM t.ok('F1.failed_replay_keeps_B_active',
    t.expert_snapshot('bbbbbbbb-0000-0000-0000-000000000002') = b_before);
END $$;

-- monotonic pointer: an older version must never overwrite a newer one (enforced by trigger)
SELECT t.expect_error('F1.pointer_regression_blocked',
  $$UPDATE public.public_projection_active SET active_version = active_version - 5
     WHERE expert_id='aaaaaaaa-0000-0000-0000-000000000001'$$,
  'projection_pointer_regression', 'P0001');
SELECT t.ok('F1.pointer_unchanged_after_blocked_regression',
  (SELECT active_version FROM public.public_projection_active
    WHERE expert_id='aaaaaaaa-0000-0000-0000-000000000001')
  = (SELECT max(projection_version) FROM public.public_position_projection
      WHERE expert_id='aaaaaaaa-0000-0000-0000-000000000001'));

-- valuation fail-closed (E7)
SELECT t.eq('E7.us_combo_unsupported',
  (SELECT valuation_status FROM public.public_position_active
    WHERE expert_id='cccccccc-0000-0000-0000-000000000003'), 'unsupported');
SELECT t.ok('E7.us_combo_market_value_null_not_zero',
  (SELECT market_value IS NULL FROM public.public_position_active
    WHERE expert_id='cccccccc-0000-0000-0000-000000000003'));
SELECT t.ok('E7.equity_null_when_position_unpriced',
  (SELECT equity IS NULL AND incomplete_reason IS NOT NULL FROM public.public_portfolio_active
    WHERE expert_id='cccccccc-0000-0000-0000-000000000003'));
SELECT t.eq('E7.tw_position_valued',
  (SELECT valuation_status FROM public.public_position_active
    WHERE expert_id='aaaaaaaa-0000-0000-0000-000000000001'), 'valued');

-- accounting identity: cash = starting + external + correction + realized - open_cost
SELECT t.ok('E7.cash_identity_per_currency',
  (SELECT bool_and(cash = starting_capital + external_capital_flow_total
                        + data_correction_adjustment_total + realized_pnl - open_cost)
     FROM public.public_portfolio_active),
  (SELECT string_agg(format('%s cash=%s calc=%s', currency, cash,
     starting_capital + external_capital_flow_total + data_correction_adjustment_total
     + realized_pnl - open_cost), ' ') FROM public.public_portfolio_active));

-- =============================================================== F2 fixtures: D/E/F vs baseline G
INSERT INTO public.experts(id, slug, base_currency, starting_capital) VALUES
  ('dddddddd-0000-0000-0000-000000000004','expert-d-qadj','TWD',100000),
  ('eeeeeeee-0000-0000-0000-000000000005','expert-e-fill','TWD',100000),
  ('ffffffff-0000-0000-0000-000000000006','expert-f-bridge','TWD',100000),
  ('99999999-0000-0000-0000-000000000007','expert-g-base','TWD',100000);

DO $$
DECLARE ex uuid;
BEGIN
  FOREACH ex IN ARRAY ARRAY['dddddddd-0000-0000-0000-000000000004',
                            'eeeeeeee-0000-0000-0000-000000000005',
                            'ffffffff-0000-0000-0000-000000000006',
                            '99999999-0000-0000-0000-000000000007']::uuid[]
  LOOP
    PERFORM app_ledger.canonical_apply_effect(jsonb_build_object(
      'action','buy','expert_id',ex,'instrument_key','2454:TW','instrument','2454',
      'market','TW','currency','TWD','qty',100,'price',50,
      'effective_at','2026-08-03T05:00:00Z','reason','f2 base buy'));
  END LOOP;
END $$;

-- D: quantity_adjustment (+50 shares, no cash)
SELECT app_ledger.canonical_apply_effect(jsonb_build_object(
  'action','quantity_adjustment','expert_id','dddddddd-0000-0000-0000-000000000004',
  'instrument_key','2454:TW','market','TW','currency','TWD','qty',50,
  'provenance','quantity_adjustment','effective_at','2026-08-04T05:00:00Z',
  'reason','audit correction'));
-- E: historical_fill (buy 100 @ 10)
SELECT app_ledger.canonical_apply_effect(jsonb_build_object(
  'action','buy','expert_id','eeeeeeee-0000-0000-0000-000000000005',
  'instrument_key','2330:TW','instrument','2330','market','TW','currency','TWD',
  'qty',100,'price',10,'provenance','historical_fill',
  'effective_at','2026-08-04T05:00:00Z','reason','missed fill'));
-- F: equity_bridge (+5000)
SELECT app_ledger.canonical_apply_effect(jsonb_build_object(
  'action','equity_bridge','expert_id','ffffffff-0000-0000-0000-000000000006',
  'currency','TWD','amount',5000,'provenance','equity_bridge',
  'effective_at','2026-08-04T05:00:00Z','reason','opening balance bridge'));

SELECT app_ledger.canonical_publish(id, DATE '2026-08-05') FROM public.experts
 WHERE slug IN ('expert-d-qadj','expert-e-fill','expert-f-bridge','expert-g-base');

-- D expectations: cash unchanged vs baseline, no cash row, return NULL & partial
SELECT t.eq('F2.qadj_cash_unchanged',
  (SELECT cash FROM public.public_portfolio_active WHERE expert_id='dddddddd-0000-0000-0000-000000000004'),
  (SELECT cash FROM public.public_portfolio_active WHERE expert_id='99999999-0000-0000-0000-000000000007'));
SELECT t.eq('F2.qadj_no_cash_ledger_row',
  (SELECT count(*)::int FROM app_ledger.portfolio_cash_ledger
    WHERE expert_id='dddddddd-0000-0000-0000-000000000004'), 1);
SELECT t.eq('F2.qadj_open_cost_changed',
  (SELECT open_cost FROM public.public_portfolio_active
    WHERE expert_id='dddddddd-0000-0000-0000-000000000004'), 7500::numeric);
SELECT t.ok('F2.qadj_daily_return_null_on_correction_day',
  (SELECT daily_return IS NULL AND completeness='partial' AND correction_flag
     AND correction_kind='quantity_adjustment'
     FROM public.public_nav_active WHERE expert_id='dddddddd-0000-0000-0000-000000000004'
      AND trade_date=DATE '2026-08-04'));
SELECT t.ok('F2.qadj_equity_jumps',
  (SELECT d.equity > g.equity FROM
     (SELECT equity FROM public.public_portfolio_active
       WHERE expert_id='dddddddd-0000-0000-0000-000000000004') d,
     (SELECT equity FROM public.public_portfolio_active
       WHERE expert_id='99999999-0000-0000-0000-000000000007') g));

-- E expectations: cash -1000, open_cost +1000, exactly one extra trade_settlement row
SELECT t.eq('F2.fill_cash_minus_1000',
  (SELECT cash FROM public.public_portfolio_active WHERE expert_id='eeeeeeee-0000-0000-0000-000000000005'),
  (SELECT cash - 1000 FROM public.public_portfolio_active
    WHERE expert_id='99999999-0000-0000-0000-000000000007'));
SELECT t.eq('F2.fill_open_cost_plus_1000',
  (SELECT open_cost FROM public.public_portfolio_active
    WHERE expert_id='eeeeeeee-0000-0000-0000-000000000005'),
  (SELECT open_cost + 1000 FROM public.public_portfolio_active
    WHERE expert_id='99999999-0000-0000-0000-000000000007'));
SELECT t.eq('F2.fill_cash_ledger_settlement_rows',
  (SELECT count(*)::int FROM app_ledger.portfolio_cash_ledger
    WHERE expert_id='eeeeeeee-0000-0000-0000-000000000005' AND entry_kind='trade_settlement'), 2);
SELECT t.ok('F2.fill_return_computed_not_null',
  (SELECT daily_return IS NOT NULL AND NOT correction_flag FROM public.public_nav_active
    WHERE expert_id='eeeeeeee-0000-0000-0000-000000000005' AND trade_date=DATE '2026-08-04'));

-- F expectations: cash +5000, equity +5000, return neutralized == baseline return
SELECT t.eq('F2.bridge_cash_plus_5000',
  (SELECT cash FROM public.public_portfolio_active WHERE expert_id='ffffffff-0000-0000-0000-000000000006'),
  (SELECT cash + 5000 FROM public.public_portfolio_active
    WHERE expert_id='99999999-0000-0000-0000-000000000007'));
SELECT t.eq('F2.bridge_equity_plus_5000',
  (SELECT equity FROM public.public_portfolio_active WHERE expert_id='ffffffff-0000-0000-0000-000000000006'),
  (SELECT equity + 5000 FROM public.public_portfolio_active
    WHERE expert_id='99999999-0000-0000-0000-000000000007'));
SELECT t.eq('F2.bridge_return_neutralized_equals_baseline',
  (SELECT daily_return FROM public.public_nav_active
    WHERE expert_id='ffffffff-0000-0000-0000-000000000006' AND trade_date=DATE '2026-08-04'),
  (SELECT daily_return FROM public.public_nav_active
    WHERE expert_id='99999999-0000-0000-0000-000000000007' AND trade_date=DATE '2026-08-04'));
SELECT t.eq('F2.bridge_cash_ledger_kind',
  (SELECT count(*)::int FROM app_ledger.portfolio_cash_ledger
    WHERE expert_id='ffffffff-0000-0000-0000-000000000006'
      AND entry_kind='data_correction_adjustment'), 1);
SELECT t.ok('F2.bridge_flagged',
  (SELECT correction_flag AND correction_kind='equity_bridge' FROM public.public_nav_active
    WHERE expert_id='ffffffff-0000-0000-0000-000000000006' AND trade_date=DATE '2026-08-04'));

-- restated basis: correction day return is recomputed (not neutralized, not NULL)
SELECT app_ledger.canonical_publish('ffffffff-0000-0000-0000-000000000006', DATE '2026-08-05','restated');
SELECT t.ok('F2.restated_return_differs_from_as_reported',
  (SELECT r.daily_return IS DISTINCT FROM a.daily_return FROM
    (SELECT daily_return FROM public.public_nav_active
      WHERE expert_id='ffffffff-0000-0000-0000-000000000006'
        AND trade_date=DATE '2026-08-04' AND reporting_basis='restated') r,
    (SELECT daily_return FROM public.public_nav_daily
      WHERE expert_id='ffffffff-0000-0000-0000-000000000006'
        AND trade_date=DATE '2026-08-04' AND reporting_basis='as_reported' LIMIT 1) a));
SELECT app_ledger.canonical_publish('dddddddd-0000-0000-0000-000000000004', DATE '2026-08-05','restated');
SELECT t.ok('F2.restated_qadj_return_not_null',
  (SELECT daily_return IS NOT NULL FROM public.public_nav_active
    WHERE expert_id='dddddddd-0000-0000-0000-000000000004'
      AND trade_date=DATE '2026-08-04' AND reporting_basis='restated'));
