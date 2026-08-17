-- =====================================================================
-- Stage B v6 clone verifier. Emits one "PASS|FAIL|GAP <id> <desc>" per check.
-- Runs entirely inside the disposable clone. Never touches production.
-- =====================================================================
\set ON_ERROR_STOP off
SET client_min_messages = warning;

CREATE TEMP TABLE _r(seq serial, id text, ok text, note text);
CREATE OR REPLACE FUNCTION pg_temp.chk(p_id text, p_ok boolean, p_note text DEFAULT '')
RETURNS void LANGUAGE sql AS
$$ INSERT INTO _r(id, ok, note) VALUES (p_id, CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END, p_note) $$;
CREATE OR REPLACE FUNCTION pg_temp.gap(p_id text, p_note text)
RETURNS void LANGUAGE sql AS $$ INSERT INTO _r(id, ok, note) VALUES (p_id, 'GAP', p_note) $$;

-- helper: does calling this SQL raise?
CREATE OR REPLACE FUNCTION pg_temp.raises(p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL;
EXCEPTION WHEN others THEN RETURN SQLERRM; END $$;

CREATE TEMP TABLE _dump(seq serial, ctx text, line text);
CREATE OR REPLACE FUNCTION pg_temp.dump_rows(p_ctx text, p_where text) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN EXECUTE format($f$
    SELECT q.id, q.stock_id, q.trade_date, q.status, q.last_error, q.attempts,
           q.max_attempts, q.enqueued_by, q.enqueued_at, q.next_run_at, q.started_at,
           q.finished_at, q.correlation_id, q.updated_at
      FROM public.tw_bsr_sync_queue q WHERE %s ORDER BY q.id $f$, p_where)
  LOOP
    n := n + 1;
    INSERT INTO _dump(ctx, line) VALUES (p_ctx, format(
      'id=%s stock_id=%s trade_date=%s status=%s error_code=%s quota_deferred=%s attempts=%s/%s enqueued_by=%s created_at=%s available_at=%s started_at=%s finished_at=%s corr=%s updated_at=%s',
      r.id, r.stock_id, r.trade_date, r.status, coalesce(r.last_error,'-'),
      (r.last_error = 'quota_deferred'), r.attempts, r.max_attempts,
      coalesce(r.enqueued_by,'-'), r.enqueued_at, r.next_run_at,
      coalesce(r.started_at::text,'-'), coalesce(r.finished_at::text,'-'),
      coalesce(r.correlation_id::text,'-'), r.updated_at));
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.qcount() RETURNS bigint
LANGUAGE sql AS $$ SELECT count(*) FROM public.tw_bsr_sync_queue $$;

-- ============================================================ fixtures
INSERT INTO public.tw_bsr_sync_config(key, config, version)
VALUES ('market_batch', '{"supported": false, "note": "storage_objects plan-gated"}'::jsonb, 7)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.chips_prefetch_targets(code, source, active, supported)
VALUES ('2330','ops',true,true) ON CONFLICT DO NOTHING;
-- B6 failure ledger F-04: a dedicated, never-otherwise-touched eligible symbol
-- so enqueue_chips_prefetch_gaps() has a REAL chip gap to close. 2330 alone is
-- fully pre-enqueued by ensure_bsr_queued/ensure_bsr_window earlier in the
-- writer list, which is why the gate-open delta was 0 in B6.
INSERT INTO public.chips_prefetch_targets(code, source, active, supported)
VALUES ('2412','ops',true,true) ON CONFLICT DO NOTHING;
INSERT INTO public.checkup_storage(key, data, user_id)
VALUES ('portfolio', '{"holdings":[{"symbol":"2317","code":"2317"}]}'::jsonb,
        '00000000-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO public.system_kill_switches(key, enabled) VALUES ('chips_all', true), ('chips_backfill', true)
ON CONFLICT (key) DO UPDATE SET enabled = true;
INSERT INTO public.finmind_quota_pools(pool_name, daily_budget, used_today, capacity, tokens, refill_per_min, priority)
VALUES ('interactive', 400, 0, 200, 200, 5, 1),
       ('keepwarm', 400, 0, 200, 200, 5, 2),
       ('backfill', 400, 0, 200, 200, 5, 3)
ON CONFLICT (pool_name) DO UPDATE SET daily_budget=400, used_today=0, capacity=200, tokens=200;

INSERT INTO public.stock_names(symbol, name, asset_class) VALUES
  ('2330','TSMC','tw_stock'), ('2317','HH','tw_stock'), ('6505','FPCC','tw_stock')
ON CONFLICT DO NOTHING;

-- ============================================================ A. catalog read-back
DO $$
DECLARE r record; n int;
BEGIN
  FOR r IN SELECT unnest(ARRAY['bsr_admission_status',
                               'bsr_block_and_terminalize_claims',
                               'bsr_unblock_after_probe']) AS f
  LOOP
    SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
     WHERE ns.nspname='public' AND p.proname=r.f
       AND p.prosecdef AND p.provolatile='v'
       AND array_to_string(p.proconfig,',') = 'search_path=pg_catalog, private_bsr';
    PERFORM pg_temp.chk('A-'||r.f, n=1,
      'secdef+volatile+search_path=pg_catalog,private_bsr');
  END LOOP;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY['public.bsr_admission_status()',
    'public.bsr_block_and_terminalize_claims(uuid,bigint[],timestamptz[],int[],text,jsonb)',
    'public.bsr_unblock_after_probe(int,text,jsonb,uuid)']) AS sig
  LOOP
    PERFORM pg_temp.chk('B-acl-'||split_part(r.sig,'(',1),
      has_function_privilege('service_role', r.sig, 'EXECUTE')
      AND NOT has_function_privilege('anon', r.sig, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', r.sig, 'EXECUTE'),
      'service_role=yes anon/authenticated=no');
  END LOOP;
  PERFORM pg_temp.chk('B-private-schema',
    NOT has_schema_privilege('anon','private_bsr','USAGE')
    AND NOT has_schema_privilege('authenticated','private_bsr','USAGE')
    AND NOT has_schema_privilege('service_role','private_bsr','USAGE'),
    'private_bsr USAGE denied to all PostgREST roles');
  PERFORM pg_temp.chk('B-private-fn',
    NOT has_function_privilege('service_role','private_bsr.gate_blocked()','EXECUTE'),
    'private implementation not directly callable by service_role');
END $$;

-- ============================================================ C. gate OPEN: every writer
CREATE TEMP TABLE _wdelta(phase text, writer text, delta bigint, err text);

CREATE OR REPLACE FUNCTION pg_temp.run_writers(p_phase text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c0 bigint; e text;
DECLARE
  writers text[] := ARRAY[
    $w$INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, enqueued_by, correlation_id)
       VALUES ('9001', current_date - (random()*300)::int, 1, 'pending', 'raw_insert_probe', gen_random_uuid())$w$,
    $w$SELECT public.ensure_bsr_queued('2330')$w$,
    $w$SELECT public.ensure_bsr_window('2317', 5, 14)$w$,
    $w$SELECT public.enqueue_all_active_tw_holdings_bsr(3)$w$,
    $w$SELECT public.enqueue_chips_prefetch_gaps(5, 20)$w$,
    $w$SELECT public.converge_bsr_windows(20, 5, 30)$w$,
    $w$SELECT public.enqueue_bsr_backfill('6505', 5)$w$
  ];
  names text[] := ARRAY['raw_insert','ensure_bsr_queued','ensure_bsr_window',
                        'enqueue_all_active_tw_holdings_bsr','enqueue_chips_prefetch_gaps',
                        'converge_bsr_windows','enqueue_bsr_backfill'];
  i int;
BEGIN
  FOR i IN 1..array_length(writers,1) LOOP
    c0 := (SELECT count(*) FROM public.tw_bsr_sync_queue);
    e := NULL;
    BEGIN
      EXECUTE writers[i];
    EXCEPTION WHEN others THEN e := SQLERRM;
    END;
    INSERT INTO _wdelta VALUES (p_phase, names[i],
      (SELECT count(*) FROM public.tw_bsr_sync_queue) - c0, e);
  END LOOP;
END $$;

-- enqueue_bsr_backfill needs an authenticated company_admin
INSERT INTO auth.users(id, email, created_at, is_sso_user, is_anonymous)
VALUES ('00000000-0000-0000-0000-0000000000ad','admin@clone.local', now(), false, false)
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles(user_id, role)
VALUES ('00000000-0000-0000-0000-0000000000ad','company_admin') ON CONFLICT DO NOTHING;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000ad"}', false);

SELECT pg_temp.run_writers('open');

DO $$
DECLARE r record; nz int := 0;
BEGIN
  FOR r IN SELECT * FROM _wdelta WHERE phase='open' LOOP
    IF r.err IS NOT NULL THEN
      PERFORM pg_temp.gap('C-open-'||r.writer, 'writer raised in clone: '||r.err);
    ELSIF r.delta > 0 THEN
      nz := nz + 1;
      PERFORM pg_temp.chk('C-open-'||r.writer, true, 'gate open -> +'||r.delta||' rows');
    ELSE
      PERFORM pg_temp.gap('C-open-'||r.writer, 'gate open but 0 rows (fixture-limited, no admission effect)');
    END IF;
  END LOOP;
  PERFORM pg_temp.chk('C-open-any', nz >= 4, nz||' writers inserted with gate open');
END $$;

-- business semantics unchanged while gate open: duplicate still raises
DO $$
DECLARE e text;
BEGIN
  INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, enqueued_by)
  VALUES ('9002', current_date, 1, 'pending', 'dupe_probe');
  e := pg_temp.raises($q$INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, enqueued_by)
                          VALUES ('9002', current_date, 1, 'pending', 'dupe_probe')$q$);
  PERFORM pg_temp.chk('C-open-unique-violation-preserved', e LIKE '%tw_bsr_sync_queue_active_uniq%',
                      coalesce(e,'no error raised'));
  e := pg_temp.raises($q$INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, enqueued_by)
                          VALUES ('9003', current_date, 9, 'pending', 'prio_probe')$q$);
  PERFORM pg_temp.chk('C-open-check-constraint-preserved', e LIKE '%priority_check%', coalesce(e,'no error raised'));
