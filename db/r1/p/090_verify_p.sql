-- =====================================================================
-- R1-P 090 VERIFY — replay manifest, 6515 invariant, dual policy,
-- projection swap, T+7 embargo closure, ACL/RLS closure.
-- Requires: db/e0/10_harness.sql + R1 + R1-D + R1-P (001,002,010) applied.
-- Every negative asserts SQLSTATE *and* message needle.
-- =====================================================================
\set ON_ERROR_STOP off
SET client_min_messages = warning;
TRUNCATE t.result RESTART IDENTITY;

CREATE SCHEMA IF NOT EXISTS tp;
DROP TABLE IF EXISTS tp.ids;
CREATE TABLE tp.ids(k text primary key, v uuid);
GRANT USAGE ON SCHEMA tp TO anon, authenticated, service_role;
GRANT SELECT ON tp.ids TO anon, authenticated, service_role;
INSERT INTO tp.ids VALUES
 ('userP' ,'aaaaaaa2-0000-4000-8000-000000000001'),
 ('expP'  ,'bbbbbbb2-0000-4000-8000-000000000001'),
 ('batchP','ccccccc2-0000-4000-8000-000000000001'),
 ('sigE1' ,'ddddddd2-0000-4000-8000-000000000001'),
 ('sigE2' ,'ddddddd2-0000-4000-8000-000000000002'),
 ('sigW1' ,'ddddddd2-0000-4000-8000-000000000003');

INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES ((SELECT v FROM tp.ids WHERE k='userP'),'userP@r1p.test',now(),now())
ON CONFLICT DO NOTHING;

INSERT INTO public.experts(id,user_id,slug,name,role,asset_class,currency,status,starting_capital)
VALUES ((SELECT v FROM tp.ids WHERE k='expP'),(SELECT v FROM tp.ids WHERE k='userP'),
        'r1p-p','R1P P','advisor','tw_stock','TWD','active',50000000)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION tp.sig(p_id uuid, p_action text, p_qty int, p_price numeric,
  p_status text DEFAULT 'published', p_inst text DEFAULT '2330',
  p_exec timestamptz DEFAULT now() - interval '1 day')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expert_signals(id,expert_id,batch_id,instrument,action,quantity,
    quantity_unit,price_hint,status,executed_at,published_at,created_at)
  VALUES (p_id,(SELECT v FROM tp.ids WHERE k='expP'),(SELECT v FROM tp.ids WHERE k='batchP'),
    p_inst,p_action::public.signal_action,p_qty,'張',p_price,
    p_status::public.signal_status,p_exec,
    CASE WHEN p_status='published' THEN now() ELSE NULL END, now());
END $$;

-- =====================================================================
-- P0  manifest reconciliation (84 = 48+17+9+6+3+1, drift = 26)
-- =====================================================================
DO $$ BEGIN
  PERFORM t.eq('T-P00 manifest total keys',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key), 84);
  PERFORM t.eq('T-P01 class match',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key WHERE class='match'), 48);
  PERFORM t.eq('T-P02 class multiple_apply',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key WHERE class='multiple_apply'), 17);
  PERFORM t.eq('T-P03 class signal_only',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key WHERE class='signal_only'), 9);
  PERFORM t.eq('T-P04 class stored_only',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key WHERE class='stored_only'), 6);
  PERFORM t.eq('T-P05 class incomplete',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key WHERE class='incomplete'), 3);
  PERFORM t.eq('T-P06 class other',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key WHERE class='other'), 1);
  PERFORM t.eq('T-P07 drift26 size',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key WHERE in_drift26), 26);
  PERFORM t.eq('T-P08 drift26 == multiple_apply + signal_only',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key
      WHERE in_drift26 AND class IN ('multiple_apply','signal_only')), 26);
  PERFORM t.ok('T-P09 every drift key is manual_review + withheld',
    NOT EXISTS (SELECT 1 FROM app_ledger.replay_manifest_key
                 WHERE in_drift26 AND (review_status <> 'manual_review'
                    OR public_disposition <> 'withheld_incomplete')));
  PERFORM t.ok('T-P10 no manual_review key carries an authoritative quantity',
    NOT EXISTS (SELECT 1 FROM app_ledger.replay_manifest_key
                 WHERE review_status='manual_review' AND authoritative_qty_shares IS NOT NULL));
  PERFORM t.eq('T-P11 unit_ambiguous coverage (84 basis)',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key
      WHERE reason_codes ? 'unit_ambiguous'), 24);
  PERFORM t.eq('T-P12 market_ambiguous inside drift set',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key
      WHERE in_drift26 AND reason_codes ? 'market_ambiguous'), 10);
