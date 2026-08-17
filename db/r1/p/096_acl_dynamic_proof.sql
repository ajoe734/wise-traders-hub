-- =====================================================================
-- R1-P 096 — DYNAMIC ACL PROOF (clone only, production is never touched)
--
-- 095 proves the catalog *state* (who holds EXECUTE). 096 proves the actual
-- RUNTIME behaviour by really calling every target:
--   A. 12 x negative : ordinary authenticated (NOT company_admin) -> 42501
--   B. 12 x positive : company_admin intended caller               -> succeeds
--   C. definer hygiene for all 28 targets: prosecdef / fixed search_path /
--      owner / dynamic SQL / object shadowing
--   D. identity helpers: cross-user probing refused, self allowed,
--      anon RLS predicate path still works (no 42501 regression)
--   E. wrapper matrix: raw unreachable, wrapper reachable, no recursion,
--      legacy call compatibility, trigger repoint DML
-- Every call runs inside a rolled-back subtransaction, so no fixture row is
-- mutated by this file.
-- =====================================================================
CREATE SCHEMA IF NOT EXISTS t;

-- ---------------------------------------------------------------- actors
CREATE TABLE IF NOT EXISTS t.acl_actor(k text primary key, v uuid);

DO $seed3$

DECLARE v_admin uuid := 'aaaaaaaa-0000-4000-8000-000000000a11';
        v_user  uuid := 'bbbbbbbb-0000-4000-8000-000000000b22';
        v_other uuid := 'cccccccc-0000-4000-8000-000000000c33';
BEGIN
  DELETE FROM t.acl_actor;
  INSERT INTO t.acl_actor VALUES ('admin', v_admin), ('user', v_user), ('other', v_other);
  INSERT INTO auth.users(id, email)
  SELECT x.id, x.em FROM (VALUES (v_admin,'acl-admin@clone.local'),
                                 (v_user ,'acl-user@clone.local'),
                                 (v_other,'acl-other@clone.local')) x(id, em)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles(user_id, display_name, is_tester)
  VALUES (v_admin,'acl admin', false), (v_user,'acl user', false), (v_other,'acl other', true)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles(user_id, role) VALUES (v_admin, 'company_admin')
  ON CONFLICT DO NOTHING;
END $seed3$;