END $$;

-- ============================================================ D. wrapper input validation
DO $$
DECLARE e text; g uuid := gen_random_uuid();
BEGIN
  e := pg_temp.raises(format($q$SELECT public.bsr_block_and_terminalize_claims(%L::uuid,
        ARRAY[]::bigint[], ARRAY[]::timestamptz[], ARRAY[]::int[], 'some_other_code', '{}'::jsonb)$q$, g));
  PERFORM pg_temp.chk('D-code-allowlist', e LIKE '%terminal_code_not_allowed%', coalesce(e,'none'));

  e := pg_temp.raises(format($q$SELECT public.bsr_block_and_terminalize_claims(%L::uuid,
        ARRAY[1]::bigint[], ARRAY[]::timestamptz[], ARRAY[]::int[],
        'finmind_admission_provider_plan_rejected', '{"a":1}'::jsonb)$q$, g));
  PERFORM pg_temp.chk('D-array-length-mismatch', e LIKE '%length_mismatch%', coalesce(e,'none'));

  e := pg_temp.raises(format($q$SELECT public.bsr_block_and_terminalize_claims(%L::uuid,
        (SELECT array_agg(i::bigint) FROM generate_series(1,501) i),
        (SELECT array_agg(now()) FROM generate_series(1,501) i),
        (SELECT array_agg(1) FROM generate_series(1,501) i),
        'finmind_admission_provider_plan_rejected', '{"a":1}'::jsonb)$q$, g));
  PERFORM pg_temp.chk('D-batch-cap-500', e LIKE '%batch_too_large%', coalesce(e,'none'));

  e := pg_temp.raises(format($q$SELECT public.bsr_block_and_terminalize_claims(%L::uuid,
        ARRAY[]::bigint[], ARRAY[]::timestamptz[], ARRAY[]::int[],
        'finmind_admission_provider_plan_rejected',
        '{"http_status":400,"nested":{"authorization":"Bearer x"}}'::jsonb)$q$, g));
  PERFORM pg_temp.chk('D-evidence-sanitizer', e LIKE '%evidence_key_forbidden%', coalesce(e,'none'));

  e := pg_temp.raises(format($q$SELECT public.bsr_block_and_terminalize_claims(%L::uuid,
        ARRAY[]::bigint[], ARRAY[]::timestamptz[], ARRAY[]::int[],
        'finmind_admission_provider_plan_rejected', '"nope"'::jsonb)$q$, g));
  PERFORM pg_temp.chk('D-evidence-object-required', e LIKE '%evidence_must_be_object%', coalesce(e,'none'));