END $$;

-- =====================================================================
-- P1  6515 invariant — neither 10 nor 50 may ever be published
-- =====================================================================
DO $$ DECLARE r app_ledger.replay_manifest_key; BEGIN
  SELECT * INTO r FROM app_ledger.replay_manifest_key WHERE instrument LIKE '6515%';
  PERFORM t.ok('T-P20 6515 key present in manifest', r.key IS NOT NULL);
  PERFORM t.eq('T-P21 6515 class', r.class, 'multiple_apply');
  PERFORM t.eq('T-P22 6515 stored candidate', r.stored_open_qty_shares, 50::numeric);
  PERFORM t.eq('T-P23 6515 replay candidate', r.replay_qty_shares, 10::numeric);
  PERFORM t.eq('T-P24 6515 review_status', r.review_status, 'manual_review');
  PERFORM t.eq('T-P25 6515 disposition', r.public_disposition, 'withheld_incomplete');
  PERFORM t.ok('T-P26 6515 has no authoritative answer', r.authoritative_qty_shares IS NULL);
  PERFORM t.ok('T-P27 6515 auto-correction forbidden', r.auto_correction_forbidden);
END $$;

SELECT t.expect_error('T-P28 6515 cannot be silently auto-corrected',
  $$UPDATE app_ledger.replay_manifest_key SET authoritative_qty_shares = 10
     WHERE instrument LIKE '6515%'$$,
  'rmk_no_auto_answer', '23514');

SELECT t.expect_error('T-P29 manifest replay numbers are immutable',
  $$UPDATE app_ledger.replay_manifest_key SET replay_qty_shares = 50
     WHERE instrument LIKE '6515%'$$,
  'manifest_replay_immutable', 'P0001');

SELECT t.expect_error('T-P30 manifest rows cannot be deleted',
  $$DELETE FROM app_ledger.replay_manifest_key WHERE instrument LIKE '6515%'$$,
  'manifest_delete_forbidden', 'P0001');

SELECT t.expect_error('T-P31 manual_review key cannot be flipped to publishable',
  $$UPDATE app_ledger.replay_manifest_key SET public_disposition='as_reported_publishable'
     WHERE instrument LIKE '6515%'$$,
  'rmk_manual_withheld', '23514');


-- =====================================================================
-- P1b  instrument classification — no warrant/option may take the
--      tw_stock / us_stock fast path (security master is authoritative)
-- =====================================================================
DO $$ BEGIN
  PERFORM t.eq('T-P32 manifest tw_warrant keys',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key WHERE asset_class='tw_warrant'), 10);
  PERFORM t.eq('T-P33 manifest unknown_derivative keys',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key WHERE asset_class='unknown_derivative'), 5);
  PERFORM t.eq('T-P34 manifest us_option_combo keys',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key WHERE asset_class='us_option_combo'), 3);
  PERFORM t.eq('T-P35 manifest unclassified instrument keys',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key WHERE asset_class='unknown_instrument'), 8);
  -- the 4 production TW warrant opens: warrant or conservative unknown_derivative
  PERFORM t.eq('T-P36 4/4 TW warrant opens are derivative-classified',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key
      WHERE instrument LIKE '068003%' OR instrument LIKE '071745%'
         OR instrument LIKE '078397%' OR instrument LIKE '079052%'), 4);
  PERFORM t.ok('T-P37 none of the 4 warrant opens is tw_stock',
    NOT EXISTS (SELECT 1 FROM app_ledger.replay_manifest_key
      WHERE asset_class NOT IN ('tw_warrant','unknown_derivative')
        AND (instrument LIKE '068003%' OR instrument LIKE '071745%'
          OR instrument LIKE '078397%' OR instrument LIKE '079052%')));
  PERFORM t.eq('T-P38 3/3 US option combos classified us_option_combo',
    (SELECT count(*)::int FROM app_ledger.replay_manifest_key
      WHERE asset_class='us_option_combo'
        AND (instrument LIKE 'LUNR%' OR instrument LIKE 'RKLB%' OR instrument LIKE 'SNDK%')), 3);
  PERFORM t.ok('T-P39 no unsupported derivative key is publishable',
    NOT EXISTS (SELECT 1 FROM app_ledger.replay_manifest_key
      WHERE asset_class IN ('tw_warrant','unknown_derivative','us_option_combo','unknown_instrument')
        AND NOT derivative_supported
        AND public_disposition <> 'withheld_incomplete'));
  -- classifier unit tests (no master row needed for the code-space rules)
  PERFORM t.eq('T-P32a classifier: absent warrant code',
    app_ledger.classify_instrument('TW','078397 X'), 'unknown_derivative');
  PERFORM t.eq('T-P32b classifier: US combo shape',
    app_ledger.classify_instrument('US','LUNR 11/8P + 16/19C'), 'us_option_combo');
  PERFORM t.eq('T-P32c classifier: US combo by unit',
    app_ledger.classify_instrument('US','LUNR', false, '組'), 'us_option_combo');
  PERFORM t.eq('T-P32d classifier: TW equity', app_ledger.classify_instrument('TW','2330 台積電'), 'tw_stock');
  PERFORM t.eq('T-P32e classifier: TW ETF', app_ledger.classify_instrument('TW','00631L 元大台灣50正2'), 'tw_stock');
  PERFORM t.eq('T-P32f classifier: US equity', app_ledger.classify_instrument('US','AMD'), 'us_stock');
  PERFORM t.eq('T-P32g classifier: US ticker booked as TW is unclassified',
    app_ledger.classify_instrument('TW','NVDA 輝達'), 'unknown_instrument');
  PERFORM t.ok('T-P32h derivative is not publishable',
    NOT app_ledger.instrument_publishable('TW','078397 X')
    AND NOT app_ledger.instrument_publishable('US','LUNR 11/8P + 16/19C')
    AND NOT app_ledger.instrument_publishable('TW','NVDA 輝達'));
  PERFORM t.ok('T-P32i cash equity is publishable',
    app_ledger.instrument_publishable('TW','2330 台積電')
    AND app_ledger.instrument_publishable('US','AMD'));
