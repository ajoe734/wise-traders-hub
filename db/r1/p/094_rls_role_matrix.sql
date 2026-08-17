-- =====================================================================
-- R1-P 094 — non-superuser role matrix (T-P99R*).
--
-- Every probe below executes under a REAL Supabase runtime role
-- (anon / authenticated / service_role) via SET LOCAL ROLE, never as the
-- superuser, and records the exact SQLSTATE and returned row count. A probe
-- that is expected to be refused must be refused with 42501 (or 42P01/3F000
-- when the object is not even visible); a probe that is expected to be
-- allowed must return the exact expected row count.
--
-- Channels covered: public typed views, versioned/internal projection tables,
-- raw application tables under RLS, embargoed rows, cross-expert isolation,
-- admin/build/publish EXECUTE, and the RLS harness function itself.
-- Runs on the clone only. Production is never contacted.
-- =====================================================================
SET client_min_messages = warning;

CREATE SCHEMA IF NOT EXISTS tp94;

-- probe: run `p_sql` as `p_role`, always returning to the superuser afterwards.
CREATE OR REPLACE FUNCTION tp94.probe(p_role text, p_sql text, p_claim uuid DEFAULT NULL)
RETURNS TABLE(sqlstate_out text, rows_out bigint, err text)
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  sqlstate_out := '00000'; rows_out := -1; err := '';
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    IF p_claim IS NOT NULL THEN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', p_claim, 'role', p_role)::text, true);
    ELSE
      PERFORM set_config('request.jwt.claims', '', true);
    END IF;
    EXECUTE p_sql INTO n;
    rows_out := coalesce(n, 0);
  EXCEPTION WHEN OTHERS THEN
    sqlstate_out := SQLSTATE; err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION tp94.probe(text,text,uuid) FROM PUBLIC, anon, authenticated;