END $$;

-- ============================================================ E. claim -> pairwise terminalize + block
CREATE TEMP TABLE _claim AS SELECT * FROM public.tw_bsr_sync_queue WHERE false;

DO $$
DECLARE
  ids bigint[]; sts timestamptz[]; att int[]; res jsonb; n int;
  a0 int; d0 int;
BEGIN
  -- ensure claimable rows exist and are due
  UPDATE public.tw_bsr_sync_queue SET status='pending', next_run_at=now()-interval '1 h',
         post_close_only=false WHERE status='pending';
  INSERT INTO _claim SELECT * FROM public.claim_bsr_queue_jobs(5, 3);
  SELECT count(*) INTO n FROM _claim;
  PERFORM pg_temp.chk('E-claim', n > 0, n||' jobs claimed (status=running)');

  SELECT array_agg(id ORDER BY id), array_agg(started_at ORDER BY id), array_agg(attempts ORDER BY id)
    INTO ids, sts, att FROM _claim;

  a0 := (SELECT count(*) FROM public.audit_logs);
  d0 := (SELECT count(*) FROM public.tw_bsr_degrade_events);

  res := public.bsr_block_and_terminalize_claims(gen_random_uuid(), ids, sts, att,
           'finmind_admission_provider_plan_rejected',
           jsonb_build_object('http_status',400,'signature','plan_gated','provider','finmind'));

  PERFORM pg_temp.chk('E-block-transition', res->>'transition' = 'blocked', res::text);
  PERFORM pg_temp.chk('E-pairwise-updated', (res->>'updated_count')::int = n,
                      'updated='||(res->>'updated_count')||' of '||n);
  PERFORM pg_temp.chk('E-terminal-status',
    (SELECT count(*) FROM public.tw_bsr_sync_queue q JOIN _claim c ON c.id=q.id
      WHERE q.status='failed' AND q.last_error='finmind_admission_provider_plan_rejected') = n, '');
  PERFORM pg_temp.chk('E-audit-1-row', (SELECT count(*) FROM public.audit_logs) = a0+1, '');
  PERFORM pg_temp.chk('E-degrade-1-row', (SELECT count(*) FROM public.tw_bsr_degrade_events) = d0+1, '');
  PERFORM pg_temp.chk('E-gate-status-blocked', (public.bsr_admission_status()->>'blocked')::boolean, '');

  -- idempotent second call: already_blocked, no new audit/degrade rows
  res := public.bsr_block_and_terminalize_claims(gen_random_uuid(), ids, sts, att,
           'finmind_admission_provider_plan_rejected', jsonb_build_object('http_status',400));
  PERFORM pg_temp.chk('E-idempotent-block', res->>'transition' = 'already_blocked', res::text);
  PERFORM pg_temp.chk('E-idempotent-no-extra-audit',
    (SELECT count(*) FROM public.audit_logs) = a0+1
    AND (SELECT count(*) FROM public.tw_bsr_degrade_events) = d0+1, '');
  PERFORM pg_temp.chk('E-lost-lease-on-replay', (res->>'updated_count')::int = 0,
    'rows already failed -> lease no longer held: updated='||(res->>'updated_count'));
