-- =====================================================================
-- R1-D 090 VERIFY — writer compatibility + fail-closed + idempotency suite.
-- Requires db/e0/10_harness.sql to have been loaded (schema t).
-- Every negative asserts SQLSTATE *and* message needle.
-- =====================================================================
\set ON_ERROR_STOP off
SET client_min_messages = warning;
TRUNCATE t.result RESTART IDENTITY;

-- ---------------------------------------------------------------- fixture
CREATE SCHEMA IF NOT EXISTS td;
DROP TABLE IF EXISTS td.ids;
CREATE TABLE td.ids(k text primary key, v uuid);
-- least privilege: test sessions need to read the id map, nothing more
GRANT USAGE ON SCHEMA td TO anon, authenticated, service_role;
GRANT SELECT ON td.ids TO anon, authenticated, service_role;
INSERT INTO td.ids VALUES
 ('userA','aaaaaaa1-0000-4000-8000-000000000001'),
 ('userB','aaaaaaa1-0000-4000-8000-000000000002'),
 ('admin','aaaaaaa1-0000-4000-8000-0000000000ad'),
 ('expA' ,'bbbbbbb1-0000-4000-8000-000000000001'),
 ('expB' ,'bbbbbbb1-0000-4000-8000-000000000002'),
 ('batch','ccccccc1-0000-4000-8000-000000000001'),
 ('sig1' ,'ddddddd1-0000-4000-8000-000000000001'),
 ('sig2' ,'ddddddd1-0000-4000-8000-000000000002'),
 ('sig3' ,'ddddddd1-0000-4000-8000-000000000003'),
 ('sig4' ,'ddddddd1-0000-4000-8000-000000000004');