-- expectation recorders -------------------------------------------------
CREATE OR REPLACE FUNCTION tp94.deny(p_name text, p_role text, p_sql text, p_claim uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM tp94.probe(p_role, p_sql, p_claim);
  PERFORM t.ok(p_name,
    r.sqlstate_out IN ('42501','42P01','3F000','42883'),
    format('role=%s sqlstate=%s rows=%s msg=%s', p_role, r.sqlstate_out, r.rows_out, r.err));
END $$;

CREATE OR REPLACE FUNCTION tp94.allow(p_name text, p_role text, p_sql text, p_rows bigint, p_claim uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM tp94.probe(p_role, p_sql, p_claim);
  PERFORM t.ok(p_name,
    r.sqlstate_out = '00000' AND r.rows_out = p_rows,
    format('role=%s sqlstate=%s rows=%s expected_rows=%s msg=%s',
           p_role, r.sqlstate_out, r.rows_out, p_rows, r.err));
END $$;

-- =====================================================================
-- fixture: one expert with a released position and an embargoed position,
-- plus a second expert used for the cross-expert isolation probes.
-- =====================================================================
DO $$
DECLARE u1 uuid := 'aaaaaaa9-0000-4000-8000-000000000001';
        u2 uuid := 'aaaaaaa9-0000-4000-8000-000000000002';
        e1 uuid := 'bbbbbbb9-0000-4000-8000-000000000001';
        e2 uuid := 'bbbbbbb9-0000-4000-8000-000000000002';
        b1 uuid := 'ccccccc9-0000-4000-8000-000000000001';
        v  bigint;
BEGIN
  DROP TABLE IF EXISTS tp94.ids;
  CREATE TABLE tp94.ids(k text primary key, v uuid);
  INSERT INTO tp94.ids VALUES ('u1',u1),('u2',u2),('e1',e1),('e2',e2);

  INSERT INTO auth.users(id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (u1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','rm-owner@r1p.test',now(),now()),
         (u2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','rm-other@r1p.test',now(),now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.experts(id,user_id,slug,name,role,asset_class,currency,status,starting_capital)
  VALUES (e1,u1,'r1p-rolematrix-1','RM One','advisor','tw_stock','TWD','active',10000000),
         (e2,u2,'r1p-rolematrix-2','RM Two','advisor','tw_stock','TWD','active',10000000)
  ON CONFLICT (id) DO NOTHING;

  -- released (published 8 days ago) and embargoed (published today)
  INSERT INTO public.expert_signals(expert_id,batch_id,instrument,action,quantity,quantity_unit,
    price_hint,status,executed_at,published_at,created_at,market)
  VALUES (e1,b1,'2801','buy',1,'張',100,'published',now()-interval '8 days',now()-interval '8 days',now()-interval '8 days','TW'),
         (e1,b1,'2802','buy',1,'張',100,'published',now(),now(),now(),'TW');
  UPDATE app_ledger.economic_effect ee
     SET visible_at = ee.effective_at + interval '7 days'
   WHERE ee.expert_id = e1;

  v := app_ledger.canonical_publish(e1);
  PERFORM t.eq('T-P99R00 fixture: exactly one released position is public',
    (SELECT count(*)::int FROM public.public_position_projection WHERE projection_version = v), 1);
END $$;

-- =====================================================================
-- anon (9 probes)
-- =====================================================================
DO $$
DECLARE e1 uuid := (SELECT v FROM tp94.ids WHERE k='e1');
BEGIN
  PERFORM tp94.allow('T-P99R01 anon reads the public typed position view', 'anon',
    format('SELECT count(*) FROM public.public_position_active WHERE expert_id=%L', e1), 1);
  PERFORM tp94.allow('T-P99R02 anon never sees the embargoed instrument', 'anon',
    format('SELECT count(*) FROM public.public_position_active WHERE expert_id=%L AND instrument=''2802''', e1), 0);
  PERFORM tp94.deny('T-P99R03 anon cannot read the versioned projection table', 'anon',
    'SELECT count(*) FROM public.public_position_projection');
  PERFORM tp94.deny('T-P99R04 anon cannot read the withheld ledger', 'anon',
    'SELECT count(*) FROM public.public_projection_withheld');
  PERFORM tp94.deny('T-P99R05 anon cannot read the projection version table', 'anon',
    'SELECT count(*) FROM public.public_projection_version');
  PERFORM tp94.deny('T-P99R06 anon cannot read raw economic effects', 'anon',
    'SELECT count(*) FROM app_ledger.economic_effect');
  PERFORM tp94.deny('T-P99R07 anon cannot EXECUTE the publish builder', 'anon',
    format('SELECT app_ledger.canonical_publish(%L)', e1));
  PERFORM tp94.deny('T-P99R08 anon cannot EXECUTE the RLS harness', 'anon',
    'SELECT count(*) FROM public.run_rls_subscription_tests()');
  PERFORM tp94.deny('T-P99R09 anon cannot read auth.users', 'anon',
    'SELECT count(*) FROM auth.users');
END $$;

-- =====================================================================
-- authenticated, signed in as a plain member with NO subscription (7 probes)
-- =====================================================================
DO $$
DECLARE e1 uuid := (SELECT v FROM tp94.ids WHERE k='e1');
        u2 uuid := (SELECT v FROM tp94.ids WHERE k='u2');
BEGIN
  PERFORM tp94.allow('T-P99R10 a plain member reads the same public typed view', 'authenticated',
    format('SELECT count(*) FROM public.public_position_active WHERE expert_id=%L', e1), 1, u2);
  PERFORM tp94.allow('T-P99R11 a plain member still cannot see the embargoed row', 'authenticated',
    format('SELECT count(*) FROM public.public_position_active WHERE expert_id=%L AND instrument=''2802''', e1), 0, u2);
  PERFORM tp94.allow('T-P99R12 cross-expert: a member reads no trade_records of another expert', 'authenticated',
    format('SELECT count(*) FROM public.trade_records WHERE expert_id=%L', e1), 0, u2);
  PERFORM tp94.deny('T-P99R13 a plain member cannot read the versioned projection table', 'authenticated',
    'SELECT count(*) FROM public.public_position_projection', u2);
  PERFORM tp94.deny('T-P99R14 a plain member cannot read raw economic effects', 'authenticated',
    'SELECT count(*) FROM app_ledger.economic_effect', u2);
  PERFORM tp94.deny('T-P99R15 a plain member cannot EXECUTE the publish builder', 'authenticated',
    format('SELECT app_ledger.canonical_publish(%L)', e1), u2);
  PERFORM tp94.deny('T-P99R16 a plain member cannot EXECUTE the RLS harness', 'authenticated',
    'SELECT count(*) FROM public.run_rls_subscription_tests()', u2);
END $$;

-- =====================================================================
-- service_role: internal reader, still not a publisher (3 probes)
-- =====================================================================
DO $$
DECLARE e1 uuid := (SELECT v FROM tp94.ids WHERE k='e1');
BEGIN
  PERFORM tp94.allow('T-P99R17 service_role may read the internal projection table', 'service_role',
    format('SELECT count(*) FROM public.public_position_projection WHERE expert_id=%L', e1), 1);
  PERFORM tp94.allow('T-P99R18 service_role may read the withheld ledger', 'service_role',
    format('SELECT count(*) FROM public.public_projection_withheld WHERE expert_id=%L', e1), 0);
  PERFORM tp94.deny('T-P99R19 service_role is not a publisher either', 'service_role',
    format('SELECT app_ledger.canonical_publish(%L)', e1));
END $$;

\echo '--- R1-P 094 role matrix summary ---'
SELECT count(*) AS role_matrix_tests,
       count(*) FILTER (WHERE NOT passed) AS failures
  FROM t.result WHERE name LIKE 'T-P99R%';
SELECT name, coalesce(detail,'') FROM t.result WHERE name LIKE 'T-P99R%' AND NOT passed ORDER BY id;