END $$;

-- lost lease: mutated started_at must not be updated
DO $$
DECLARE id0 bigint; res jsonb;
BEGIN
  SET LOCAL session_replication_role = replica;   -- fixture insert bypasses the closed gate
  INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, attempts, started_at, enqueued_by)
  VALUES ('9101', current_date - 3, 1, 'running', 2, now() - interval '5 min', 'lease_probe')
  RETURNING id INTO id0;
  res := public.bsr_block_and_terminalize_claims(gen_random_uuid(), ARRAY[id0],
           ARRAY[now()]::timestamptz[], ARRAY[2], 'finmind_admission_provider_plan_rejected',
           jsonb_build_object('http_status',400));
  PERFORM pg_temp.chk('E-lost-lease-started-at-mismatch',
    (res->>'updated_count')::int = 0 AND (res->>'lost_lease_count')::int = 1
    AND (SELECT status FROM public.tw_bsr_sync_queue WHERE id=id0) = 'running', res::text);

  res := public.bsr_block_and_terminalize_claims(gen_random_uuid(), ARRAY[id0],
           ARRAY[(SELECT started_at FROM public.tw_bsr_sync_queue WHERE id=id0)],
           ARRAY[99], 'finmind_admission_provider_plan_rejected', jsonb_build_object('http_status',400));
  PERFORM pg_temp.chk('E-lost-lease-attempts-mismatch', (res->>'updated_count')::int = 0, res::text);
END $$;

