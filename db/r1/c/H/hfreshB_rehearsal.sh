#!/usr/bin/env bash
# hfreshB (clone only): prove the H5 drawer read path is SELECT-only.
#   restore baseline -> apply 004_h5_readonly_contract.sql
#   -> create a login role with SELECT-only privileges (no INSERT/UPDATE/DELETE anywhere)
#   -> run the drawer read path as that role for ready / pending / unavailable symbols
#   -> assert xact write counters, row counts, queue/attempt/rollup tables all unchanged
#   -> assert the role cannot execute rebuild_bsr_rollup / enqueue_bsr_backfill / ensure_bsr_queued
#   -> rollback (drop the one new function) and destroy the clone
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$ROOT"
NAME=${1:-hfreshB}; PORT=${2:-55991}; OUT=${3:-/tmp/hfresh-$NAME}; BK=db/r1/c/S0/backup
DIR=/tmp/$NAME; mkdir -p "$OUT"; rm -rf "$DIR"; mkdir -p "$DIR/sock"
RUNID="$NAME-$(date -u +%Y%m%dT%H%M%SZ)-$$"; START=$(date -u +%FT%T.%3NZ); LOG="$OUT/$NAME.log"; FAILS=0
say(){ echo "$*"|tee -a "$LOG"; }; fail(){ say "FAIL: $*"; FAILS=$((FAILS+1)); }
PGBIN=$(dirname "$(command -v initdb)"); unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
ASU=""; if [ "$(id -u)" = 0 ]; then chown -R 1000:1000 "$DIR"; ASU="setpriv --reuid=1000 --regid=1000 --clear-groups"; fi
$ASU initdb -D "$DIR/pg" -U postgres --locale=C -E UTF8 >"$DIR/initdb.log" 2>&1 || exit 1
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" -o "-p $PORT -k $DIR/sock -c listen_addresses=127.0.0.1 -c fsync=off -c track_counts=on" -w start >/dev/null 2>&1 || exit 1
psql "postgresql://postgres@localhost:$PORT/postgres?sslmode=disable" -qX -c 'create database clone' >/dev/null
CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"
RO="postgresql://drawer_ro:ro@localhost:$PORT/clone?sslmode=disable"
say "### hfreshB (H5 read-only) run_id=$RUNID start=$START port=$PORT"

for f in $(python3 -c "import json;print(' '.join(json.load(open('$BK/MANIFEST.json'))['restore_bundle']['order']))"); do
  psql "$CL" -qX -f "$BK/restore/$f" >>"$DIR/restore.log" 2>&1
done
psql "$CL" -qX -v ON_ERROR_STOP=1 --single-transaction -f db/r1/c/H/004_h5_readonly_contract.sql >>"$DIR/apply.log" 2>&1 || fail "H5 apply"

psql "$CL" -qX >>"$DIR/setup.log" 2>&1 <<'SQL'
CREATE ROLE drawer_ro LOGIN PASSWORD 'ro';
GRANT USAGE ON SCHEMA public TO drawer_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO drawer_ro;
GRANT EXECUTE ON FUNCTION public.get_chips_detail_ro(text, integer) TO drawer_ro;
-- fixtures: ready / unavailable / pending
INSERT INTO public.tw_bsr_daily(stock_id, trade_date, broker_id, broker_name, buy_shares, sell_shares, net_shares)
VALUES ('2330', current_date, '9200', 'A', 5000, 1000, 4000),
       ('6515', current_date, '9200', 'A', 100, 50, 50);
INSERT INTO public.tw_chips_rollup(stock_id, as_of_date, window_days, foreign_net, trust_net, dealer_net, bsr_available)
VALUES ('2330', current_date, 5, 1000, 200, -50, true),
       ('6515', current_date, 5, 10, 0, 0, false);
INSERT INTO public.bsr_coverage_daily(stock_id, trade_date, broker_count, broker_sum_shares, coverage_pct, coverage_class)
VALUES ('2330', current_date, 30, 100000, 92.50, 'high');
SQL

