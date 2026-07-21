-- =====================================================================
-- trade_records dedupe regression test
-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/trade_records_dedupe_test.sql
-- All changes are rolled back at the end.
-- =====================================================================

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------
-- Fixture: fake expert + fake admin identity
-- ---------------------------------------------------------------------
DO $fixture$
DECLARE
  v_expert_id uuid := gen_random_uuid();
  v_user_id   uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.experts (id, user_id, slug, name, role, status, currency, asset_class)
  VALUES (v_expert_id, v_user_id,
          'dedupe-test-' || substr(v_expert_id::text, 1, 8),
          'Dedupe Test Expert', 'mentor', 'active', 'TWD', 'tw_stock');

  -- expose ids to later blocks
  PERFORM set_config('test.expert_id', v_expert_id::text, false);
  PERFORM set_config('test.user_id',   v_user_id::text,   false);
END
$fixture$;

-- =====================================================================
-- Case A: trigger inserts exactly one open trade_record
-- =====================================================================
SAVEPOINT case_a;
DO $case_a$
DECLARE
  v_signal_id uuid;
  v_count int;
BEGIN
  INSERT INTO public.expert_signals
    (expert_id, instrument, action, price_hint, quantity, quantity_unit, status, published_at)
  VALUES
    (current_setting('test.expert_id')::uuid, '2330 TSMC', 'buy',
     600, 1, '張', 'published', now())
  RETURNING id INTO v_signal_id;

  SELECT count(*) INTO v_count
    FROM public.trade_records
   WHERE signal_id = v_signal_id AND exit_date IS NULL;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'CASE A FAILED: expected 1 open trade_record, got %', v_count;
  END IF;

  PERFORM set_config('test.signal_a', v_signal_id::text, false);
END
$case_a$;

-- =====================================================================
-- Case B: re-firing the trigger via UPDATE must NOT create a second row
-- =====================================================================
DO $case_b$
DECLARE
  v_signal uuid := current_setting('test.signal_a')::uuid;
  v_count int;
BEGIN
  -- Flip status pending -> published to force the trigger's UPDATE path
  UPDATE public.expert_signals SET status = 'pending'   WHERE id = v_signal;
  UPDATE public.expert_signals SET status = 'published' WHERE id = v_signal;
  UPDATE public.expert_signals SET status = 'pending'   WHERE id = v_signal;
  UPDATE public.expert_signals SET status = 'published' WHERE id = v_signal;

  SELECT count(*) INTO v_count
    FROM public.trade_records
   WHERE signal_id = v_signal;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'CASE B FAILED: signal re-published produced % trade_records', v_count;
  END IF;
END
$case_b$;

-- =====================================================================
-- Case C: manual duplicate INSERT must be blocked by the unique index
-- =====================================================================
DO $case_c$
DECLARE
  v_signal uuid := current_setting('test.signal_a')::uuid;
  v_expert uuid := current_setting('test.expert_id')::uuid;
  v_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.trade_records
      (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit, market, currency)
    VALUES
      (v_expert, v_signal, '2330 TSMC', 600, now(), 'open', 1, '張', 'TW', 'TWD');
  EXCEPTION
    WHEN unique_violation THEN
      v_blocked := true;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'CASE C FAILED: unique index did not block duplicate open row';
  END IF;
END
$case_c$;

-- =====================================================================
-- Case D: closing the first record allows a new open one under same signal_id
-- =====================================================================
DO $case_d$
DECLARE
  v_signal uuid := current_setting('test.signal_a')::uuid;
  v_expert uuid := current_setting('test.expert_id')::uuid;
  v_open   int;
  v_total  int;
BEGIN
  UPDATE public.trade_records
     SET exit_date = now() - interval '1 day', exit_price = 610, status = 'closed'
   WHERE signal_id = v_signal AND exit_date IS NULL;

  INSERT INTO public.trade_records
    (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit, market, currency)
  VALUES
    (v_expert, v_signal, '2330 TSMC', 615, now(), 'open', 1, '張', 'TW', 'TWD');

  SELECT count(*) FILTER (WHERE exit_date IS NULL),
         count(*)
    INTO v_open, v_total
    FROM public.trade_records
   WHERE signal_id = v_signal;

  IF v_open <> 1 OR v_total <> 2 THEN
    RAISE EXCEPTION 'CASE D FAILED: expected open=1 total=2, got open=% total=%', v_open, v_total;
  END IF;