-- reaper race: reaped row (running -> pending) must not be terminalized by the stale claim
DO $$
DECLARE id0 bigint; st timestamptz; res jsonb; before_status text;
BEGIN
  SET LOCAL session_replication_role = replica;   -- fixture insert bypasses the closed gate
  -- B6 failure ledger F-01: reap_stale_bsr_queue_jobs() keys off updated_at
  --   WHERE status='running' AND updated_at < now() - make_interval(mins => _stale_minutes)
  -- (default 60). The B6 fixture only aged started_at, so the row was never
  -- reaped and the assertion was vacuous. Age updated_at as well; the trigger
  -- set_updated_at (if any) is bypassed by an explicit post-insert UPDATE.
  INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, attempts, started_at, enqueued_by)
  VALUES ('9102', current_date - 4, 1, 'running', 1, now() - interval '90 min', 'reaper_probe')
  RETURNING id, started_at INTO id0, st;
  UPDATE public.tw_bsr_sync_queue SET updated_at = now() - interval '90 min' WHERE id = id0;
  PERFORM pg_temp.chk('E-reaper-fixture-aged',
    (SELECT updated_at < now() - interval '80 min' FROM public.tw_bsr_sync_queue WHERE id=id0),
    'updated_at aged past the 60min reaper threshold');
  PERFORM public.reap_stale_bsr_queue_jobs();
  before_status := (SELECT status FROM public.tw_bsr_sync_queue WHERE id=id0);
  res := public.bsr_block_and_terminalize_claims(gen_random_uuid(), ARRAY[id0], ARRAY[st], ARRAY[1],
           'finmind_admission_provider_plan_rejected', jsonb_build_object('http_status',400));
  PERFORM pg_temp.chk('E-reaper-race', before_status = 'pending' AND (res->>'updated_count')::int = 0,
    'reaped status='||before_status||' updated='||(res->>'updated_count'));
EXCEPTION WHEN undefined_function THEN
  PERFORM pg_temp.gap('E-reaper-race','reap_stale_bsr_queue_jobs absent in clone');
END $$;

-- ============================================================ F. gate CLOSED: every writer, zero admissions
SELECT pg_temp.run_writers('closed');

DO $$
DECLARE r record; bad int := 0;
BEGIN
  FOR r IN SELECT * FROM _wdelta WHERE phase='closed' LOOP
    IF r.delta <> 0 THEN bad := bad + 1; END IF;
    PERFORM pg_temp.chk('F-closed-'||r.writer, r.delta = 0,
      'delta='||r.delta||coalesce(' err='||r.err,''));
  END LOOP;
  PERFORM pg_temp.chk('F-closed-total', bad = 0, bad||' writers leaked rows while blocked');
END $$;

-- closed gate must not convert business errors into silent skips for OTHER tables
DO $$
DECLARE e text;
BEGIN
  e := pg_temp.raises($q$INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status)
                          VALUES ('9004', current_date, 9, 'pending')$q$);
  PERFORM pg_temp.chk('F-closed-no-raise', e IS NULL,
    'gate returns NULL before CHECK: '||coalesce(e,'silently skipped'));
END $$;

-- ============================================================ G. blocked: 3 rounds x 3 gate shapes, zero noise
-- B6 failure ledger F-02: G showed pending=3 after the blocked rounds. Root
-- cause (proven below by per-row dump + writer trace): enqueue_chips_prefetch_gaps()
-- calls recover_stale_bsr_queue_jobs(), a SECOND recovery predicate that was not
-- gate-aware and requeued failed -> pending for every terminal row whose symbol
-- is in checkup_prefetch_universe(). Fixed in 002_recover_gate_aware.sql, not by
-- deleting rows.
CREATE TEMP TABLE _terminal_ids(id bigint primary key);
CREATE TEMP TABLE _tsnap AS SELECT id, status, attempts, max_attempts, last_error
  FROM public.tw_bsr_sync_queue WHERE false;

DO $$
DECLARE n int;
BEGIN
  -- terminal cohort: what the worker will produce on a provider plan rejection
  UPDATE public.tw_bsr_sync_queue SET status='failed',
         last_error='finmind_admission_provider_plan_rejected'
   WHERE status IN ('pending','running');
  INSERT INTO _terminal_ids SELECT id FROM public.tw_bsr_sync_queue
   WHERE last_error='finmind_admission_provider_plan_rejected';

  -- explicit drain of every non-terminal leftover so "pending -> 0" is a real
  -- convergence statement and not an artefact of unrelated fixture rows.
  UPDATE public.tw_bsr_sync_queue SET status='done', last_error='clone_drained'
   WHERE id NOT IN (SELECT id FROM _terminal_ids) AND status <> 'done';

  INSERT INTO public.tw_chip_fact(stock_id, trade_date, broker_id, source, buy_shares, sell_shares)
  SELECT DISTINCT q.stock_id, q.trade_date, '9200', 'clone_fixture', 1000, 500
    FROM public.tw_bsr_sync_queue q LIMIT 3
  ON CONFLICT DO NOTHING;

  INSERT INTO _tsnap SELECT id, status, attempts, max_attempts, last_error
    FROM public.tw_bsr_sync_queue WHERE id IN (SELECT id FROM _terminal_ids);
  SELECT count(*) INTO n FROM _terminal_ids;
  PERFORM pg_temp.chk('G-cohort', n > 0, n||' terminal rows; pending after drain='||
    (SELECT count(*) FROM public.tw_bsr_sync_queue WHERE status='pending'));