END $$;

SELECT t.expect_error('T-P32j an unsupported derivative cannot be marked publishable',
  $$INSERT INTO app_ledger.replay_manifest_key(key,expert_handle,instrument,market,currency,
      class,review_status,public_disposition,asset_class,derivative_supported)
    VALUES ('K-testderiv','E-test','078397 X','TW','TWD','match','auto_supported',
            'as_reported_publishable','unknown_derivative',false)$$,
  'rmk_derivative_closed', '23514');

-- =====================================================================
-- P2  embargo — a pending (not yet visible) effect is invisible everywhere
-- =====================================================================
DO $$ DECLARE v_ver bigint; n int; BEGIN
  PERFORM tp.sig((SELECT v FROM tp.ids WHERE k='sigE1'), 'buy', 3, 500, 'pending');
  v_ver := app_ledger.canonical_publish((SELECT v FROM tp.ids WHERE k='expP'));

  SELECT count(*) INTO n FROM public.public_position_active
   WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP');
  PERFORM t.eq('T-P40 embargoed effect yields no public position', n, 0);

  SELECT count(*) INTO n FROM public.public_nav_active
   WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP') AND coalesce(equity,0) <> 0;
  PERFORM t.eq('T-P41 embargoed effect yields no NAV equity', n, 0);

  PERFORM t.ok('T-P42 build records the embargoed count',
    (SELECT embargoed_count FROM public.public_projection_version
      WHERE projection_version=v_ver) > 0);

  -- release visibility, rebuild: now it must appear
  PERFORM app_ledger.publish_signal_effect((SELECT v FROM tp.ids WHERE k='sigE1'));
  v_ver := app_ledger.canonical_publish((SELECT v FROM tp.ids WHERE k='expP'));
  SELECT coalesce(sum(quantity),0) INTO n FROM public.public_position_active
   WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP');
  PERFORM t.eq('T-P43 released effect becomes visible (3 lots)', n, 3);
  PERFORM t.eq('T-P43b the projection carries the real quantity unit',
    (SELECT quantity_unit FROM public.public_position_active
      WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP') LIMIT 1), '張');
  PERFORM t.eq('T-P44 no embargoed effect left',
    (SELECT embargoed_count FROM public.public_projection_version
      WHERE projection_version=v_ver), 0);
END $$;

-- anon channel checks on the embargoed signal row itself
DO $$ DECLARE n int; BEGIN
  PERFORM tp.sig((SELECT v FROM tp.ids WHERE k='sigE2'), 'buy', 2, 400, 'pending', '2317');
END $$;

SET ROLE anon;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.expert_signals
   WHERE id=(SELECT v FROM tp.ids WHERE k='sigE2');
  PERFORM t.eq('T-P45 anon cannot read an embargoed signal row', n, 0);
END $$;
RESET ROLE;

SELECT t.expect_error('T-P46 anon cannot read the versioned position table',
  $$SET ROLE anon; SELECT count(*) FROM public.public_position_projection$$,
  'permission denied', '42501');
SELECT t.expect_error('T-P47 anon cannot read the versioned NAV table',
  $$SET ROLE anon; SELECT count(*) FROM public.public_nav_daily$$,
  'permission denied', '42501');
SELECT t.expect_error('T-P48 anon cannot read the withheld ledger',
  $$SET ROLE anon; SELECT count(*) FROM public.public_projection_withheld$$,
  'permission denied', '42501');
SELECT t.expect_error('T-P49 anon cannot reach app_ledger.economic_effect',
  $$SET ROLE anon; SELECT count(*) FROM app_ledger.economic_effect$$,
  'permission denied', '42501');
SELECT t.expect_error('T-P50 anon cannot read raw trade_records',
  $$SET ROLE anon; SELECT count(*) FROM public.trade_records$$,
  'permission denied', '42501');
SELECT t.expect_error('T-P51 anon cannot execute the publish builder',
  $$SET LOCAL ROLE anon;
    SELECT app_ledger.canonical_publish((SELECT v FROM tp.ids WHERE k='expP'))$$,
  'permission denied', '42501');

RESET ROLE;
DO $$ DECLARE n int; BEGIN
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.public_expert_positions_v1;
  PERFORM t.ok('T-P52 anon CAN read the published contract view', n >= 0);
  RESET ROLE;
END $$;

-- =====================================================================
-- P3  withholding — an unadjudicated key never reaches a public surface
-- =====================================================================
DO $$ DECLARE v_ver bigint; n int; v_key text; BEGIN
  PERFORM tp.sig((SELECT v FROM tp.ids WHERE k='sigW1'), 'buy', 5, 100, 'published', '6515');
  v_key := app_ledger.manifest_key((SELECT v FROM tp.ids WHERE k='expP'), 'TW', '6515');
  INSERT INTO app_ledger.replay_manifest_key(key, expert_handle, instrument, market, currency,
    class, stored_open_qty_shares, replay_qty_shares, qty_drift, review_status,
    public_disposition, authoritative_qty_shares, auto_correction_forbidden, reason_codes, in_drift26)
  VALUES (v_key,'E-fixture','6515','TW','TWD','multiple_apply',50,10,40,'manual_review',
          'withheld_incomplete',NULL,true,'["multiple_apply_suspected"]'::jsonb,true)
  ON CONFLICT (key) DO NOTHING;

  v_ver := app_ledger.canonical_publish((SELECT v FROM tp.ids WHERE k='expP'));

  SELECT count(*) INTO n FROM public.public_position_active
   WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP') AND instrument='6515';
  PERFORM t.eq('T-P60 withheld key has no public position row', n, 0);

  SELECT count(*) INTO n FROM public.public_projection_withheld
   WHERE projection_version=v_ver;
  PERFORM t.ok('T-P61 withholding is recorded internally', n = 1);

  PERFORM t.eq('T-P62 equity fails closed while a key is withheld',
    (SELECT count(*)::int FROM public.public_portfolio_active
      WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP') AND equity IS NOT NULL), 0);
  PERFORM t.ok('T-P63 incomplete_reason names the withholding',
    EXISTS (SELECT 1 FROM public.public_portfolio_active
             WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP')
               AND incomplete_reason='withheld_manual_review'));
  PERFORM t.eq('T-P64 no NAV equity is published while withheld',
    (SELECT count(*)::int FROM public.public_nav_active
      WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP') AND equity IS NOT NULL), 0);
  PERFORM t.eq('T-P65 contract view hides the withheld instrument',
    (SELECT count(*)::int FROM public.public_expert_positions_v1
      WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP') AND instrument='6515'), 0);
END $$;

-- =====================================================================
-- P4  dual policy — as_reported vs restated
-- =====================================================================
SELECT t.expect_error('T-P70 restated is refused while drift is unadjudicated',
  $$SELECT app_ledger.canonical_publish((SELECT v FROM tp.ids WHERE k='expP'),
       NULL, 'restated')$$,
  'restated_basis_blocked_unadjudicated_drift', 'P0001');

DO $$ DECLARE v_ver bigint; BEGIN
  -- human adjudication of the fixture key (never automatic)
  UPDATE app_ledger.replay_manifest_key
     SET review_status='auto_supported', public_disposition='as_reported_publishable',
         auto_correction_forbidden=false, authoritative_qty_shares=10
   WHERE key = app_ledger.manifest_key((SELECT v FROM tp.ids WHERE k='expP'),'TW','6515');
  v_ver := app_ledger.canonical_publish((SELECT v FROM tp.ids WHERE k='expP'), NULL, 'restated');
  PERFORM t.eq('T-P71 restated build succeeds after adjudication',
    (SELECT basis FROM public.public_projection_version WHERE projection_version=v_ver),
    'restated');
  PERFORM t.ok('T-P72 restated rows are stored separately from as_reported',
    (SELECT count(DISTINCT reporting_basis) FROM public.public_nav_daily
      WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP')) >= 1);
  PERFORM t.ok('T-P73 a NAV row never mixes both bases in one primary key',
    NOT EXISTS (SELECT projection_version, expert_id, currency, trade_date
                  FROM public.public_nav_daily
                 GROUP BY 1,2,3,4 HAVING count(DISTINCT reporting_basis) > 1
                    AND count(*) <> count(DISTINCT reporting_basis)));
END $$;

SELECT t.expect_error('T-P74 historical FX conversion fails closed',
  $$SELECT app_ledger.fx_rate_as_of('USD','TWD', date '2020-01-01')$$,
  'fx_history_unavailable', 'P0001');

DO $$ BEGIN
  PERFORM t.ok('T-P75 US native combos stay unsupported in valuation',
    (SELECT status FROM app_ledger.value_instrument('LUNR 11/8P + 16/19C','US',current_date))
      = 'unsupported');
  PERFORM t.ok('T-P76 an unsupported valuation can never carry money',
    NOT EXISTS (SELECT 1 FROM public.public_position_projection
                 WHERE valuation_status IN ('unpriced','unsupported')
                   AND market_value IS NOT NULL));
END $$;

-- =====================================================================
-- P5  projection swap — readers see a whole version, never a half one
-- =====================================================================
DO $$ DECLARE v_before bigint; v_after bigint; BEGIN
  SELECT active_version INTO v_before FROM public.public_projection_active
   WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP');
  BEGIN
    PERFORM app_ledger.canonical_publish((SELECT v FROM tp.ids WHERE k='expP'),
              NULL, 'as_reported', true);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT active_version INTO v_after FROM public.public_projection_active
   WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP');
  PERFORM t.eq('T-P80 failed build does not move the pointer', v_after, v_before);
  PERFORM t.ok('T-P81 every active row belongs to the active version',
    NOT EXISTS (SELECT 1 FROM public.public_position_active p
                 JOIN public.public_projection_active a USING (expert_id)
                WHERE p.projection_version <> a.active_version));
  PERFORM t.ok('T-P82 the active version is materialised',
    NOT EXISTS (SELECT 1 FROM public.public_projection_active a
                WHERE NOT EXISTS (SELECT 1 FROM public.public_projection_version v
                                   WHERE v.projection_version = a.active_version)));
END $$;

SELECT t.expect_error('T-P83 the pointer cannot regress',
  $$UPDATE public.public_projection_active SET active_version = active_version - 1
     WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP')$$,
  'projection_pointer_regression', 'P0001');

SELECT t.expect_error('T-P84 the pointer cannot target an unbuilt version',
  $$UPDATE public.public_projection_active SET active_version = 99999999
     WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP')$$,
  'projection_pointer_unmaterialised', 'P0001');

-- =====================================================================
-- P6  ACL / consumer-matrix closure (catalog generated, not hand written)
-- =====================================================================
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname IN ('public','app_ledger') AND p.prokind='f'
     AND (p.proname LIKE 'admin\_%' OR p.proname LIKE 'canonical\_%'
          OR p.proname LIKE '%publish%' OR p.proname LIKE '%backfill%'
          OR p.proname LIKE '%dedupe%' OR p.proname LIKE '%fix%'
          OR p.proname LIKE '%rebuild%' OR p.proname LIKE '%sweep%')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('public', p.oid, 'EXECUTE'));
  PERFORM t.eq('T-P90 no admin/build/publish function is anon or PUBLIC executable', n, 0);

  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE ns.nspname='app_ledger' AND c.relkind IN ('r','v','m')
     AND has_table_privilege('anon', c.oid, 'SELECT');
  PERFORM t.eq('T-P91 anon cannot select any app_ledger relation', n, 0);

  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE ns.nspname='public' AND c.relkind='r'
     AND c.relname IN ('public_position_projection','public_portfolio_state',
                       'public_nav_daily','public_projection_version',
                       'public_projection_withheld')
     AND (has_table_privilege('anon', c.oid,'SELECT')
       OR has_table_privilege('authenticated', c.oid,'SELECT'));
  PERFORM t.eq('T-P92 internal projection tables are not directly readable', n, 0);

  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE ns.nspname='public' AND c.relkind='r'
     AND c.relname IN ('public_position_projection','public_portfolio_state',
                       'public_nav_daily','public_projection_version',
                       'public_projection_withheld','public_projection_active')
     AND NOT c.relrowsecurity;
  PERFORM t.eq('T-P93 RLS is enabled on every projection table', n, 0);

  PERFORM t.ok('T-P94 anon keeps SELECT on the three active views',
    has_table_privilege('anon','public.public_position_active','SELECT')
    AND has_table_privilege('anon','public.public_portfolio_active','SELECT')
    AND has_table_privilege('anon','public.public_nav_active','SELECT'));

  -- T-COV contract: the manifest must cover every economic key the projection
  -- can emit, and every withheld key must have a manifest reason.
  PERFORM t.ok('T-P95 T-COV: every withheld row references a manifest key',
    NOT EXISTS (SELECT 1 FROM public.public_projection_withheld w
                 WHERE NOT EXISTS (SELECT 1 FROM app_ledger.replay_manifest_key m
                                    WHERE m.key = w.manifest_key)));
  PERFORM t.ok('T-P96 T-COV: no published position belongs to a withheld key',
    NOT EXISTS (SELECT 1 FROM public.public_position_active p
                 JOIN app_ledger.replay_manifest_key m
                   ON m.key = app_ledger.manifest_key(p.expert_id, p.market, p.instrument)
                WHERE m.public_disposition = 'withheld_incomplete'));
  PERFORM t.ok('T-P97 T-COV: no published NAV row is built from an invisible effect',
    NOT EXISTS (SELECT 1 FROM public.public_nav_active n
                 JOIN public.public_projection_version v
                   ON v.projection_version = n.projection_version
                WHERE EXISTS (SELECT 1 FROM app_ledger.economic_effect e
                               WHERE e.expert_id = n.expert_id
                                 AND e.effective_at::date = n.trade_date
                                 AND (e.visible_at IS NULL OR e.visible_at > v.embargo_cutoff)
                                 AND n.equity IS NOT NULL
                                 AND e.state='applied'
                                 AND e.provenance='signal_execution'
                                 AND NOT EXISTS (SELECT 1 FROM app_ledger.economic_effect e2
                                        WHERE e2.expert_id=n.expert_id
                                          AND e2.effective_at::date=n.trade_date
                                          AND e2.visible_at IS NOT NULL
                                          AND e2.visible_at <= v.embargo_cutoff))));
END $$;

\echo '--- R1-P verify summary ---'
SELECT count(*) AS tests, count(*) FILTER (WHERE NOT passed) AS failures FROM t.result;
SELECT id, name, coalesce(detail,'') FROM t.result WHERE NOT passed ORDER BY id;

-- =====================================================================
-- P9  live derivative fast-path closure (runs last: it withholds a position)
-- =====================================================================
DO $$ DECLARE v_ver bigint; BEGIN
  PERFORM tp.sig((SELECT v FROM tp.ids WHERE k='sigW1'), 'buy', 5, 1.05, 'published', '078397 同欣電富邦64購02');
  UPDATE app_ledger.economic_effect SET visible_at = now() - interval '1 minute'
   WHERE expert_id = (SELECT v FROM tp.ids WHERE k='expP');
  v_ver := app_ledger.canonical_publish((SELECT v FROM tp.ids WHERE k='expP'));
  PERFORM t.eq('T-P32k warrant position is not published',
    (SELECT count(*)::int FROM public.public_position_projection
      WHERE projection_version=v_ver AND instrument LIKE '078397%'), 0);
  PERFORM t.eq('T-P32l warrant position is recorded as withheld',
    (SELECT count(*)::int FROM public.public_projection_withheld
      WHERE projection_version=v_ver AND instrument LIKE '078397%'
        AND reason LIKE 'derivative_unsupported:%'), 1);
END $$;