snap(){ psql "$CL" -AtqX -c "SELECT (SELECT count(*) FROM public.tw_bsr_sync_queue)||'|'||(SELECT count(*) FROM public.tw_bsr_attempt_logs)||'|'||(SELECT count(*) FROM public.tw_chips_rollup)||'|'||(SELECT count(*) FROM public.tw_bsr_daily)||'|'||(SELECT count(*) FROM public.chips_prefetch_targets)||'|'||(SELECT count(*) FROM public.bsr_coverage_daily)||'|'||(SELECT count(*) FROM public.tw_bsr_fetch_failures)"; }
wsnap(){ psql "$CL" -AtqX -c "SELECT coalesce(sum(n_tup_ins+n_tup_upd+n_tup_del),0)::text FROM pg_stat_user_tables"; }

B=$(snap); WB=$(wsnap)
say "-- before rows=$B writes=$WB"

for i in 1 2 3 4 5; do
  psql "$RO" -AtqX -c "SELECT public.get_chips_detail_ro('2330',5)" >>"$DIR/read.out" 2>>"$DIR/read.err"
  psql "$RO" -AtqX -c "SELECT public.get_chips_detail_ro('6515',5)" >>"$DIR/read.out" 2>>"$DIR/read.err"
  psql "$RO" -AtqX -c "SELECT public.get_chips_detail_ro('1234',5)" >>"$DIR/read.out" 2>>"$DIR/read.err"
done
[ -s "$DIR/read.err" ] && { fail "read path errored"; cat "$DIR/read.err" | tee -a "$LOG"; }

grep -q '"state" : "ready"' "$DIR/read.out" || grep -q '"state": "ready"' "$DIR/read.out" || fail "ready state missing for 2330"
grep -q 'unavailable' "$DIR/read.out" || fail "unavailable state missing for 6515"
grep -q 'pending' "$DIR/read.out" || fail "pending state missing for unknown symbol"

sleep 1; psql "$CL" -qX -c 'SELECT pg_stat_clear_snapshot()' >/dev/null
A=$(snap); WA=$(wsnap)
say "-- after  rows=$A writes=$WA"
[ "$B" = "$A" ] || fail "row counts changed by the drawer read path: $B -> $A"
[ "$WB" = "$WA" ] || fail "pg_stat_user_tables write tuples changed: $WB -> $WA"

# writer surface must be closed for the drawer role
for fn in "rebuild_bsr_rollup" "enqueue_bsr_backfill" "ensure_bsr_queued" "register_symbol_demand"; do
  N=$(psql "$CL" -AtqX -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn' AND has_function_privilege('drawer_ro', p.oid, 'EXECUTE')")
  [ "$N" = "0" ] || fail "drawer_ro can execute $fn ($N overloads)"
done
say "-- writer RPCs closed to drawer_ro"

# direct DML must be refused
for stmt in "INSERT INTO public.tw_bsr_sync_queue(stock_id,trade_date,priority) VALUES ('2330',current_date,1)" \
            "UPDATE public.tw_chips_rollup SET foreign_net=0" \
            "DELETE FROM public.tw_bsr_daily"; do
  if psql "$RO" -qX -c "$stmt" >/dev/null 2>&1; then fail "drawer_ro executed DML: $stmt"; fi
done
say "-- direct DML refused for drawer_ro"

# stage rollback
psql "$CL" -qX -v ON_ERROR_STOP=1 -c 'DROP FUNCTION IF EXISTS public.get_chips_detail_ro(text, integer)' >/dev/null 2>&1 || fail "H5 rollback"
LEFT=$(psql "$CL" -AtqX -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_chips_detail_ro'")
[ "$LEFT" = "0" ] || fail "rollback residue=$LEFT"

mkdir -p "$OUT/$NAME-artifacts"; cp "$DIR"/*.log "$DIR"/*.out "$OUT/$NAME-artifacts/" 2>/dev/null || true
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -m immediate -w stop >/dev/null 2>&1; rm -rf "$DIR"
BG=$(pgrep -f "port=$PORT"|wc -l); [ "$BG" = 0 ] || fail "background=$BG"
END=$(date -u +%FT%T.%3NZ); H=$(sha256sum "$LOG"|cut -d' ' -f1)
say "### RESULT run_id=$RUNID start=$START end=$END log_sha256=$H failures=$FAILS destroyed=true background=$BG"
exit "$FAILS"