END $$;

CREATE OR REPLACE FUNCTION pg_temp.gate_rounds(p_shape text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  i int; res jsonb; a0 int; d0 int; drift int; pend_term bigint; pend_all bigint;
  prev bigint; v_cfg jsonb;
BEGIN
  v_cfg := CASE p_shape
             WHEN 'true'      THEN '{"admission_blocked": true}'::jsonb
             WHEN 'missing'   THEN '{}'::jsonb
             WHEN 'malformed' THEN '{"admission_blocked": "yes"}'::jsonb
           END;
  UPDATE public.tw_bsr_sync_config
     SET config = (config - 'admission_blocked') || v_cfg WHERE key='market_batch';

  -- reset the cohort to its terminal snapshot before each shape
  UPDATE public.tw_bsr_sync_queue q
     SET status=t.status, attempts=t.attempts, max_attempts=t.max_attempts, last_error=t.last_error
    FROM _tsnap t WHERE q.id=t.id;

  a0 := (SELECT count(*) FROM public.audit_logs);
  d0 := (SELECT count(*) FROM public.tw_bsr_degrade_events);
  prev := NULL;

  FOR i IN 1..3 LOOP
    res := public.recover_quota_failed_bsr_jobs(1);
    PERFORM public.recover_stale_bsr_queue_jobs();
    PERFORM public.enqueue_chips_prefetch_gaps(5, 20);

    -- (1) terminal cohort must never be resurrected, whatever the gate shape
    SELECT count(*) INTO drift FROM public.tw_bsr_sync_queue q JOIN _tsnap t ON t.id=q.id
      WHERE (q.status, q.attempts, q.max_attempts, q.last_error)
         IS DISTINCT FROM (t.status, t.attempts, t.max_attempts, t.last_error);
    IF drift > 0 THEN
      PERFORM pg_temp.dump_rows('G-'||p_shape||'-round'||i||'-drift',
        'q.id IN (SELECT id FROM _tsnap t WHERE (t.status,t.attempts,t.max_attempts,t.last_error) IS DISTINCT FROM (q.status,q.attempts,q.max_attempts,q.last_error))');
    END IF;
    PERFORM pg_temp.chk('G-'||p_shape||'-round'||i||'-cohort-frozen', drift = 0,
      drift||' terminal rows mutated (status/attempts/error)');

    pend_term := (SELECT count(*) FROM public.tw_bsr_sync_queue q
                   WHERE q.status='pending' AND q.id IN (SELECT id FROM _terminal_ids));
    IF pend_term > 0 THEN
      PERFORM pg_temp.dump_rows('G-'||p_shape||'-round'||i||'-pending-terminal',
        'q.status=''pending'' AND q.id IN (SELECT id FROM _terminal_ids)');
    END IF;
    PERFORM pg_temp.chk('G-'||p_shape||'-round'||i||'-pending-zero', pend_term = 0,
      'terminal rows pending='||pend_term);

    pend_all := (SELECT count(*) FROM public.tw_bsr_sync_queue WHERE status='pending');
    IF p_shape = 'true' THEN
      -- gate closed: no writer may admit anything, so TOTAL pending stays 0
      IF pend_all > 0 THEN
        PERFORM pg_temp.dump_rows('G-true-round'||i||'-pending-any', 'q.status=''pending''');
      END IF;
      PERFORM pg_temp.chk('G-true-round'||i||'-total-pending-zero', pend_all = 0,
        'total pending='||pend_all);
    ELSE
      -- gate missing/malformed is OPEN by the v4 §3 compatibility rule: fresh
      -- gap enqueues are legitimate. Monotonic non-growth of the terminal
      -- cohort is the invariant; new admissions are reported, not asserted 0.
      PERFORM pg_temp.chk('G-'||p_shape||'-round'||i||'-fresh-admissions-only',
        (SELECT count(*) FROM public.tw_bsr_sync_queue
          WHERE status='pending' AND id IN (SELECT id FROM _terminal_ids)) = 0,
        'fresh pending (non-cohort)='||pend_all);
    END IF;

    PERFORM pg_temp.chk('G-'||p_shape||'-round'||i||'-recovery-silent',
      COALESCE((res->>'tokens_issued')::int,0) = 0
      AND jsonb_array_length(COALESCE(res->'tokened_job_ids','[]'::jsonb)) = 0,
      res::text);
  END LOOP;

  PERFORM pg_temp.chk('G-'||p_shape||'-audit-zero-noise',
    (SELECT count(*) FROM public.audit_logs) = a0
    AND (SELECT count(*) FROM public.tw_bsr_degrade_events) = d0,
    'audit delta='||((SELECT count(*) FROM public.audit_logs)-a0)||
    ' degrade delta='||((SELECT count(*) FROM public.tw_bsr_degrade_events)-d0));
END $$;

SELECT pg_temp.gate_rounds('true');
SELECT pg_temp.gate_rounds('missing');
SELECT pg_temp.gate_rounds('malformed');

-- restore the closed gate for the remaining sections
UPDATE public.tw_bsr_sync_config
   SET config = config || '{"admission_blocked": true}'::jsonb WHERE key='market_batch';
UPDATE public.tw_bsr_sync_queue q
   SET status=t.status, attempts=t.attempts, max_attempts=t.max_attempts, last_error=t.last_error
  FROM _tsnap t WHERE q.id=t.id;

-- non-terminal quota rows keep their existing recovery semantics while blocked
DO $$
DECLARE id0 bigint; res jsonb; st text;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, max_attempts, last_error, enqueued_by)
  VALUES ('9201', public.expected_latest_bsr_date(), 2, 'failed', 1,
          'finmind_admission_quota_exhausted', 'legacy_quota');
  UPDATE public.tw_bsr_sync_queue SET status='failed' WHERE stock_id='9201';
  SELECT id INTO id0 FROM public.tw_bsr_sync_queue WHERE stock_id='9201';
  res := public.recover_quota_failed_bsr_jobs(1);
  st := (SELECT status FROM public.tw_bsr_sync_queue WHERE id=id0);
  PERFORM pg_temp.chk('G-nonterminal-semantics-unchanged',
    st = 'pending',
    'status='||st||' recover='||res::text);