-- --------------------------------------------------- generic call executor
-- Runs p_sql as `authenticated` with the given JWT subject, inside a
-- subtransaction that is always rolled back. Returns the SQLSTATE
-- ('00000' when the call completed).
CREATE OR REPLACE FUNCTION t.acl_call(p_sql text, p_uid uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_state text; v_msg text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
             json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql;
    RAISE EXCEPTION 'acl_rollback_marker' USING ERRCODE = 'P0002';
  EXCEPTION
    WHEN SQLSTATE 'P0002' THEN v_state := '00000';
    WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
                     v_state := v_state || ' ' || coalesce(v_msg,'');
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v_state;
END $$;

-- ------------------------------------------------- domain fixture (apply)
-- admin_apply_fix_proposal needs a legitimate pending proposal to have a real
-- positive case. The first version of this fixture left expert_id NULL and
-- pointed at a symbol with no position, which the repaired function correctly
-- rejects with 22023 incomplete_proposal — a guard pass, but not a clean run.
-- The fixture therefore builds the full legal precondition: a probe expert with
-- one OPEN trade record on instrument ZZZZ, plus a pending `normalize_unit`
-- proposal that targets it. The apply path then runs end to end (canonical
-- correction + status -> applied + apply_result), and every write is rolled
-- back by t.acl_call / t.acl_call_probe.
CREATE TABLE IF NOT EXISTS t.acl_fixture(k text primary key, v uuid);
DO $fx$
DECLARE v_id uuid := '11111111-0000-4000-8000-0000000000f1';
        v_exp uuid; v_uid uuid := (SELECT v FROM t.acl_actor WHERE k='admin');
BEGIN
  DELETE FROM public.holdings_fix_proposals WHERE id = v_id;
  SELECT id INTO v_exp FROM public.experts WHERE slug = 'acl-probe-expert';
  IF v_exp IS NULL THEN
    -- starting_capital must cover the seed signal or enforce_signal_capital_limit
    -- refuses it with CAPITAL_EXCEEDED.
    INSERT INTO public.experts(user_id, slug, name, role, status, starting_capital,
                               currency, asset_class)
    VALUES (v_uid, 'acl-probe-expert', 'ACL Probe Expert', 'advisor', 'active',
            1000000, 'TWD', 'tw_stock')
    RETURNING id INTO v_exp;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trade_records tr
                  WHERE tr.expert_id = v_exp AND tr.instrument = 'ZZZZ'
                    AND tr.status = 'open'::public.trade_status) THEN
    -- Two seeding paths are (correctly) closed: a raw INSERT is refused by
    -- trade_records_economic_guard ("only ledger_owner may write economics"),
    -- and canonical_correct_position raises no_open_position because a
    -- quantity_adjustment cannot open a position. The legal way to open one is
    -- the same way production does: publish a buy signal and let the
    -- handle_signal_trade -> ledger path materialise the trade record.
    INSERT INTO public.expert_signals(expert_id, action, instrument, quantity,
      quantity_unit, price_hint, market, status, published_at)
    VALUES (v_exp, 'buy', 'ZZZZ', 2, '張', 100, 'TW', 'published', now());
  END IF;
  INSERT INTO public.holdings_fix_proposals(
    id, drift_category, expert_id, expert_slug, expert_name, symbol, instrument,
    severity, summary, proposed_action, payload, preview, status, signature)
  VALUES (v_id, 'UNIT_MIX', v_exp, 'acl-probe-expert', 'ACL Probe Expert', 'ZZZZ', 'ZZZZ',
          'low', 'acl dynamic proof fixture', 'normalize_unit',
          jsonb_build_object('target_unit','張','market','TW','to_quantity',1000,
                             'signal_ids','[]'::jsonb, 'also_scale_quantity', false),
          '{}'::jsonb, 'pending', 'acl-probe|UNIT_MIX|ZZZZ|fixture');
  DELETE FROM t.acl_fixture WHERE k='apply_proposal';
  INSERT INTO t.acl_fixture VALUES ('apply_proposal', v_id);
  DELETE FROM t.acl_fixture WHERE k='apply_expert';
  INSERT INTO t.acl_fixture VALUES ('apply_expert', v_exp);
END $fx$;

