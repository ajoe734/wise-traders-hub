#!/usr/bin/env bash
# =====================================================================
# R1-P 092 — T+7 embargo closure against a FROZEN ANCHOR CLOCK.
#
# The anchor A is a fixed timestamp captured once at the start of the run.
# Every fixture effect is booked at A - k so the T+7 lattice is deterministic
# and independent of wall time. Visibility is stamped ONCE by the writer
# (app_ledger.publish_signal_effect: visible_at = effective_at + 7d) and is
# immutable afterwards — this harness never mutates economic_effect, which is
# exactly what the append-only trigger forbids.
#
#   effective_at            visible_at = effective_at + 7d      expected
#   A - 8d                  A - 1d                              VISIBLE
#   A - 7d - 1min           A - 1min                            VISIBLE
#   A - 7d + 1min           A + 1min                            HIDDEN
#   A - 6d                  A + 1d                              HIDDEN
#   A                       A + 7d                              HIDDEN
#
# Channels asserted: position rows, aggregate quantity, portfolio state, NAV,
# return/chart series, the export/factsheet payload, the OG/cache surface, the
# anonymous *_active views, the internal versioned tables, plus anon and
# authenticated ACL. A run that produces fewer than MIN_TESTS results is a
# harness failure, not a pass.
# usage: 092_embargo.sh <conninfo> [logfile]
# =====================================================================
set -uo pipefail
CL="${1:?conninfo required}"
LOG="${2:-/dev/stdout}"
MIN_TESTS=22

psql "$CL" -X -v ON_ERROR_STOP=0 >"$LOG" 2>&1 <<'SQL'
SET client_min_messages = warning;
TRUNCATE t.result RESTART IDENTITY;

CREATE SCHEMA IF NOT EXISTS te;
DROP TABLE IF EXISTS te.ids;
CREATE TABLE te.ids(k text primary key, v uuid, ts timestamptz);
INSERT INTO te.ids(k,v) VALUES
 ('user','aaaaaaa3-0000-4000-8000-000000000001'),
 ('exp' ,'bbbbbbb3-0000-4000-8000-000000000001'),
 ('b1'  ,'ccccccc3-0000-4000-8000-000000000001');
-- the frozen anchor
INSERT INTO te.ids(k,ts) VALUES ('anchor', now());

INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
VALUES ((SELECT v FROM te.ids WHERE k='user'),'00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','embargo@r1p.test',now(),now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.experts(id,user_id,slug,name,role,asset_class,currency,status,starting_capital)
VALUES ((SELECT v FROM te.ids WHERE k='exp'),(SELECT v FROM te.ids WHERE k='user'),
        'r1p-embargo','R1P Embargo','advisor','tw_stock','TWD','active',10000000)
ON CONFLICT (id) DO NOTHING;

-- five effects on the T+7 lattice; the writer stamps visibility on insert
DO $$
DECLARE a timestamptz := (SELECT ts FROM te.ids WHERE k='anchor');
        e uuid := (SELECT v FROM te.ids WHERE k='exp');
        b uuid := (SELECT v FROM te.ids WHERE k='b1');
        offs interval[] := ARRAY['8 days','7 days 1 minute','7 days -1 minute','6 days','0 minutes']::interval[];
        i int;
BEGIN
  FOR i IN 1..5 LOOP
    INSERT INTO public.expert_signals(expert_id,batch_id,instrument,action,quantity,quantity_unit,
      price_hint,status,executed_at,published_at,created_at,market)
    VALUES (e,b,'23'||(29+i)::text,'buy',1,'張',100,'published',
            a - offs[i], a - offs[i], a - offs[i],'TW');
  END LOOP;
END $$;

-- the lattice itself, straight off the writer's stamp
DO $$ DECLARE a timestamptz := (SELECT ts FROM te.ids WHERE k='anchor');
              e uuid := (SELECT v FROM te.ids WHERE k='exp');
BEGIN
  PERFORM t.eq('T-E00a the writer stamped visible_at on every effect',
    (SELECT count(*)::int FROM app_ledger.economic_effect
      WHERE expert_id=e AND visible_at IS NULL), 0);
  PERFORM t.eq('T-E00b visible_at is exactly effective_at + the embargo constant',
    (SELECT count(*)::int FROM app_ledger.economic_effect
      WHERE expert_id=e
        AND visible_at <> effective_at + make_interval(days => app_ledger.embargo_days())), 0);
  PERFORM t.eq('T-E00c exactly two effects have cleared the embargo at the anchor',
    (SELECT count(*)::int FROM app_ledger.economic_effect
      WHERE expert_id=e AND visible_at <= a), 2);
END $$;

DO $$ DECLARE v_ver bigint; a timestamptz := (SELECT ts FROM te.ids WHERE k='anchor');
              e uuid := (SELECT v FROM te.ids WHERE k='exp');
BEGIN
  v_ver := app_ledger.canonical_publish(e);
  INSERT INTO te.ids(k,v) VALUES ('ver', NULL) ON CONFLICT (k) DO NOTHING;
  UPDATE te.ids SET ts = to_timestamp(v_ver) WHERE k='ver';

  PERFORM t.eq('T-E01 only the two released effects are public',
    (SELECT count(*)::int FROM public.public_position_projection
      WHERE projection_version=v_ver), 2);
  PERFORM t.eq('T-E02 the T+7 boundary minus 1 minute is public',
    (SELECT count(*)::int FROM public.public_position_projection
      WHERE projection_version=v_ver AND instrument='2331'), 1);
  PERFORM t.eq('T-E03 the T+7 boundary plus 1 minute is hidden',
    (SELECT count(*)::int FROM public.public_position_projection
      WHERE projection_version=v_ver AND instrument='2332'), 0);
  PERFORM t.eq('T-E04 a 6-day-old effect is hidden',
    (SELECT count(*)::int FROM public.public_position_projection
      WHERE projection_version=v_ver AND instrument='2333'), 0);
  PERFORM t.eq('T-E05 a same-day effect is hidden',
    (SELECT count(*)::int FROM public.public_position_projection
      WHERE projection_version=v_ver AND instrument='2334'), 0);
  PERFORM t.eq('T-E06 the version records the embargoed count',
    (SELECT embargoed_count FROM public.public_projection_version
      WHERE projection_version=v_ver), 3);
  PERFORM t.ok('T-E07 no embargoed quantity leaks into the aggregate',
    (SELECT coalesce(sum(quantity),0) FROM public.public_position_projection
      WHERE projection_version=v_ver) = 2);
  PERFORM t.ok('T-E08 no NAV row values an embargoed effect',
    NOT EXISTS (SELECT 1 FROM public.public_nav_daily nd
                 WHERE nd.projection_version=v_ver AND nd.trade_date > a::date));
  -- portfolio state / return / chart series inherit the same cutoff
  PERFORM t.ok('T-E08b portfolio open cost reflects only released positions',
    (SELECT coalesce(open_cost,0) FROM public.public_portfolio_state
      WHERE projection_version=v_ver)
    = (SELECT coalesce(sum(quantity*avg_cost),0) FROM public.public_position_projection
        WHERE projection_version=v_ver));
  PERFORM t.ok('T-E08c the NAV/return chart series never predates the released effects',
    NOT EXISTS (SELECT 1 FROM public.public_nav_daily nd
                 WHERE nd.projection_version=v_ver
                   AND nd.trade_date < (a - interval '8 days')::date));
  PERFORM t.eq('T-E08d the export/factsheet payload view exposes only released rows',
    (SELECT count(*)::int FROM public.public_expert_positions_v1 WHERE expert_id=e), 2);
  PERFORM t.eq('T-E08e the OG/cache NAV surface exposes only the released build',
    (SELECT count(*)::int FROM public.public_expert_nav_v1 nv
      WHERE nv.expert_id=e AND nv.trade_date > a::date), 0);
END $$;

-- anonymous channel: the active views and the raw tables
DO $$ DECLARE e uuid := (SELECT v FROM te.ids WHERE k='exp'); a int; b int; c int; BEGIN
  SET LOCAL ROLE anon;
  SELECT count(*)::int INTO a FROM public.public_position_active WHERE expert_id=e;
  SELECT count(*)::int INTO b FROM public.public_position_active
   WHERE expert_id=e AND instrument IN ('2332','2333','2334');
  SELECT coalesce(sum(quantity),0)::int INTO c FROM public.public_position_active WHERE expert_id=e;
  RESET ROLE;
  PERFORM t.eq('T-E10 anon sees only released positions', a, 2);
  PERFORM t.eq('T-E11 anon sees no embargoed instrument', b, 0);
  PERFORM t.eq('T-E11b anon aggregates cannot exceed the released quantity', c, 2);
END $$;
DO $$ DECLARE n int; e uuid := (SELECT v FROM te.ids WHERE k='exp'); BEGIN
  SET LOCAL ROLE anon;
  DECLARE r12 bool := false; r13 bool := false; r14 bool := false; BEGIN
    BEGIN SELECT count(*) INTO n FROM public.public_position_projection;
    EXCEPTION WHEN insufficient_privilege THEN r12 := true; END;
    BEGIN SELECT count(*) INTO n FROM public.public_projection_withheld;
    EXCEPTION WHEN insufficient_privilege OR undefined_table THEN r13 := true; END;
    BEGIN SELECT count(*) INTO n FROM app_ledger.economic_effect;
    EXCEPTION WHEN insufficient_privilege OR invalid_schema_name THEN r14 := true; END;
    RESET ROLE;
    PERFORM t.ok('T-E12 anon cannot read the versioned projection table', r12);
    PERFORM t.ok('T-E13 anon cannot read the withheld ledger', r13);
    PERFORM t.ok('T-E14 anon cannot read economic effects', r14);
    SET LOCAL ROLE anon;
  END;
  BEGIN
    SELECT count(*) INTO n FROM public.expert_signals WHERE expert_id=e;
  EXCEPTION WHEN insufficient_privilege THEN
    n := -1;
  END;
  RESET ROLE;
  IF n = -1 THEN
    PERFORM t.ok('T-E15 anon reads no raw embargoed signal row', true, 'refused 42501');
  ELSE
    PERFORM t.eq('T-E15 anon reads no raw embargoed signal row', n, 0);
  END IF;
END $$;

-- authenticated member with no entitlement: identical embargo, no extra reach
DO $$ DECLARE n int; e uuid := (SELECT v FROM te.ids WHERE k='exp');
              a int; b int; r18 bool := false; BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','aaaaaaa3-0000-4000-8000-0000000000ff','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO a FROM public.public_position_active WHERE expert_id=e;
  SELECT count(*)::int INTO b FROM public.public_position_active
   WHERE expert_id=e AND instrument IN ('2332','2333','2334');
  BEGIN SELECT count(*) INTO n FROM public.public_position_projection;
  EXCEPTION WHEN insufficient_privilege THEN r18 := true; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims','',true);
  PERFORM t.eq('T-E16 a signed-in member sees the same two released positions', a, 2);
  PERFORM t.eq('T-E17 a signed-in member sees no embargoed instrument', b, 0);
  PERFORM t.ok('T-E18 a signed-in member cannot read the versioned projection table', r18);
END $$;
SQL

TOT=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result")
RED=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result WHERE NOT passed")
TOT=${TOT:-0}; RED=${RED:-0}
echo "  092_embargo (frozen anchor): $TOT tests, $RED failures (min required $MIN_TESTS)"
psql "$CL" -tAqX -c "SELECT name FROM t.result ORDER BY id" | sed 's/^/    id: /'
if [ "$TOT" -lt "$MIN_TESTS" ]; then
  echo "  092_embargo HARNESS FAILURE: only $TOT tests executed (< $MIN_TESTS)"
  sed -n '1,80p' "$LOG" | grep -E '^(psql:|ERROR)' | head -10 | sed 's/^/    /'
  exit $(( MIN_TESTS - TOT + RED ))
fi
[ "$RED" = "0" ] || psql "$CL" -tAqX -c \
  "SELECT name||' | '||coalesce(detail,'') FROM t.result WHERE NOT passed ORDER BY id"
exit "$RED"
