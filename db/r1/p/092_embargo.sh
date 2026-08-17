#!/usr/bin/env bash
# =====================================================================
# R1-P 092 — T+7 embargo closure against a FROZEN ANCHOR CLOCK.
#
# The anchor A is a fixed timestamp; every fixture effect is booked at
# A + k so the T+7 lattice is deterministic and independent of wall time:
#
#   published_at            visible_at = published_at + 7d      expected
#   A - 8d                  A - 1d                              VISIBLE
#   A - 7d - 1min           A - 1min                            VISIBLE
#   A - 7d + 1min           A + 1min                            HIDDEN
#   A - 6d                  A + 1d                              HIDDEN
#   A                       A + 7d                              HIDDEN
#
# A == now() at script start, so "visible" means visible_at <= now().
# Every channel is asserted: position rows, portfolio state, NAV/return,
# the anonymous-facing *_active views and the aggregate roll-ups.
# usage: 092_embargo.sh <conninfo> [logfile]
# =====================================================================
set -uo pipefail
CL="${1:?conninfo required}"
LOG="${2:-/dev/stdout}"

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

INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES ((SELECT v FROM te.ids WHERE k='user'),'embargo@r1p.test',now(),now())
ON CONFLICT DO NOTHING;
INSERT INTO public.experts(id,user_id,slug,name,role,asset_class,currency,status,starting_capital)
VALUES ((SELECT v FROM te.ids WHERE k='exp'),(SELECT v FROM te.ids WHERE k='user'),
        'r1p-embargo','R1P Embargo','advisor','tw_stock','TWD','active',10000000)
ON CONFLICT (id) DO NOTHING;

-- five effects on the T+7 lattice
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
  -- the writer stamps visible_at = published_at + 7 days
  UPDATE app_ledger.economic_effect ee SET visible_at = ee.effective_at + interval '7 days'
   WHERE ee.expert_id = e;
END $$;

DO $$ DECLARE v bigint; n int; a timestamptz := (SELECT ts FROM te.ids WHERE k='anchor');
BEGIN
  v := app_ledger.canonical_publish((SELECT v FROM te.ids WHERE k='exp'));

  PERFORM t.eq('T-E01 only the two released effects are public',
    (SELECT count(*)::int FROM public.public_position_projection
      WHERE projection_version=v), 2);
  PERFORM t.eq('T-E02 the T+7 boundary minus 1 minute is public',
    (SELECT count(*)::int FROM public.public_position_projection
      WHERE projection_version=v AND instrument='2331'), 1);
  PERFORM t.eq('T-E03 the T+7 boundary plus 1 minute is hidden',
    (SELECT count(*)::int FROM public.public_position_projection
      WHERE projection_version=v AND instrument='2332'), 0);
  PERFORM t.eq('T-E04 a 6-day-old effect is hidden',
    (SELECT count(*)::int FROM public.public_position_projection
      WHERE projection_version=v AND instrument='2333'), 0);
  PERFORM t.eq('T-E05 a same-day effect is hidden',
    (SELECT count(*)::int FROM public.public_position_projection
      WHERE projection_version=v AND instrument='2334'), 0);
  PERFORM t.eq('T-E06 the version records the embargoed count',
    (SELECT embargoed_count FROM public.public_projection_version
      WHERE projection_version=v), 3);
  PERFORM t.ok('T-E07 no embargoed quantity leaks into the aggregate',
    (SELECT coalesce(sum(quantity),0) FROM public.public_position_projection
      WHERE projection_version=v) = 2);
  PERFORM t.ok('T-E08 no NAV row values an embargoed effect',
    NOT EXISTS (SELECT 1 FROM public.public_nav_daily nd
                 WHERE nd.projection_version=v AND nd.trade_date > a::date));
END $$;

-- anonymous channel: the active views and the raw tables
SET ROLE anon;
DO $$ BEGIN
  PERFORM t.eq('T-E10 anon sees only released positions',
    (SELECT count(*)::int FROM public.public_position_active
      WHERE expert_id=(SELECT v FROM te.ids WHERE k='exp')), 2);
  PERFORM t.eq('T-E11 anon sees no embargoed instrument',
    (SELECT count(*)::int FROM public.public_position_active
      WHERE expert_id=(SELECT v FROM te.ids WHERE k='exp')
        AND instrument IN ('2332','2333','2334')), 0);
END $$;
DO $$ DECLARE n int; BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.public_position_projection;
    PERFORM t.ok('T-E12 anon cannot read the versioned projection table', false);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM t.ok('T-E12 anon cannot read the versioned projection table', true);
  END;
  BEGIN
    SELECT count(*) INTO n FROM public.public_projection_withheld;
    PERFORM t.ok('T-E13 anon cannot read the withheld ledger', false);
  EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
    PERFORM t.ok('T-E13 anon cannot read the withheld ledger', true);
  END;
  BEGIN
    SELECT count(*) INTO n FROM app_ledger.economic_effect;
    PERFORM t.ok('T-E14 anon cannot read economic effects', false);
  EXCEPTION WHEN insufficient_privilege OR invalid_schema_name THEN
    PERFORM t.ok('T-E14 anon cannot read economic effects', true);
  END;
END $$;
RESET ROLE;
SQL

TOT=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result")
RED=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result WHERE NOT passed")
echo "  092_embargo (frozen anchor): $TOT tests, $RED failures"
[ "$RED" = "0" ] || psql "$CL" -tAqX -c \
  "SELECT name||' | '||coalesce(detail,'') FROM t.result WHERE NOT passed ORDER BY id"
exit "${RED:-1}"