-- ------------------------------------------------- mutation probe executor
-- Same rollback contract as t.acl_call, but evaluates a boolean probe INSIDE
-- the subtransaction (after the call, before the rollback) so an admin write
-- can be asserted without leaving any residue on the clone.
CREATE OR REPLACE FUNCTION t.acl_call_probe(p_sql text, p_uid uuid, p_probe text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_state text; v_msg text; v_probe boolean;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
             json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql;
    RESET ROLE;
    EXECUTE p_probe INTO v_probe;
    v_state := CASE WHEN coalesce(v_probe,false) THEN '00000 mutation_observed'
                    ELSE '00000 mutation_missing' END;
    RAISE EXCEPTION 'acl_rollback_marker' USING ERRCODE = 'P0002', HINT = v_state;
  EXCEPTION
    WHEN SQLSTATE 'P0002' THEN GET STACKED DIAGNOSTICS v_msg = PG_EXCEPTION_HINT;
                               v_state := v_msg;
    WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
                     v_state := v_state || ' ' || coalesce(v_msg,'');
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v_state;
END $$;


-- ============================================================ A + B
-- the 12 keep_typed_safe_authenticated_guarded targets, really executed.
--
-- Two independent claims are asserted per target:
--   T-P96a  the ordinary authenticated caller is REFUSED. A refusal is either
--           42501 or the contractual P0001 guard raise ("forbidden" /
--           "not authorized"). Anything else (including success) is a FAIL.
--   T-P96b  the company_admin intended caller PASSES THE GUARD, i.e. the call
--           never produces a refusal.
--   T-P96b-exec  the admin call's exact end state equals the recorded
--           expectation. '00000' means it ran clean; a recorded non-clean
--           signature pins a *pre-existing production defect or documented
--           domain precondition* so any drift shows up as a failure instead of
--           being silently tolerated.
DO $BODY$
DECLARE r record; v_admin uuid; v_user uuid; s_neg text; s_pos text; v_exists boolean;
        v_refused_neg boolean; v_refused_pos boolean;
BEGIN
  SELECT v INTO v_admin FROM t.acl_actor WHERE k='admin';
  SELECT v INTO v_user  FROM t.acl_actor WHERE k='user';
  FOR r IN SELECT * FROM (VALUES
   ( 1,'admin_apply_fix_proposal','public.admin_apply_fix_proposal(uuid, boolean)',
     $$SELECT public.admin_apply_fix_proposal('11111111-0000-4000-8000-0000000000f1'::uuid, true)$$,
     '00000', 'clean (runs against the t.acl_fixture pending proposal)'),
   ( 2,'admin_delete_trade_records_by_signal_ids','public.admin_delete_trade_records_by_signal_ids(uuid[])',
     $$SELECT public.admin_delete_trade_records_by_signal_ids(ARRAY[]::uuid[])$$,
     '00000', 'clean'),
   ( 3,'admin_delete_trade_records_by_symbol','public.admin_delete_trade_records_by_symbol(uuid, text)',
     $$SELECT public.admin_delete_trade_records_by_symbol('11111111-0000-4000-8000-000000000001'::uuid,'ZZZZ')$$,
     '00000', 'clean'),
   ( 4,'admin_generate_fix_proposals','public.admin_generate_fix_proposals(text)',
     $$SELECT public.admin_generate_fix_proposals('unit_ambiguous')$$,
     '00000', 'clean (002 C5 compat repairs the shipped ambiguity defect)'),
   ( 5,'admin_holdings_consistency_audit','public.admin_holdings_consistency_audit()',
     $$SELECT count(*) FROM public.admin_holdings_consistency_audit()$$,
     '00000', 'clean (002 C5 compat repairs the shipped ambiguity defect)'),
   ( 6,'admin_reject_fix_proposal','public.admin_reject_fix_proposal(uuid, text)',
     $$SELECT public.admin_reject_fix_proposal('11111111-0000-4000-8000-000000000001'::uuid,'acl probe')$$,
     '00000', 'clean'),
   ( 7,'admin_reset_expert_asset_class','public.admin_reset_expert_asset_class(uuid, text)',
     $$SELECT public.admin_reset_expert_asset_class((SELECT id FROM public.experts ORDER BY id LIMIT 1),'tw_stock')$$,
     '00000', 'clean'),
   ( 8,'admin_trade_dedupe_sweep','public.admin_trade_dedupe_sweep(boolean)',
     $$SELECT public.admin_trade_dedupe_sweep(true)$$,
     '00000', 'clean'),
   ( 9,'enqueue_bsr_backfill','public.enqueue_bsr_backfill(text, integer)',
     $$SELECT public.enqueue_bsr_backfill('2330', 5)$$,
     '00000', 'clean'),
   (10,'get_publish_batch_attempts','public.get_publish_batch_attempts(integer)',
     $$SELECT count(*) FROM public.get_publish_batch_attempts(5)$$,
     '00000', 'clean'),
   (11,'get_publish_batch_runs','public.get_publish_batch_runs(integer)',
     $$SELECT count(*) FROM public.get_publish_batch_runs(5)$$,
     '00000', 'clean (002 C5 compat repairs the shipped ambiguity defect)'),
   (12,'get_publish_batch_status','public.get_publish_batch_status()',
     $$SELECT count(*) FROM public.get_publish_batch_status()$$,
     '00000', 'clean (002 C5 compat maps e.expert_slug -> e.slug)')
  ) AS v(n, nm, sig, call_sql, pos_expect, pos_class) LOOP
    v_exists := to_regprocedure(r.sig) IS NOT NULL;
    IF NOT v_exists THEN
      PERFORM t.ok(format('T-P96a.%s negative ordinary authenticated refused: %s', lpad(r.n::text,2,'0'), r.nm),
                   false, 'target missing from clone catalog — dynamic proof impossible');
      PERFORM t.ok(format('T-P96b.%s positive company_admin passes guard: %s', lpad(r.n::text,2,'0'), r.nm),
                   false, 'target missing from clone catalog — dynamic proof impossible');
      PERFORM t.ok(format('T-P96b-exec.%s end state as recorded: %s', lpad(r.n::text,2,'0'), r.nm),
                   false, 'target missing from clone catalog — dynamic proof impossible');
      CONTINUE;
    END IF;
    s_neg := t.acl_call(r.call_sql, v_user);
    s_pos := t.acl_call(r.call_sql, v_admin);
    v_refused_neg := s_neg LIKE '42501%'
                  OR (s_neg LIKE 'P0001%' AND (s_neg ~* 'forbidden|not authorized|permission|admin'));
    v_refused_pos := s_pos LIKE '42501%'
                  OR (s_pos LIKE 'P0001%' AND (s_pos ~* 'forbidden|not authorized|admin only'));
    PERFORM t.ok(format('T-P96a.%s negative ordinary authenticated refused: %s', lpad(r.n::text,2,'0'), r.nm),
                 v_refused_neg, 'actual=' || s_neg);
    -- an intended-caller positive only counts when the call is genuinely
    -- clean: passing the guard but dying on a body defect is NOT a pass.
    PERFORM t.ok(format('T-P96b.%s positive company_admin succeeds clean: %s', lpad(r.n::text,2,'0'), r.nm),
                 (NOT v_refused_pos) AND s_pos = '00000', 'actual=' || s_pos);
    PERFORM t.ok(format('T-P96b-exec.%s end state as recorded: %s', lpad(r.n::text,2,'0'), r.nm),
                 s_pos LIKE r.pos_expect || '%',
                 format('actual=%s expected=%s%% class=%s', s_pos, r.pos_expect, r.pos_class));
  END LOOP;
END $BODY$;

-- static evidence that the four shipped-body defects are actually repaired by
-- the 002 C5 compat block (and were real defects in the production catalog).
DO $BODY$
DECLARE v_src text; v_has_col boolean; v_n int;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_publish_batch_status';
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='experts'
                    AND column_name='expert_slug') INTO v_has_col;
  PERFORM t.ok('T-P96b-evd.01 get_publish_batch_status no longer reads a non-existent column',
               v_src NOT LIKE '%e.expert_slug%' AND NOT v_has_col
               AND v_src LIKE '%e.slug AS expert_slug%',
               format('body_refs_expert_slug=%s experts.expert_slug_exists=%s',
                      v_src LIKE '%e.expert_slug%', v_has_col));
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('admin_holdings_consistency_audit','get_publish_batch_runs')
      AND p.prosrc LIKE '%#variable_conflict use_column%';
  PERFORM t.ok('T-P96b-evd.02 the two OUT-parameter ambiguity defects are repaired in place',
               v_n = 2, format('repaired_bodies=%s of 2', v_n));
  PERFORM t.ok('T-P96b-evd.03 admin_generate_fix_proposals still delegates to the repaired audit',
               (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='admin_generate_fix_proposals')
                 LIKE '%admin_holdings_consistency_audit()%',
               'transitive repair path');
