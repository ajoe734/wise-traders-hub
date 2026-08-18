-- =====================================================================
-- PV verifier — runs against a clone that has 000_clone_shape + 001_projection_view.
-- Every RLS assertion executes under a REAL role (anon / authenticated) with a
-- real request.jwt.claim.sub. service_role is never used as a stand-in.
-- Output: one line per check, "PASS|<id> <name>" / "FAIL|<id> <name> got=<v>".
-- =====================================================================
\pset tuples_only on
\pset format unaligned

CREATE TEMP TABLE pv_result(id text, name text, ok boolean, got text);
GRANT ALL ON pv_result TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.chk(_id text, _name text, _ok boolean, _got text DEFAULT '')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO pv_result VALUES (_id, _name, coalesce(_ok,false), _got)
$$;

CREATE OR REPLACE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(_uid,''), true);
END $$;

DO $pv$
DECLARE
  v_txt text; v_int int; v_bool boolean;
  admin_uid uuid := '00000000-0000-4000-8000-000000000099';
  e1 uuid := '00000000-0000-4000-9000-000000000001';  -- active
  e6 uuid := '00000000-0000-4000-9000-000000000006';  -- suspended
  e8 uuid := '00000000-0000-4000-9000-000000000008';  -- pending
  u1 uuid := '00000000-0000-4000-8000-000000000001';  -- owner of e1
  u8 uuid := '00000000-0000-4000-8000-000000000008';  -- owner of e8
  sub_uid uuid := '00000000-0000-4000-8000-000000000077';
  plan_id uuid;