END
$case_d$;
ROLLBACK TO SAVEPOINT case_a;  -- reset for Case E

-- =====================================================================
-- Case E: admin_signal_dupe_trades_fix collapses duplicates and is idempotent
-- =====================================================================
SAVEPOINT case_e;
DO $case_e$
DECLARE
  v_signal uuid;
  v_expert uuid := current_setting('test.expert_id')::uuid;
  v_admin  uuid := current_setting('test.user_id')::uuid;
  v_dup_signal uuid;
  v_result jsonb;
  v_after int;
  v_audit int;
BEGIN
  -- 1) Make our fixture user a company_admin and impersonate them
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_admin, 'company_admin') ON CONFLICT DO NOTHING;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin::text, 'role', 'authenticated')::text,
    true
  );

  -- 2) Create a signal + one open trade_record via trigger
  INSERT INTO public.expert_signals
    (expert_id, instrument, action, price_hint, quantity, quantity_unit, status, published_at)
  VALUES
    (v_expert, '2454 MTK', 'buy', 1200, 1, '張', 'published', now())
  RETURNING id INTO v_signal;

  -- 3) Manufacture a historical duplicate (a CLOSED row shares signal_id but
  --    doesn't collide with the partial unique index). This mirrors the real
  --    dirty-data shape reported for expert 彥愷 / 00631L.
  INSERT INTO public.trade_records
    (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit,
     exit_price, exit_date, market, currency, created_at)
  VALUES
    (v_expert, v_signal, '2454 MTK', 1180, now() - interval '10 days', 'closed', 1, '張',
     1195, now() - interval '9 days', 'TW', 'TWD', now() - interval '10 days');

  -- Sanity check: audit sees a duplicate
  SELECT count(*) INTO v_after FROM public.trade_records WHERE signal_id = v_signal;
  IF v_after <> 2 THEN
    RAISE EXCEPTION 'CASE E setup FAILED: expected 2 rows, got %', v_after;
  END IF;

  -- 4) Dry run — nothing should change
  v_result := public.admin_signal_dupe_trades_fix(v_signal, p_dry_run := true, p_force := true);
  IF (v_result->>'executed')::boolean IS TRUE THEN
    RAISE EXCEPTION 'CASE E FAILED: dry_run should not execute (got %)', v_result;
  END IF;
  SELECT count(*) INTO v_after FROM public.trade_records WHERE signal_id = v_signal;
  IF v_after <> 2 THEN
    RAISE EXCEPTION 'CASE E FAILED: dry_run mutated data (rows=%)', v_after;
  END IF;

  -- 5) Real fix (force=true because closed+open counts as manual edit)
  v_result := public.admin_signal_dupe_trades_fix(v_signal, p_dry_run := false, p_force := true);

  SELECT count(*) INTO v_after FROM public.trade_records WHERE signal_id = v_signal;
  IF v_after <> 1 THEN
    RAISE EXCEPTION 'CASE E FAILED: expected 1 remaining row, got %', v_after;
  END IF;

  SELECT count(*) INTO v_audit
    FROM public.audit_logs
   WHERE action = 'signal_dupe_trade_fix' AND target_id = v_signal;
  IF v_audit < 1 THEN
    RAISE EXCEPTION 'CASE E FAILED: audit_logs entry missing';
  END IF;

  -- 6) Idempotency — a second invocation must be a no-op
  v_result := public.admin_signal_dupe_trades_fix(v_signal, p_dry_run := false, p_force := true);
  IF v_result->>'note' NOT IN ('no_dupes','no_rows') THEN
    RAISE EXCEPTION 'CASE E FAILED: second call not idempotent, got %', v_result;
  END IF;

  SELECT count(*) INTO v_after FROM public.trade_records WHERE signal_id = v_signal;
  IF v_after <> 1 THEN
    RAISE EXCEPTION 'CASE E FAILED: idempotent call changed row count to %', v_after;
  END IF;
END
$case_e$;
ROLLBACK TO SAVEPOINT case_e;

-- ---------------------------------------------------------------------
-- Done — discard the whole fixture
-- ---------------------------------------------------------------------
ROLLBACK;

\echo '✅ trade_records dedupe regression: all cases passed'