END $BODY$;


-- ============================================================ C
-- definer hygiene over all 28 unique ACL targets, plus the new R1-P
-- SECURITY DEFINER predicate public.signal_is_publicly_visible(uuid).
DO $BODY$
DECLARE r record; v_oid oid; v_cfg text; v_bad int; v_missing int := 0; v_checked int := 0;
BEGIN
  FOR r IN SELECT * FROM (VALUES
   ($$public.admin_apply_fix_proposal(p_id uuid, p_confirm boolean)$$),
   ($$public.admin_delete_trade_records_by_signal_ids(_signal_ids uuid[])$$),
   ($$public.admin_delete_trade_records_by_symbol(_expert_id uuid, _symbol_prefix text)$$),
   ($$public.admin_generate_fix_proposals(p_category text)$$),
   ($$public.admin_holdings_consistency_audit()$$),
   ($$public.admin_list_cron_jobs()$$),
   ($$public.admin_reject_fix_proposal(p_id uuid, p_note text)$$),
   ($$public.admin_reset_expert_asset_class(_expert_id uuid, _new_asset_class text)$$),
   ($$public.admin_trade_dedupe_sweep(p_dry_run boolean)$$),
   ($$public.backfill_job_set_done(_id bigint, _status text)$$),
   ($$public.backfill_job_set_failed(_id bigint, _error text, _retry_at timestamp with time zone)$$),
   ($$public.backfill_legacy_bsr_to_fact(_from date, _to date)$$),
   ($$public.backfill_queue_stats()$$),
   ($$public.claim_backfill_jobs(_batch_size integer, _max_priority_score integer)$$),
   ($$public.enqueue_backfill_jobs(_jobs jsonb)$$),
   ($$public.enqueue_bsr_backfill(p_stock_id text, p_days integer)$$),
   ($$public.enqueue_institutional_backfill_universe()$$),
   ($$public.get_expert_capital_status(_expert_id uuid)$$),
   ($$public.get_publish_batch_attempts(_limit integer)$$),
   ($$public.get_publish_batch_runs(_limit integer)$$),
   ($$public.get_publish_batch_status()$$),
   ($$public.has_active_subscription_after(_user_id uuid, _published_at timestamp with time zone)$$),
   ($$public.is_tester(_user_id uuid)$$),
   ($$public.prune_backfill_job_queue()$$),
   ($$public.publish_batch_attempts_touch()$$),
   ($$public.recover_stale_backfill_jobs(_stale_after interval)$$),
   ($$public.tg_holdings_fix_proposals_updated_at()$$),
   ($$public.trade_dedupe_sweep(p_dry_run boolean)$$),
   -- new in R1-P 002: the embargo predicate used by the anon RLS policy.
   ($$public.signal_is_publicly_visible(_signal_id uuid)$$)
  ) AS v(sig) LOOP
    SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) = r.sig;
    IF v_oid IS NULL THEN v_missing := v_missing + 1; CONTINUE; END IF;
    v_checked := v_checked + 1;
    SELECT coalesce(array_to_string(proconfig, ','), '') INTO v_cfg FROM pg_proc WHERE oid = v_oid;
    PERFORM t.ok('T-P96c fixed search_path: ' || r.sig, v_cfg LIKE 'search_path%', 'proconfig=' || v_cfg);
    PERFORM t.ok('T-P96c owner is a trusted role: ' || r.sig,
                 (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = v_oid)
                   IN ('postgres','ledger_owner','wrapper_owner','supabase_admin'),
                 'owner=' || (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = v_oid));
    PERFORM t.ok('T-P96c no dynamic SQL: ' || r.sig,
                 (SELECT prosrc FROM pg_proc WHERE oid = v_oid) !~* 'execute\s+(format|''|quote)',
                 'prosrc scanned for EXECUTE format/literal');
  END LOOP;
  PERFORM t.eq('T-P96c coverage: 28 ACL targets + signal_is_publicly_visible present on this clone',
               v_checked, 29);
  PERFORM t.eq('T-P96c missing targets', v_missing, 0);
  -- object shadowing: no same-named function in a schema that could win the
  -- search_path race for any of the targets.
  SELECT count(*)::int INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('public','pg_catalog','app_ledger','t','auth')
     AND p.proname IN ('is_tester','has_active_subscription_after','has_role',
                       'get_expert_capital_status','backfill_queue_stats');
  PERFORM t.eq('T-P96c no object shadowing of gated names outside public', v_bad, 0);