BEGIN
  -- fixtures: company admin + a subscriber on e1
  INSERT INTO public.profiles(user_id) VALUES (admin_uid), (sub_uid) ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles(user_id, role) VALUES (admin_uid, 'company_admin') ON CONFLICT DO NOTHING;
  INSERT INTO public.expert_plans(expert_id) VALUES (e1) RETURNING id INTO plan_id;
  INSERT INTO public.member_subscriptions(user_id, plan_id, status) VALUES (sub_uid, plan_id, 'active');

  ------------------------------------------------------------------ shape
  SELECT count(*)::int INTO v_int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='public_expert_state_active' AND c.relkind='v';
  PERFORM pg_temp.chk('PV-01','view public.public_expert_state_active exists', v_int=1, v_int::text);

  SELECT coalesce(array_to_string(c.reloptions,','),'-') INTO v_txt FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='public_expert_state_active';
  PERFORM pg_temp.chk('PV-02','security_invoker=on (not SECURITY DEFINER)', v_txt='security_invoker=on', v_txt);

  SELECT string_agg(column_name||':'||data_type, ',' ORDER BY ordinal_position) INTO v_txt
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='public_expert_state_active';
  PERFORM pg_temp.chk('PV-03','exact reader contract columns',
    v_txt='expert_id:uuid,withheld_count:integer,incomplete_count:integer,manual_review_count:integer,state:text', v_txt);

  SELECT coalesce(c.relacl::text,'-') INTO v_txt FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='public_expert_state_active';
  PERFORM pg_temp.chk('PV-04','grants are SELECT-only for anon/authenticated/service_role',
    v_txt LIKE '%anon=r/%' AND v_txt LIKE '%authenticated=r/%' AND v_txt LIKE '%service_role=r/%'
      AND v_txt NOT LIKE '%anon=%w%' AND v_txt NOT LIKE '%authenticated=%w%', v_txt);

  SELECT bool_and(relrowsecurity) INTO v_bool FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN ('experts','trade_records','expert_signals');
  PERFORM pg_temp.chk('PV-05','base tables keep RLS enabled', v_bool, v_bool::text);

  SELECT pg_get_viewdef('public.public_expert_state_active'::regclass) INTO v_txt;
  PERFORM pg_temp.chk('PV-06','view exposes no private content columns',
    v_txt NOT LIKE '%reason_detail%' AND v_txt NOT LIKE '%learning_points%'
      AND v_txt NOT LIKE '%exit_price%' AND v_txt NOT LIKE '%current_price%', 'viewdef-scanned');

  ------------------------------------------------------------------ fidelity vs sanitized manifest
  SELECT count(*)::int INTO v_int FROM public.expert_signals;
  PERFORM pg_temp.chk('PV-07','173 expert_signals rows present', v_int=173, v_int::text);
  SELECT count(*)::int INTO v_int FROM public.trade_records;
  PERFORM pg_temp.chk('PV-08','82 trade_records rows present', v_int=82, v_int::text);
  SELECT count(DISTINCT expert_id)::int INTO v_int FROM public.expert_signals;
  PERFORM pg_temp.chk('PV-09','5 experts carry signals', v_int=5, v_int::text);
  SELECT count(*)::int INTO v_int FROM public.trade_records WHERE entry_price IS NULL;
  PERFORM pg_temp.chk('PV-10','trade_records entry_price NULL count is 0', v_int=0, v_int::text);
  SELECT count(*)::int INTO v_int FROM public.trade_records WHERE quantity = 0;
  PERFORM pg_temp.chk('PV-11','true-zero fixture present (quantity=0 is valid data)', v_int=1, v_int::text);

  ------------------------------------------------------------------ authorized admin
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user(admin_uid::text);
  SELECT count(*)::int INTO v_int FROM public.public_expert_state_active;
  PERFORM pg_temp.chk('PV-12','company_admin sees all 13 experts', v_int=13, v_int::text);
  SELECT state INTO v_txt FROM public.public_expert_state_active WHERE expert_id=e1;
  PERFORM pg_temp.chk('PV-13','company_admin: active expert state=ready', v_txt='ready', coalesce(v_txt,'NULL'));
  SELECT count(*)::int INTO v_int FROM public.public_expert_state_active WHERE state<>'ready';
  PERFORM pg_temp.chk('PV-14','no expert is incomplete on clean production-shape data', v_int=0, v_int::text);
  RESET ROLE;

  ------------------------------------------------------------------ analyst owner (the journal back-office case)
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user(u1::text);
  SELECT count(*)::int INTO v_int FROM public.public_expert_state_active WHERE expert_id=e1;
  PERFORM pg_temp.chk('PV-15','owner analyst sees own expert projection row', v_int=1, v_int::text);
  SELECT count(*)::int INTO v_int FROM public.public_expert_state_active WHERE expert_id<>e1;
  PERFORM pg_temp.chk('PV-16','owner analyst sees ONLY active experts + own (no cross-tenant leak of non-active)',
    v_int=4, v_int::text);
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user(u8::text);
  SELECT count(*)::int INTO v_int FROM public.public_expert_state_active WHERE expert_id=e8;
  PERFORM pg_temp.chk('PV-17','owner of a PENDING expert still sees own row (no route-name bypass needed)',
    v_int=1, v_int::text);
  SELECT count(*)::int INTO v_int FROM public.public_expert_state_active WHERE expert_id=e6;
  PERFORM pg_temp.chk('PV-18','cross-tenant: cannot see another analyst suspended expert', v_int=0, v_int::text);
  RESET ROLE;

  ------------------------------------------------------------------ subscriber + anonymous
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user(sub_uid::text);
  SELECT state INTO v_txt FROM public.public_expert_state_active WHERE expert_id=e1;
  PERFORM pg_temp.chk('PV-19','subscriber sees subscribed active expert as ready', v_txt='ready', coalesce(v_txt,'NULL'));
  SELECT count(*)::int INTO v_int FROM public.public_expert_state_active WHERE expert_id IN (e6,e8);
  PERFORM pg_temp.chk('PV-20','subscriber sees no suspended/pending expert', v_int=0, v_int::text);
  RESET ROLE;

  SET LOCAL ROLE anon;
  PERFORM pg_temp.as_user(NULL);
  SELECT count(*)::int INTO v_int FROM public.public_expert_state_active;
  PERFORM pg_temp.chk('PV-21','anonymous sees exactly the 5 active experts', v_int=5, v_int::text);
  SELECT count(*)::int INTO v_int FROM public.public_expert_state_active WHERE expert_id IN (e6,e8);
  PERFORM pg_temp.chk('PV-22','anonymous: missing row for non-active expert (reader fails closed)', v_int=0, v_int::text);
  SELECT state INTO v_txt FROM public.public_expert_state_active WHERE expert_id=e1;
  PERFORM pg_temp.chk('PV-23','anonymous: active expert is ready', v_txt='ready', coalesce(v_txt,'NULL'));
  RESET ROLE;

  ------------------------------------------------------------------ incomplete / degradation path
  UPDATE public.trade_records SET entry_price = NULL
   WHERE id = (SELECT id FROM public.trade_records WHERE expert_id=e1 AND status='open' ORDER BY instrument LIMIT 1);
  SET LOCAL ROLE anon; PERFORM pg_temp.as_user(NULL);
  SELECT state||'/'||incomplete_count INTO v_txt FROM public.public_expert_state_active WHERE expert_id=e1;
  PERFORM pg_temp.chk('PV-24','open trade with no entry price -> state=incomplete/1', v_txt='incomplete/1', coalesce(v_txt,'NULL'));
  SELECT count(*)::int INTO v_int FROM public.public_expert_state_active WHERE expert_id<>e1 AND state<>'ready';
  PERFORM pg_temp.chk('PV-25','degradation is scoped to the affected expert only', v_int=0, v_int::text);
  RESET ROLE;
  UPDATE public.trade_records SET entry_price = 101
   WHERE entry_price IS NULL AND expert_id=e1;
  SET LOCAL ROLE anon; PERFORM pg_temp.as_user(NULL);
  SELECT state INTO v_txt FROM public.public_expert_state_active WHERE expert_id=e1;
  PERFORM pg_temp.chk('PV-26','reverting the fixture returns the expert to ready', v_txt='ready', coalesce(v_txt,'NULL'));
  RESET ROLE;

  ------------------------------------------------------------------ true zero stays ready
  SET LOCAL ROLE anon; PERFORM pg_temp.as_user(NULL);
  SELECT count(*)::int INTO v_int FROM public.trade_records WHERE quantity=0 AND status='open';
  PERFORM pg_temp.chk('PV-27','anonymous can read the true-zero open position', v_int=1, v_int::text);
  SELECT state INTO v_txt FROM public.public_expert_state_active WHERE expert_id=e1;
  PERFORM pg_temp.chk('PV-28','a real quantity=0 position does NOT gate the expert', v_txt='ready', coalesce(v_txt,'NULL'));
  RESET ROLE;

  ------------------------------------------------------------------ write surface
  SET LOCAL ROLE authenticated; PERFORM pg_temp.as_user(admin_uid::text);
  BEGIN
    EXECUTE 'INSERT INTO public.public_expert_state_active(expert_id, withheld_count, incomplete_count, manual_review_count, state) VALUES (gen_random_uuid(),0,0,0,''ready'')';
    PERFORM pg_temp.chk('PV-29','view is not writable', false, 'insert succeeded');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.chk('PV-29','view is not writable', true, SQLSTATE);
  END;
  RESET ROLE;
END $pv$;

SELECT CASE WHEN ok THEN 'PASS|' ELSE 'FAIL|' END || id || ' ' || name ||
       CASE WHEN ok THEN '' ELSE ' got=' || got END
  FROM pv_result ORDER BY id;
SELECT 'SUMMARY checks=' || count(*) || ' failures=' || count(*) FILTER (WHERE NOT ok) FROM pv_result;