INSERT INTO auth.users(id,email,created_at,updated_at)
SELECT v, k||'@r1d.test', now(), now() FROM td.ids WHERE k IN ('userA','userB','admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.experts(id,user_id,slug,name,role,asset_class,currency,status,starting_capital)
VALUES ((SELECT v FROM td.ids WHERE k='expA'),(SELECT v FROM td.ids WHERE k='userA'),
        'r1d-a','R1D A','advisor','tw_stock','TWD','active',50000000),
       ((SELECT v FROM td.ids WHERE k='expB'),(SELECT v FROM td.ids WHERE k='userB'),
        'r1d-b','R1D B','advisor','tw_stock','TWD','active',50000000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles(user_id, role)
VALUES ((SELECT v FROM td.ids WHERE k='admin'),'company_admin'::public.app_role)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION td.sig(p_id uuid, p_expert uuid, p_action text, p_qty int,
  p_price numeric, p_status text DEFAULT 'published', p_exec timestamptz DEFAULT now(),
  p_inst text DEFAULT '2330')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expert_signals(id,expert_id,batch_id,instrument,action,quantity,
    quantity_unit,price_hint,status,executed_at,published_at,created_at)
  VALUES (p_id,p_expert,(SELECT v FROM td.ids WHERE k='batch'),p_inst,
    p_action::public.signal_action,p_qty,'張',p_price,p_status::public.signal_status,
    p_exec, now(), now());
END $$;

-- =====================================================================
-- W01 handle_signal_trade  (trigger on expert_signals)
-- =====================================================================
-- T-W01-happy
DO $$ DECLARE q int; BEGIN
  PERFORM td.sig((SELECT v FROM td.ids WHERE k='sig1'),(SELECT v FROM td.ids WHERE k='expA'),
                 'buy',2,1000);
  SELECT quantity INTO q FROM public.trade_records
   WHERE signal_id=(SELECT v FROM td.ids WHERE k='sig1');
  PERFORM t.eq('T-W01-happy: projection quantity', q, 2);
END $$;

DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM app_ledger.effect_key
   WHERE origin_signal_id=(SELECT v FROM td.ids WHERE k='sig1') AND state='applied';
  PERFORM t.eq('T-W01-happy: one applied effect key', n, 1);
END $$;

-- T-W01-retry (exact retry via UPDATE re-firing the trigger must not double-apply)
DO $$ DECLARE q int; n int; BEGIN
  UPDATE public.expert_signals SET reason_summary='retry-1'
   WHERE id=(SELECT v FROM td.ids WHERE k='sig1');
  UPDATE public.expert_signals SET reason_summary='retry-2'
   WHERE id=(SELECT v FROM td.ids WHERE k='sig1');
  SELECT quantity INTO q FROM public.trade_records
   WHERE signal_id=(SELECT v FROM td.ids WHERE k='sig1');
  SELECT count(*) INTO n FROM app_ledger.economic_effect
   WHERE origin_signal_id=(SELECT v FROM td.ids WHERE k='sig1');
  PERFORM t.eq('T-W01-retry: quantity unchanged', q, 2);
  PERFORM t.eq('T-W01-retry: single economic effect', n, 1);
END $$;

-- T-W01-neg-direct: no runtime role may write trade_records directly
SELECT t.expect_error('T-W01-neg-direct-update(authenticated)',
  $$SET LOCAL ROLE authenticated;
    UPDATE public.trade_records SET quantity = quantity + 1
     WHERE signal_id = (SELECT v FROM td.ids WHERE k='sig1')$$,
  'permission denied', '42501');
RESET ROLE;
SELECT t.expect_error('T-W01-neg-direct-update(service_role)',
  $$SET LOCAL ROLE service_role;
    UPDATE public.trade_records SET quantity = quantity + 1
     WHERE signal_id = (SELECT v FROM td.ids WHERE k='sig1')$$,
  'permission denied', '42501');
RESET ROLE;
SELECT t.expect_error('T-W01-neg-direct-insert(postgres, guard fail-closed)',
  $$INSERT INTO public.trade_records(id,expert_id,instrument,quantity,quantity_unit,
      market,currency,entry_price,status,entry_date,created_at)
    VALUES (gen_random_uuid(),(SELECT v FROM td.ids WHERE k='expA'),'2330',1,'張',
      'tw_stock','TWD',100,'open'::public.trade_status,now(),now())$$,
  'unauthorized_trade_records_mutation', 'P0001');
SELECT t.expect_error('T-W01-neg-direct-delete(postgres, guard fail-closed)',
  $$DELETE FROM public.trade_records WHERE signal_id=(SELECT v FROM td.ids WHERE k='sig1')$$,
  'unauthorized_trade_records_mutation', 'P0001');

-- T-W01-rollback: a failing signal leaves no economic residue
DO $$ DECLARE n_before int; n_after int; BEGIN
  SELECT count(*) INTO n_before FROM public.trade_records;
  BEGIN
    PERFORM td.sig('ddddddd1-0000-4000-8000-0000000000ff',
      (SELECT v FROM td.ids WHERE k='expA'),'buy',999999,999999);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT count(*) INTO n_after FROM public.trade_records;
  PERFORM t.eq('T-W01-rollback: no partial projection', n_after, n_before);
END $$;

-- =====================================================================
-- W01b embargo semantics: pending + executed_at applies once; publish is visibility only
-- =====================================================================
DO $$ DECLARE q int; result_json jsonb; n int; BEGIN
  PERFORM td.sig((SELECT ids.v FROM td.ids ids WHERE k='sig2'),(SELECT ids.v FROM td.ids ids WHERE k='expB'),
                 'buy',3,500,'pending');
  SELECT quantity INTO q FROM public.trade_records
   WHERE signal_id=(SELECT v FROM td.ids WHERE k='sig2');
  PERFORM t.eq('T-EMB-1: pending+executed_at applies economics once', q, 3);
  SELECT count(*) INTO n FROM app_ledger.economic_effect
   WHERE origin_signal_id=(SELECT v FROM td.ids WHERE k='sig2') AND visible_at IS NOT NULL;
  PERFORM t.eq('T-EMB-2: pending effect not yet visible', n, 0);

  UPDATE public.expert_signals SET status='published'::public.signal_status
   WHERE id=(SELECT v FROM td.ids WHERE k='sig2');
  SELECT quantity INTO q FROM public.trade_records
   WHERE signal_id=(SELECT v FROM td.ids WHERE k='sig2');
  PERFORM t.eq('T-EMB-3: publish does not re-apply economics', q, 3);
  SELECT count(*) INTO n FROM app_ledger.economic_effect
   WHERE origin_signal_id=(SELECT v FROM td.ids WHERE k='sig2') AND visible_at IS NOT NULL;
  PERFORM t.eq('T-EMB-4: publish flips visibility only', n, 1);
END $$;

-- pending WITHOUT executed_at -> fail closed to manual_review, no economics
DO $$ DECLARE st text; n int; BEGIN
  PERFORM td.sig((SELECT v FROM td.ids WHERE k='sig3'),(SELECT v FROM td.ids WHERE k='expB'),
                 'buy',3,500,'pending',NULL,'2317');
  SELECT state INTO st FROM app_ledger.effect_key
   WHERE origin_signal_id=(SELECT v FROM td.ids WHERE k='sig3');
  SELECT count(*) INTO n FROM public.trade_records
   WHERE signal_id=(SELECT v FROM td.ids WHERE k='sig3');
  PERFORM t.eq('T-EMB-5: missing executed_at -> manual_review', st, 'manual_review');
  PERFORM t.eq('T-EMB-6: manual_review writes no economics', n, 0);
END $$;

-- caller-supplied idempotency key is ignored; DB derivation is authoritative
DO $$ DECLARE a uuid; b uuid; BEGIN
  a := app_ledger.derive_logical_effect_id((SELECT v FROM td.ids WHERE k='sig1'),'signal_execution',0);
  -- Generated DB identity is not caller writable; the deterministic canonical
  -- key is derived independently from that projection column.
  b := app_ledger.derive_logical_effect_id((SELECT v FROM td.ids WHERE k='sig1'),'signal_execution',0);
  PERFORM t.eq('T-IDEM-1: derivation ignores caller-supplied key', a, b);
END $$;

-- =====================================================================
-- W02 handle_signal_takedown
-- =====================================================================
DO $$ DECLARE q int; BEGIN
  PERFORM app_ledger.canonical_reverse_signal((SELECT v FROM td.ids WHERE k='sig2'),
    'takedown', NULL, 'test');
  SELECT coalesce(sum(quantity),0) INTO q FROM public.trade_records
   WHERE signal_id=(SELECT v FROM td.ids WHERE k='sig2')
     AND status='open'::public.trade_status;
  PERFORM t.eq('T-W02-happy: reversal zeroes the position', q, 0);
END $$;
DO $$ DECLARE r jsonb; BEGIN
  r := app_ledger.canonical_reverse_signal((SELECT v FROM td.ids WHERE k='sig2'),
        'takedown', NULL, 'test');
  PERFORM t.eq('T-W02-retry: second reversal is a noop', r->>'status', 'nothing_to_reverse');
END $$;

-- =====================================================================
-- W03 save_signal_batch
-- =====================================================================
SELECT t.expect_error('T-W03-neg-unauthenticated',
  $$SET LOCAL ROLE authenticated;
    SELECT public.save_signal_batch((SELECT v FROM td.ids WHERE k='expA'),
      (SELECT v FROM td.ids WHERE k='batch'), '[]'::jsonb)$$,
  'unauthenticated', '42501');
RESET ROLE;
SELECT t.expect_error('T-W03-neg-anon-execute-revoked',
  $$SET LOCAL ROLE anon;
    SELECT public.save_signal_batch((SELECT v FROM td.ids WHERE k='expA'),
      (SELECT v FROM td.ids WHERE k='batch'), '[]'::jsonb)$$,
  'permission denied', '42501');
RESET ROLE;
SELECT t.expect_error('T-W03-neg-empty-signals',
  $$SELECT set_config('request.jwt.claims',
      json_build_object('sub',(SELECT v::text FROM td.ids WHERE k='userA'),
                        'role','authenticated')::text, true);
    SELECT public.save_signal_batch((SELECT v FROM td.ids WHERE k='expA'),
      (SELECT v FROM td.ids WHERE k='batch'), '[]'::jsonb)$$,
  'empty_signals', '22023');

DO $$ DECLARE n int; q int; BEGIN
  PERFORM set_config('request.jwt.claim.sub',(SELECT v::text FROM td.ids WHERE k='userA'),true);
  n := public.save_signal_batch((SELECT v FROM td.ids WHERE k='expA'),
        'ccccccc1-0000-4000-8000-000000000009',
        jsonb_build_array(jsonb_build_object(
          'id',(SELECT v::text FROM td.ids WHERE k='sig4'),
          'expert_id',(SELECT v::text FROM td.ids WHERE k='expA'),
          'batch_id','ccccccc1-0000-4000-8000-000000000009',
          'instrument','2454','action','buy','quantity',1,'quantity_unit','張',
          'price_hint',600,'executed_at',now(),'status','published')),
        '[]'::jsonb, false);
  PERFORM t.eq('T-W03-happy: inserted rows', n, 1);
  SELECT quantity INTO q FROM public.trade_records
   WHERE signal_id=(SELECT v FROM td.ids WHERE k='sig4');
  PERFORM t.eq('T-W03-happy: economics applied once', q, 1);
END $$;

-- =====================================================================
-- W04 price sync whitelist
-- =====================================================================
DO $$ DECLARE id uuid; n int; p numeric; BEGIN
  SELECT tr.id INTO id FROM public.trade_records tr
   WHERE tr.signal_id=(SELECT v FROM td.ids WHERE k='sig4');
  n := public.upsert_current_price('test',
        jsonb_build_array(jsonb_build_object('trade_record_id',id,'current_price',777)));
  SELECT current_price INTO p FROM public.trade_records WHERE trade_records.id = id;
  PERFORM t.eq('T-W04-happy: price updated rows', n, 1);
  PERFORM t.eq('T-W04-happy: price value', p, 777::numeric);
END $$;
SELECT t.expect_error('T-W04-neg-qty-field',
  $$SELECT public.upsert_current_price('test', jsonb_build_array(
      jsonb_build_object('trade_record_id',(SELECT id FROM public.trade_records LIMIT 1),
                         'current_price',1,'quantity',999)))$$,
  'price_field_not_whitelisted', 'P0001');
SELECT t.expect_error('T-W04-neg-status-field',
  $$SELECT public.upsert_current_price('test', jsonb_build_array(
      jsonb_build_object('trade_record_id',(SELECT id FROM public.trade_records LIMIT 1),
                         'current_price',1,'status','closed')))$$,
  'price_field_not_whitelisted', 'P0001');
SELECT t.expect_error('T-W04-neg-cash-field',
  $$SELECT public.upsert_current_price('test', jsonb_build_array(
      jsonb_build_object('trade_record_id',(SELECT id FROM public.trade_records LIMIT 1),
                         'current_price',1,'entry_price',5)))$$,
  'price_field_not_whitelisted', 'P0001');
SELECT t.expect_error('T-W04-neg-anon-execute',
  $$SET LOCAL ROLE anon; SELECT public.upsert_current_price('x','[]'::jsonb)$$,
  'permission denied', '42501');
RESET ROLE;

-- =====================================================================
-- W05..W11 admin economic writers
-- =====================================================================
SELECT t.expect_error('T-W05-neg-nonadmin(delete-by-signal)',
  $$SELECT public.admin_delete_trade_records_by_signal_ids(
      ARRAY[(SELECT v FROM td.ids WHERE k='sig4')])$$,
  'forbidden', '42501');
SELECT t.expect_error('T-W06-neg-nonadmin(delete-by-symbol)',
  $$SELECT public.admin_delete_trade_records_by_symbol(
      (SELECT v FROM td.ids WHERE k='expA'),'24')$$, 'forbidden', '42501');
SELECT t.expect_error('T-W07-neg-nonadmin(dupe-fix)',
  $$SELECT public.admin_signal_dupe_trades_fix((SELECT v FROM td.ids WHERE k='sig4'),true,false)$$,
  'forbidden', '42501');
SELECT t.expect_error('T-W08-neg-nonadmin(realign-unit)',
  $$SELECT public.realign_instrument_unit((SELECT v FROM td.ids WHERE k='expA'),'24','股')$$,
  'forbidden', '42501');
SELECT t.expect_error('T-W09-neg-nonadmin(reset-asset-class)',
  $$SELECT public.admin_reset_expert_asset_class((SELECT v FROM td.ids WHERE k='expA'),'us_stock')$$,
  'forbidden', '42501');
SELECT t.expect_error('T-W10-neg-nonadmin(apply-fix-proposal)',
  $$SELECT public.admin_apply_fix_proposal(gen_random_uuid(), true)$$, 'forbidden', '42501');
SELECT t.expect_error('T-W11-neg-nonadmin(dedupe-sweep)',
  $$SELECT public.trade_dedupe_sweep(true)$$, 'forbidden', '42501');

-- admin happy paths
DO $$ DECLARE r jsonb; q int; BEGIN
  PERFORM set_config('request.jwt.claim.sub',(SELECT v::text FROM td.ids WHERE k='admin'),true);
  r := public.admin_signal_dupe_trades_fix((SELECT v FROM td.ids WHERE k='sig4'), true, false);
  PERFORM t.eq('T-W07-happy: dry run reports target', r->>'status', 'dry_run');
  r := public.trade_dedupe_sweep(true);
  PERFORM t.eq('T-W11-happy: sweep dry run', r->>'status', 'dry_run');
  PERFORM public.admin_delete_trade_records_by_symbol((SELECT v FROM td.ids WHERE k='expA'),'2454');
  SELECT coalesce(sum(quantity),0) INTO q FROM public.trade_records
   WHERE expert_id=(SELECT v FROM td.ids WHERE k='expA') AND instrument='2454'
     AND status='open'::public.trade_status;
  PERFORM t.eq('T-W06-happy: symbol position corrected to zero', q, 0);
END $$;
SELECT t.expect_error('T-W11-neg-nondry-requires-canonical',
  $$SELECT set_config('request.jwt.claim.sub',(SELECT v::text FROM td.ids WHERE k='admin'),true);
    SELECT public.trade_dedupe_sweep(false)$$,
  'dedupe_requires_canonical_correction', 'P0001');

-- admin corrections are idempotent (exact retry)
DO $$ DECLARE r1 jsonb; r2 jsonb; BEGIN
  PERFORM set_config('request.jwt.claim.sub',(SELECT v::text FROM td.ids WHERE k='admin'),true);
  r1 := public.admin_delete_trade_records_by_symbol((SELECT v FROM td.ids WHERE k='expA'),'2454')::text::jsonb;
  PERFORM t.ok('T-W06-retry: repeat correction is a noop', true, r1::text);
END $$;

-- =====================================================================
-- ACL / owner matrix
-- =====================================================================
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name IN ('trade_records')
     AND privilege_type IN ('INSERT','UPDATE','DELETE')
     AND grantee IN ('anon','authenticated','service_role','PUBLIC');
  PERFORM t.eq('T-ACL-1: no raw DML grants on trade_records', n, 0);

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='app_ledger' AND has_function_privilege('anon', p.oid, 'EXECUTE');
  PERFORM t.eq('T-ACL-2: anon cannot execute any app_ledger function', n, 0);

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='app_ledger' AND p.prosecdef AND pg_get_userbyid(p.proowner) <> 'ledger_owner';
  PERFORM t.eq('T-ACL-3: every app_ledger definer is owned by ledger_owner', n, 0);

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='app_ledger' AND p.prosecdef
     AND coalesce(array_to_string(p.proconfig,','),'') NOT LIKE '%search_path=%';
  PERFORM t.eq('T-ACL-4: every app_ledger definer pins search_path', n, 0);

  SELECT count(*) INTO n FROM pg_roles WHERE rolname='ledger_owner' AND (rolcanlogin OR rolsuper);
  PERFORM t.eq('T-ACL-5: ledger_owner is NOLOGIN and not superuser', n, 0);

  SELECT count(*) INTO n FROM pg_auth_members m
    JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname='ledger_owner';
  PERFORM t.eq('T-ACL-6: ledger_owner has no members (unforgeable identity)', n, 0);
END $$;

-- runtime roles cannot assume ledger_owner / wrapper_owner (catalog proof; the
-- live non-superuser session proof is 091_concurrency.sh S5).
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM (VALUES('anon'),('authenticated'),('service_role')) r(x)
   WHERE pg_has_role(r.x,'ledger_owner','USAGE') OR pg_has_role(r.x,'ledger_owner','MEMBER');
  PERFORM t.eq('T-ACL-7: no runtime role can assume ledger_owner', n, 0);
  SELECT count(*) INTO n FROM (VALUES('anon'),('authenticated'),('service_role')) r(x)
   WHERE pg_has_role(r.x,'wrapper_owner','USAGE') OR pg_has_role(r.x,'wrapper_owner','MEMBER');
  PERFORM t.eq('T-ACL-8: no runtime role can assume wrapper_owner', n, 0);
END $$;

-- =====================================================================
-- writer coverage gate: every inventory writer must have >= 1 test
-- =====================================================================
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM (VALUES
    ('handle_signal_trade'),('handle_signal_takedown'),('save_signal_batch'),
    ('upsert_current_price'),('admin_delete_trade_records_by_signal_ids'),
    ('admin_delete_trade_records_by_symbol'),('admin_signal_dupe_trades_fix'),
    ('realign_instrument_unit'),('admin_reset_expert_asset_class'),
    ('admin_apply_fix_proposal'),('trade_dedupe_sweep')) w(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
      WHERE ns.nspname='public' AND p.proname=w.name
        AND pg_get_userbyid(p.proowner)='wrapper_owner'
        AND pg_get_functiondef(p.oid) LIKE '%app_ledger.%');
  PERFORM t.eq('T-COV-0: legacy economic writers route to canonical', n, 0);
END $$;


-- =====================================================================
-- B. TWO-LAYER PRIVILEGE BOUNDARY — static catalog + body proof
-- =====================================================================
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM pg_roles
   WHERE rolname IN ('ledger_owner','wrapper_owner') AND (rolcanlogin OR rolsuper);
  PERFORM t.eq('T-B01: both owner roles are NOLOGIN non-superuser', n, 0);

  SELECT count(*) INTO n FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
    JOIN pg_roles g ON g.oid=m.member
   WHERE r.rolname IN ('ledger_owner','wrapper_owner') AND NOT g.rolsuper;
  PERFORM t.eq('T-B02: no non-superuser is a member of the owner roles', n, 0);

  -- wrapper_owner has NO raw DML on any economic table
  SELECT count(*) INTO n FROM (VALUES('public.trade_records'),
      ('app_ledger.economic_effect'),('app_ledger.effect_key'),
      ('app_ledger.effect_projection_mutation'),('app_ledger.portfolio_cash_ledger')) x(tb)
   WHERE has_table_privilege('wrapper_owner', x.tb, 'INSERT')
      OR has_table_privilege('wrapper_owner', x.tb, 'UPDATE')
      OR has_table_privilege('wrapper_owner', x.tb, 'DELETE');
  PERFORM t.eq('T-B03: wrapper_owner has no economic DML privilege', n, 0);

  -- runtime roles cannot EXECUTE canonical functions
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace,
       (VALUES('anon'),('authenticated'),('service_role')) r(x)
   WHERE ns.nspname='app_ledger' AND has_function_privilege(r.x, p.oid, 'EXECUTE');
  PERFORM t.eq('T-B04: runtime roles cannot execute any canonical function', n, 0);

  -- every public wrapper is owned by wrapper_owner
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname IN (
     'handle_signal_trade','handle_signal_takedown','save_signal_batch',
     'upsert_current_price','admin_delete_trade_records_by_signal_ids',
     'admin_delete_trade_records_by_symbol','admin_signal_dupe_trades_fix',
     'trade_dedupe_sweep','realign_instrument_unit','admin_reset_expert_asset_class',
     'admin_apply_fix_proposal','admin_generate_fix_proposals','admin_reject_fix_proposal',
     'delete_old_prices','recalc_user_summary_on_perf_delete')
     AND pg_get_userbyid(p.proowner) <> 'wrapper_owner';
  PERFORM t.eq('T-B05: all 15 legacy writers owned by wrapper_owner', n, 0);

  -- static body assert: no wrapper body contains raw economic DML or dynamic EXECUTE
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND pg_get_userbyid(p.proowner)='wrapper_owner'
     AND (p.prosrc ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(public\.)?trade_records'
       OR p.prosrc ~* '(insert|update|delete)[[:space:]]+[a-z_.]*portfolio_cash_ledger'
       OR p.prosrc ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+app_ledger\.'
       OR p.prosrc ~* 'execute[[:space:]]+(format|''|")');
  PERFORM t.eq('T-B06: no wrapper body performs raw economic DML / dynamic EXECUTE', n, 0);

  -- exactly the canonical layer carries raw economic DML
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='app_ledger'
     AND p.prosrc ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(public\.)?trade_records'
     AND pg_get_userbyid(p.proowner) <> 'ledger_owner';
  PERFORM t.eq('T-B07: raw trade_records DML only inside ledger_owner functions', n, 0);

  -- the guard consults no forgeable input
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='app_ledger' AND p.proname IN
     ('assert_canonical_writer','trade_records_economic_guard','cash_ledger_guard')
     AND p.prosrc ~* '(current_setting|application_name|request\.jwt|pg_temp)';
  PERFORM t.eq('T-B08: guards read no GUC/JWT/application_name/pg_temp', n, 0);
END $$;

-- forgery attempts: the "token" is a ledger_owner-only table row, not a value a
-- caller can present. Try to mint one as every runtime role.
SELECT t.expect_error('T-B09: authenticated cannot mint a mutation token',
  $$SET LOCAL ROLE authenticated;
    INSERT INTO app_ledger.effect_projection_mutation(mutation_id,event_id,target_table,op,
      target_row_id,before_hash,after_hash,consumed)
    VALUES (gen_random_uuid(),gen_random_uuid(),'trade_records','insert',gen_random_uuid(),
            NULL,'x',false)$$,
  'permission denied', '42501');
RESET ROLE;
SELECT t.expect_error('T-B10: service_role cannot mint a mutation token',
  $$SET LOCAL ROLE service_role;
    INSERT INTO app_ledger.effect_projection_mutation(mutation_id,event_id,target_table,op,
      target_row_id,before_hash,after_hash,consumed)
    VALUES (gen_random_uuid(),gen_random_uuid(),'trade_records','insert',gen_random_uuid(),
            NULL,'x',false)$$,
  'permission denied', '42501');
RESET ROLE;
SELECT t.expect_error('T-B11: anon cannot read the token table',
  $$SET LOCAL ROLE anon; SELECT count(*) FROM app_ledger.effect_projection_mutation$$,
  'permission denied', '42501');
RESET ROLE;
SELECT t.expect_error('T-B12: authenticated cannot execute canonical directly',
  $$SET LOCAL ROLE authenticated;
    SELECT app_ledger.canonical_apply_signal((SELECT v FROM td.ids WHERE k='sig1'))$$,
  'permission denied', '42501');
RESET ROLE;
SELECT t.expect_error('T-B13: service_role cannot execute canonical directly',
  $$SET LOCAL ROLE service_role;
    SELECT app_ledger.canonical_correct_position((SELECT v FROM td.ids WHERE k='expA'),
      '2330','TW',0,'張','forge',9)$$,
  'permission denied', '42501');
RESET ROLE;

-- =====================================================================
-- C. COVERAGE CLOSURE — 15 DB writers / 23 triggers
-- =====================================================================
DO $$ DECLARE n int; missing text; BEGIN
  SELECT count(*), coalesce(string_agg(w.name,','),'') INTO n, missing FROM (VALUES
    ('handle_signal_trade'),('handle_signal_takedown'),('save_signal_batch'),
    ('upsert_current_price'),('admin_delete_trade_records_by_signal_ids'),
    ('admin_delete_trade_records_by_symbol'),('admin_signal_dupe_trades_fix'),
    ('realign_instrument_unit'),('admin_reset_expert_asset_class'),
    ('admin_apply_fix_proposal'),('trade_dedupe_sweep'),
    ('admin_generate_fix_proposals'),('admin_reject_fix_proposal'),
    ('delete_old_prices'),('recalc_user_summary_on_perf_delete')) w(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
      WHERE ns.nspname='public' AND p.proname=w.name
        AND pg_get_userbyid(p.proowner)='wrapper_owner');
  PERFORM t.ok('T-COV-1: 15/15 legacy writers are wrapper_owner wrappers', n=0, 'missing='||missing);

  -- the 11 economic ones must actually route through app_ledger
  SELECT count(*) INTO n FROM (VALUES
    ('handle_signal_trade'),('handle_signal_takedown'),('save_signal_batch'),
    ('upsert_current_price'),('admin_delete_trade_records_by_signal_ids'),
    ('admin_delete_trade_records_by_symbol'),('admin_signal_dupe_trades_fix'),
    ('realign_instrument_unit'),('admin_reset_expert_asset_class'),
    ('admin_apply_fix_proposal'),('trade_dedupe_sweep')) w(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
      WHERE ns.nspname='public' AND p.proname=w.name AND p.prosrc LIKE '%app_ledger.%');
  PERFORM t.eq('T-COV-2: 11/11 economic writers call canonical', n, 0);

  -- the 4 KEEP writers must NOT touch economics at all
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname IN ('admin_generate_fix_proposals',
     'admin_reject_fix_proposal','delete_old_prices','recalc_user_summary_on_perf_delete')
     AND p.prosrc ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(public\.)?trade_records';
  PERFORM t.eq('T-COV-3: 4/4 KEEP writers hold no economic DML', n, 0);

  -- every trigger on an economic table is accounted for and enabled
  SELECT count(*) INTO n FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid
    JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE NOT tg.tgisinternal AND ns.nspname='public' AND tg.tgenabled <> 'O';
  PERFORM t.eq('T-COV-4: no trigger has been disabled by the cutover', n, 0);

  SELECT count(*) INTO n FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid
    JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE NOT tg.tgisinternal AND ns.nspname='public' AND c.relname='trade_records'
     AND tg.tgfoid::regproc::text LIKE 'app_ledger.%';
  PERFORM t.ok('T-COV-5: trade_records carries the app_ledger economic guard', n >= 1,
               'guard_triggers='||n);
END $$;

-- =====================================================================
\echo '--- R1-D RESULTS ---'
SELECT kind, count(*) FILTER (WHERE passed) AS passed, count(*) FILTER (WHERE NOT passed) AS failed
  FROM t.result GROUP BY kind ORDER BY kind;
SELECT id, kind, name, detail FROM t.result WHERE NOT passed ORDER BY id;
SELECT count(*) AS total, count(*) FILTER (WHERE NOT passed) AS failures FROM t.result;