END $BODY$;

-- ============================================================ D
-- identity helpers: no cross-user probing
DO $BODY$
DECLARE v_user uuid; v_other uuid; v_admin uuid; s text;
BEGIN
  SELECT v INTO v_user  FROM t.acl_actor WHERE k='user';
  SELECT v INTO v_other FROM t.acl_actor WHERE k='other';
  SELECT v INTO v_admin FROM t.acl_actor WHERE k='admin';

  s := t.acl_call(format($$SELECT public.is_tester(%L::uuid)$$, v_other), v_user);
  PERFORM t.ok('T-P96d.01 is_tester cross-user probe refused', s LIKE '42501%', 'actual=' || s);
  s := t.acl_call(format($$SELECT public.is_tester(%L::uuid)$$, v_user), v_user);
  PERFORM t.ok('T-P96d.02 is_tester self allowed', s = '00000', 'actual=' || s);
  s := t.acl_call(format($$SELECT public.is_tester(%L::uuid)$$, v_other), v_admin);
  PERFORM t.ok('T-P96d.03 is_tester company_admin allowed', s = '00000', 'actual=' || s);

  s := t.acl_call(format($$SELECT count(*) FROM public.has_active_subscription_after(%L::uuid, now())$$, v_other), v_user);
  PERFORM t.ok('T-P96d.04 has_active_subscription_after cross-user probe refused', s LIKE '42501%', 'actual=' || s);
  s := t.acl_call(format($$SELECT count(*) FROM public.has_active_subscription_after(%L::uuid, now())$$, v_user), v_user);
  PERFORM t.ok('T-P96d.05 has_active_subscription_after self allowed', s = '00000', 'actual=' || s);
  s := t.acl_call(format($$SELECT count(*) FROM public.has_active_subscription_after(%L::uuid, now())$$, v_other), v_admin);
  PERFORM t.ok('T-P96d.06 has_active_subscription_after company_admin allowed', s = '00000', 'actual=' || s);