END $$;

-- ============================================================ H. unblock probe
DO $$
DECLARE ver int; nonce text; res jsonb; e text; a0 int;
BEGIN
  ver := (public.bsr_admission_status()->>'version')::int;
  nonce := public.bsr_admission_status()->>'nonce';
  a0 := (SELECT count(*) FROM public.audit_logs);

  res := public.bsr_unblock_after_probe(ver - 1, nonce,
          jsonb_build_object('admission_probe_schema_version','1','probe_at',now()::text,
                             'http_status','200','sample_stock_id','2330','sample_row_count','12'),
          '00000000-0000-0000-0000-0000000000ad');
  PERFORM pg_temp.chk('H-stale-version', res->>'transition' = 'stale_probe'
    AND (SELECT count(*) FROM public.audit_logs) = a0, res::text);

  res := public.bsr_unblock_after_probe(ver, 'wrong-nonce',
          jsonb_build_object('admission_probe_schema_version','1','probe_at',now()::text,
                             'http_status','200','sample_stock_id','2330','sample_row_count','12'),
          '00000000-0000-0000-0000-0000000000ad');
  PERFORM pg_temp.chk('H-stale-nonce', res->>'transition' = 'stale_probe', res::text);

  e := pg_temp.raises(format($q$SELECT public.bsr_unblock_after_probe(%s, %L,
        '{"admission_probe_schema_version":"1","probe_at":"x","http_status":"400",
          "sample_stock_id":"2330","sample_row_count":"0"}'::jsonb, NULL)$q$, ver, nonce));
  PERFORM pg_temp.chk('H-failed-probe-rejected', e LIKE '%probe_not_successful%', coalesce(e,'none'));

  e := pg_temp.raises(format($q$SELECT public.bsr_unblock_after_probe(%s, %L,
        '{"probe_at":"x","http_status":"200","sample_stock_id":"2330","sample_row_count":"9"}'::jsonb, NULL)$q$,
        ver, nonce));
  PERFORM pg_temp.chk('H-schema-version-required', e LIKE '%probe_schema_version_unsupported%', coalesce(e,'none'));

  PERFORM pg_temp.chk('H-still-blocked-after-rejects',
    (public.bsr_admission_status()->>'blocked')::boolean, '');

  res := public.bsr_unblock_after_probe(ver, nonce,
          jsonb_build_object('admission_probe_schema_version','1','probe_at',now()::text,
                             'http_status','200','sample_stock_id','2330','sample_row_count','12'),
          '00000000-0000-0000-0000-0000000000ad');
  PERFORM pg_temp.chk('H-unblocked', res->>'transition' = 'unblocked', res::text);
  PERFORM pg_temp.chk('H-explicit-false',
    (SELECT config -> 'admission_blocked' = 'false'::jsonb FROM public.tw_bsr_sync_config WHERE key='market_batch')
    AND (SELECT config ? 'last_blocked_at' FROM public.tw_bsr_sync_config WHERE key='market_batch'),
    'admission_blocked explicitly false, blocked_at archived');
  PERFORM pg_temp.chk('H-audit-2', (SELECT count(*) FROM public.audit_logs) = a0+1, '');

  res := public.bsr_unblock_after_probe(ver+1, public.bsr_admission_status()->>'nonce',
          jsonb_build_object('admission_probe_schema_version','1','probe_at',now()::text,
                             'http_status','200','sample_stock_id','2330','sample_row_count','12'), NULL);
  PERFORM pg_temp.chk('H-already-open', res->>'transition' = 'already_open', res::text);
END $$;

-- ============================================================ I. after unblock: admission + per-run recovery delta
-- B6 failure ledger F-03: the old assertion counted the cumulative number of
-- rows carrying last_error='quota_recovery_token', which is a running total,
-- not a per-run delta. Use res->'tokened_job_ids' (exact, per invocation).
DO $$
DECLARE c0 bigint; res jsonb; per_run int; total int := 0; i int; ids bigint[]; sts timestamptz[]; att int[];
BEGIN
  c0 := pg_temp.qcount();
  INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, enqueued_by)
  VALUES ('9301', current_date - 7, 1, 'pending', 'post_unblock_probe');
  PERFORM pg_temp.chk('I-admission-resumed', pg_temp.qcount() = c0 + 1, 'insert accepted after unblock');

  FOR i IN 1..3 LOOP
    res := public.recover_quota_failed_bsr_jobs(1);
    per_run := jsonb_array_length(COALESCE(res->'tokened_job_ids','[]'::jsonb));
    total := total + per_run;
    PERFORM pg_temp.chk('I-run'||i||'-delta-at-most-1', per_run <= 1,
      'tokened_this_run='||per_run||' ids='||COALESCE(res->'tokened_job_ids','[]'::jsonb)::text);
  END LOOP;
  PERFORM pg_temp.chk('I-recovery-resumed', total >= 1,
    'per-run deltas summed='||total||' (gate explicitly open -> terminal rows recoverable again)');
END $$;

-- provider goes terminal again mid-recovery: re-block immediately and stop.
DO $$
DECLARE ids bigint[]; sts timestamptz[]; att int[]; res jsonb; n int; per_run int;
BEGIN
  UPDATE public.tw_bsr_sync_queue SET status='pending', next_run_at=now()-interval '1 h',
         post_close_only=false WHERE status='pending';
  CREATE TEMP TABLE _claim2 AS SELECT * FROM public.claim_bsr_queue_jobs(3, 3);
  SELECT count(*), array_agg(id ORDER BY id), array_agg(started_at ORDER BY id), array_agg(attempts ORDER BY id)
    INTO n, ids, sts, att FROM _claim2;
  PERFORM pg_temp.chk('I-reblock-claim', n > 0, n||' jobs claimed after resume');

  res := public.bsr_block_and_terminalize_claims(gen_random_uuid(), ids, sts, att,
           'finmind_admission_provider_plan_rejected', jsonb_build_object('http_status',400));
  PERFORM pg_temp.chk('I-reblock-immediate',
    res->>'transition' = 'blocked' AND (public.bsr_admission_status()->>'blocked')::boolean, res::text);

  res := public.recover_quota_failed_bsr_jobs(1);
  per_run := jsonb_array_length(COALESCE(res->'tokened_job_ids','[]'::jsonb));
  PERFORM pg_temp.chk('I-reblock-recovery-stops', per_run = 0,
    'tokened_this_run='||per_run||' after re-block');
END $$;

-- ============================================================ per-row diagnostics
SELECT 'DUMP ' || ctx || '  ' || line FROM _dump ORDER BY seq;

-- ============================================================ report
SELECT ok || ' ' || id || CASE WHEN note <> '' THEN '  -- ' || note ELSE '' END
  FROM _r ORDER BY seq;
SELECT 'SUMMARY pass=' || count(*) FILTER (WHERE ok='PASS')
     || ' fail=' || count(*) FILTER (WHERE ok='FAIL')
     || ' gap=' || count(*) FILTER (WHERE ok='GAP') FROM _r;