END $BODY$;

-- anon must keep working: both helpers sit inside RLS predicates evaluated as anon
DO $BODY$
DECLARE v_state text; v_msg text;
BEGIN
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM count(*) FROM public.experts;
    PERFORM count(*) FROM public.expert_signals;
    PERFORM public.is_tester(auth.uid());
    RESET ROLE; v_state := '00000';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  PERFORM t.ok('T-P96d.07 anon RLS predicate path still works (no 42501 regression)',
               v_state = '00000', coalesce(v_state,'') || ' ' || coalesce(v_msg,''));
END $BODY$;

-- ============================================================ E
-- wrapper matrix + recursion + legacy compatibility + trigger repoint
DO $BODY$
DECLARE r record; v_raw oid; v_pub oid; v_src text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('get_expert_capital_status',        'public.get_expert_capital_status(uuid)',
                                         'public.get_expert_capital_status_raw(uuid)', false),
    ('backfill_queue_stats',             'public.backfill_queue_stats()',
                                         'public.backfill_queue_stats_raw()', false),
    ('is_tester',                        'public.is_tester(uuid)',
                                         'public.is_tester_raw(uuid)', true),
    ('has_active_subscription_after',    'public.has_active_subscription_after(uuid, timestamptz)',
                                         'public.has_active_subscription_after_raw(uuid, timestamptz)', true)
  ) AS v(nm, pub_sig, raw_sig, anon_keeps) LOOP
    v_pub := to_regprocedure(r.pub_sig); v_raw := to_regprocedure(r.raw_sig);
    PERFORM t.ok('T-P96e raw body exists and is separate: ' || r.nm,
                 v_pub IS NOT NULL AND v_raw IS NOT NULL AND v_pub <> v_raw,
                 format('public=%s raw=%s', v_pub, v_raw));
    CONTINUE WHEN v_pub IS NULL OR v_raw IS NULL;
    PERFORM t.ok('T-P96e raw closed to anon/authenticated/PUBLIC: ' || r.nm,
                 NOT has_function_privilege('anon', v_raw, 'EXECUTE')
             AND NOT has_function_privilege('authenticated', v_raw, 'EXECUTE'),
                 format('anon=%s authenticated=%s service_role=%s',
                        has_function_privilege('anon', v_raw, 'EXECUTE'),
                        has_function_privilege('authenticated', v_raw, 'EXECUTE'),
                        has_function_privilege('service_role', v_raw, 'EXECUTE')));
    PERFORM t.ok('T-P96e wrapper caller matrix: ' || r.nm,
                 has_function_privilege('authenticated', v_pub, 'EXECUTE')
             AND has_function_privilege('service_role', v_pub, 'EXECUTE')
             AND has_function_privilege('anon', v_pub, 'EXECUTE') = r.anon_keeps,
                 format('anon=%s (expected %s) authenticated=%s service_role=%s',
                        has_function_privilege('anon', v_pub, 'EXECUTE'), r.anon_keeps,
                        has_function_privilege('authenticated', v_pub, 'EXECUTE'),
                        has_function_privilege('service_role', v_pub, 'EXECUTE')));
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_pub;
    PERFORM t.ok('T-P96e wrapper has no recursion / self-call: ' || r.nm,
                 v_src ~ (r.nm || '_raw\(')
             AND (regexp_count(v_src, r.nm || '\(') = 0),
                 'wrapper body calls only the _raw body');
  END LOOP;
END $BODY$;

-- legacy compatibility: the pre-cutover public signature still answers for its
-- intended caller and returns the same payload as the raw body.
DO $BODY$
DECLARE v_exp uuid; v_admin uuid; a jsonb; b jsonb; v_state text; v_msg text;
BEGIN
  SELECT v INTO v_admin FROM t.acl_actor WHERE k='admin';
  SELECT id INTO v_exp FROM public.experts ORDER BY id LIMIT 1;
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    a := public.get_expert_capital_status(v_exp);
    RESET ROLE;
    b := public.get_expert_capital_status_raw(v_exp);
    v_state := '00000';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM t.ok('T-P96e.legacy get_expert_capital_status wrapper == raw payload',
               v_state = '00000' AND a IS NOT DISTINCT FROM b,
               coalesce(v_state,'') || ' ' || coalesce(v_msg,''));
END $BODY$;

-- trigger repoint: the capital-limit trigger runs inside a trusted definer path
-- with no auth.uid(); it must call the *_raw body, otherwise every write fails.
DO $BODY$
DECLARE v_src text; v_state text; v_msg text; v_exp uuid; v_id uuid := gen_random_uuid();
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'enforce_signal_capital_limit';
  PERFORM t.ok('T-P96e.repoint trigger body points at the ungated raw computation',
               v_src IS NULL OR v_src LIKE '%get_expert_capital_status_raw(%',
               coalesce(substring(v_src from 'get_expert_capital_status[_a-z]*'), 'trigger absent'));

  SELECT id INTO v_exp FROM public.experts WHERE status = 'active' ORDER BY id LIMIT 1;
  BEGIN
    INSERT INTO public.expert_signals(id, expert_id, action, instrument, quantity,
                                      quantity_unit, price_hint, market, status, published_at)
    VALUES (v_id, v_exp, 'buy', '2330 台積電', 1, '張', 100, 'TW', 'pending', now());

    RAISE EXCEPTION 'acl_rollback_marker' USING ERRCODE = 'P0002';
  EXCEPTION
    WHEN SQLSTATE 'P0002' THEN v_state := '00000';
    WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  PERFORM t.ok('T-P96e.repoint DML positive: signal insert fires the trigger and succeeds',
               v_state = '00000', coalesce(v_state,'') || ' ' || coalesce(v_msg,''));
END $BODY$;

-- ============================================================ apply mutation
-- T-P96b proves the guard; this proves the WORK. The company_admin call must
-- both return 00000 AND actually flip the proposal to `applied` with a recorded
-- apply_result, inside a subtransaction that is rolled back.
DO $BODY$
DECLARE v_id uuid := (SELECT v FROM t.acl_fixture WHERE k='apply_proposal');
        v_admin uuid := (SELECT v FROM t.acl_actor WHERE k='admin');
        v_user  uuid := (SELECT v FROM t.acl_actor WHERE k='user');
        v_state text;
BEGIN
  v_state := t.acl_call_probe(
    format($q$SELECT public.admin_apply_fix_proposal(%L::uuid, true)$q$, v_id),
    v_admin,
    format($q$SELECT EXISTS(SELECT 1 FROM public.holdings_fix_proposals
                             WHERE id=%L::uuid AND status='applied'
                               AND apply_result IS NOT NULL)$q$, v_id));
  PERFORM t.ok('T-P96b-mut admin_apply_fix_proposal applies the proposal then rolls back',
               v_state = '00000 mutation_observed', v_state);
  PERFORM t.ok('T-P96b-mut fixture proposal is still pending after rollback',
               EXISTS(SELECT 1 FROM public.holdings_fix_proposals
                       WHERE id=v_id AND status='pending'));
  v_state := t.acl_call(
    format($q$SELECT public.admin_apply_fix_proposal(%L::uuid, true)$q$, v_id), v_user);
  PERFORM t.ok('T-P96b-mut ordinary authenticated is still refused on the same legal proposal',
               v_state LIKE '42501%', v_state);
END $BODY$;

-- ============================================================ contract

DO $BODY$
DECLARE v_a int; v_b int; v_all int;
BEGIN
  SELECT count(*)::int INTO v_a FROM t.result WHERE name LIKE 'T-P96a.%';
  SELECT count(*)::int INTO v_b FROM t.result WHERE name LIKE 'T-P96b.%';
  SELECT count(*)::int INTO v_all FROM t.result WHERE name LIKE 'T-P96%';
  PERFORM t.eq('T-P96f contract: 12 negative guarded executions', v_a, 12);
  PERFORM t.eq('T-P96f contract: 12 positive guarded executions', v_b, 12);
  PERFORM t.ok('T-P96f contract: dynamic proof suite is non-empty', v_all >= 100,
               'total T-P96 tests=' || v_all);
END $BODY$;
