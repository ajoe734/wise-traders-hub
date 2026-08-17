#!/usr/bin/env bash
# hfreshB — H5 SELECT-only proof on a disposable production-shape clone.
# Never connects to production. Fail-loud: any unexpected error, any missing
# verifier summary, any silent exit => non-zero exit code.
#
#   preflight (port/disk/binaries) -> restore baseline -> fixtures
#   -> fingerprint(before) -> apply H5 -> fingerprint(after) == before
#   -> SELECT-only role runs every path (ready / cache-miss / unsupported / error)
#   -> statement capture: 0 DML, 0 volatile writer RPC, rebuild_bsr_rollup=0
#   -> rowcount / tuple stats / max(updated_at) / data hash before == after
#   -> rollback drops only get_chips_detail_ro; fingerprint back to baseline
set -Eeuo pipefail

ROOT=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$ROOT"
NAME=${1:-hfreshB}; PORT=${2:-55991}; OUT=${3:-/tmp/hfresh-$NAME}; BK=db/r1/c/S0/backup
DIR=/tmp/$NAME
RUNID="$NAME-$(date -u +%Y%m%dT%H%M%SZ)-$$"
START=$(date -u +%FT%T.%3NZ)
mkdir -p "$OUT"; LOG="$OUT/$NAME.log"; : >"$LOG"
# everything (stdout + stderr, including psql chatter) goes to the log
exec > >(tee -a "$LOG") 2>&1

FAILS=0; CHECKS=0; SUMMARY_EMITTED=0; STAGE="init"
say(){ echo "$*"; }
chk(){ CHECKS=$((CHECKS+1)); if [ "$1" = "0" ]; then say "  PASS $2"; else FAILS=$((FAILS+1)); say "  FAIL $2 ${3:-}"; fi; }
fail(){ FAILS=$((FAILS+1)); say "  FAIL $*"; }
fatal(){ FAILS=$((FAILS+1)); say "!! FATAL stage=$STAGE: $*"; exit 1; }
on_err(){ local c=$?; say "!! ERR stage=$STAGE line=${BASH_LINENO[0]} cmd=[$BASH_COMMAND] exit=$c"; FAILS=$((FAILS+1)); }
cleanup(){
  local c=$?
  trap - EXIT ERR; set +e
  if [ -d "$DIR/pg" ]; then $ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -m immediate -w stop >/dev/null 2>&1; fi
  mkdir -p "$OUT/$NAME-artifacts"; cp "$DIR"/*.log "$DIR"/*.fp "$DIR"/*.out "$DIR"/*.diff "$OUT/$NAME-artifacts/" 2>/dev/null
  rm -rf "$DIR"
  local BG; BG=$(pgrep -f "port=$PORT" | wc -l)
  local DESTROYED=true; [ -d "$DIR" ] && DESTROYED=false
  [ "$BG" = 0 ] || { FAILS=$((FAILS+1)); say "  FAIL background=$BG"; }
  if [ "$SUMMARY_EMITTED" != "1" ]; then
    FAILS=$((FAILS+1))
    say "!! NO VERIFIER SUMMARY — aborted at stage=$STAGE with exit=$c (this is a FAIL, not a skip)"
  fi
  local END H
  END=$(date -u +%FT%T.%3NZ); H=$(sha256sum "$LOG" | cut -d' ' -f1)
  echo "### RESULT run_id=$RUNID start=$START end=$END stage=$STAGE checks=$CHECKS failures=$FAILS destroyed=$DESTROYED background=$BG log_sha256_pre_result=$H"
  [ "$FAILS" = 0 ] || exit 1
  exit 0
}
stage(){ STAGE=$1; say "== stage $1 start=$(date -u +%FT%T.%3NZ)"; }
stage_end(){ say "== stage $STAGE end=$(date -u +%FT%T.%3NZ) exit=0"; }
trap on_err ERR
trap cleanup EXIT

say "### hfreshB run_id=$RUNID start=$START port=$PORT out=$OUT"

############################################################ preflight
stage preflight
PGBIN=$(dirname "$(command -v initdb)")
command -v psql >/dev/null || fatal "psql missing"
[ -x "$PGBIN/pg_ctl" ] || fatal "pg_ctl missing in $PGBIN"
python3 - "$PORT" <<'PY' || fatal "port $PORT already in use (bind failed)"
import socket,sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
try: s.bind(("127.0.0.1",int(sys.argv[1])))
except OSError: sys.exit(1)
s.close()
PY
AVAIL_MB=$(df -Pm /tmp | awk 'NR==2{print $4}')
[ "$AVAIL_MB" -ge 2048 ] || fatal "not enough disk on /tmp: ${AVAIL_MB}MB"
[ -f "$BK/MANIFEST.json" ] || fatal "backup manifest missing"
say "  preflight ok pgbin=$PGBIN disk=${AVAIL_MB}MB port_free=$PORT"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
rm -rf "$DIR"; mkdir -p "$DIR/sock"
ASU=""; if [ "$(id -u)" = 0 ]; then chown -R 1000:1000 "$DIR"; ASU="setpriv --reuid=1000 --regid=1000 --clear-groups"; fi
stage_end

############################################################ initdb + start
stage initdb
$ASU initdb -D "$DIR/pg" -U postgres --locale=C -E UTF8 >"$DIR/initdb.log" 2>&1 \
  || { tail -20 "$DIR/initdb.log"; fatal "initdb failed"; }
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" \
  -o "-p $PORT -k $DIR/sock -c listen_addresses=127.0.0.1 -c fsync=off -c track_counts=on -c log_statement=all -c log_min_messages=warning -c log_line_prefix='%m [%p] %u ' " \
  -w -t 60 start >"$DIR/pgctl.log" 2>&1 || { tail -20 "$DIR/pg.log"; fatal "pg_ctl start failed"; }
READY=0
for i in $(seq 1 60); do
  if $ASU "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT" -q; then READY=1; break; fi
  sleep 1
done
[ "$READY" = 1 ] || { tail -20 "$DIR/pg.log"; fatal "server never became ready"; }
psql "postgresql://postgres@localhost:$PORT/postgres?sslmode=disable" -qX -c 'create database clone' >/dev/null
CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"
RO="postgresql://drawer_ro:ro@localhost:$PORT/clone?sslmode=disable"
say "  server ready pid=$(head -1 "$DIR/pg/postmaster.pid")"
stage_end

############################################################ restore baseline
stage restore
for f in $(python3 -c "import json;print(' '.join(json.load(open('$BK/MANIFEST.json'))['restore_bundle']['order']))"); do
  psql "$CL" -qX -f "$BK/restore/$f" >>"$DIR/restore.log" 2>&1 || true
done
grep '^psql:.*ERROR' "$DIR/restore.log" | sed -E 's#^psql:[^ ]*/([^/:]+):([0-9]+): ERROR:  #\1:\2 #' | sort >"$DIR/restore_errors.txt" || true
RESTORE_ERR=$(wc -l <"$DIR/restore_errors.txt")
if diff -u <(sort db/r1/c/H/expected_restore_errors.txt) "$DIR/restore_errors.txt" >"$DIR/restore_errors.diff"; then
  chk 0 "B-01 baseline restore errors match the pinned expected set (n=$RESTORE_ERR, pgvector/generated-column limits of the local initdb)"
else chk 1 "B-01 baseline restore errors match pinned set" "$(cat "$DIR/restore_errors.diff")"; fi
TBL=$(psql "$CL" -AtqX -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'")
chk $([ "$TBL" -ge 120 ] && echo 0 || echo 1) "B-02 production-shape table count>=120" "count=$TBL"
stage_end

############################################################ fixtures
stage fixtures
psql "$CL" -qX -v ON_ERROR_STOP=1 >"$DIR/setup.log" 2>&1 <<'SQL'
-- BYPASSRLS emulates the service_role read path (RLS on the chips tables is
-- service_role-only); the role still holds zero write privileges anywhere.
CREATE ROLE drawer_ro LOGIN BYPASSRLS PASSWORD 'ro';
GRANT USAGE ON SCHEMA public TO drawer_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO drawer_ro;
INSERT INTO public.tw_bsr_daily(stock_id, trade_date, broker_id, broker_name, buy_shares, sell_shares, net_shares)
VALUES ('2330', current_date, '9200', 'A', 5000, 1000, 4000),
       ('6515', current_date, '9200', 'A', 100, 50, 50);
INSERT INTO public.tw_chips_rollup(stock_id, as_of_date, window_days, foreign_net, trust_net, dealer_net, bsr_available)
VALUES ('2330', current_date, 5, 1000, 200, -50, true),
       ('6515', current_date, 5, 10, 0, 0, false);
INSERT INTO public.bsr_coverage_daily(stock_id, trade_date, broker_count, broker_sum_shares, coverage_pct, coverage_class)
VALUES ('2330', current_date, 30, 100000, 92.50, 'high');
SQL
say "  fixtures: 2330=ready 6515=rollup-without-bsr 1234=cache-miss"
stage_end

############################################################ fingerprint + apply
stage apply
psql "$CL" -AtqX -f db/r1/c/H/h5_fingerprint.sql >"$DIR/before.fp"
psql "$CL" -qX -v ON_ERROR_STOP=1 --single-transaction -f db/r1/c/H/004_h5_readonly_contract.sql >"$DIR/apply.log" 2>&1
psql "$CL" -AtqX -f db/r1/c/H/h5_fingerprint.sql >"$DIR/after_apply.fp"
if diff -u "$DIR/before.fp" "$DIR/after_apply.fp" >"$DIR/apply.diff"; then chk 0 "B-03 H5 apply is additive (baseline fingerprint unchanged)"; else chk 1 "B-03 H5 apply is additive" "$(cat "$DIR/apply.diff")"; fi
NEWOBJ=$(psql "$CL" -AtqX -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_chips_detail_ro'")
chk $([ "$NEWOBJ" = 1 ] && echo 0 || echo 1) "B-04 exactly one new object created" "count=$NEWOBJ"
VOL=$(psql "$CL" -AtqX -c "SELECT p.provolatile::text||p.prosecdef::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_chips_detail_ro'")
chk $([ "$VOL" = "sfalse" ] && echo 0 || echo 1) "B-05 new function is STABLE + SECURITY INVOKER" "volatile/secdef=$VOL"
psql "$CL" -qX -c "GRANT EXECUTE ON FUNCTION public.get_chips_detail_ro(text,integer) TO drawer_ro" >/dev/null
stage_end

############################################################ read paths as SELECT-only role
stage read_paths
ROPRIV=$(psql "$CL" -AtqX -c "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='drawer_ro' AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')")
chk $([ "$ROPRIV" = 0 ] && echo 0 || echo 1) "B-06 drawer_ro holds no write privilege on any table" "writes=$ROPRIV"

LOGOFF=$(stat -c%s "$DIR/pg.log")
: >"$DIR/read.out"; : >"$DIR/read.err"
run_ro(){ psql "$RO" -AtqX -c "$1" >>"$DIR/read.out" 2>>"$DIR/read.err" || echo "ERRPATH:$1" >>"$DIR/read.out"; }
for i in 1 2 3; do
  run_ro "SELECT public.get_chips_detail_ro('2330',5)"      # success
  run_ro "SELECT public.get_chips_detail_ro('1234',5)"      # cache miss
  run_ro "SELECT public.get_chips_detail_ro('6515',5)"      # unsupported / no bsr
  run_ro "SELECT public.get_chips_detail_ro(NULL,5)"        # error path: null symbol
  run_ro "SELECT public.get_chips_detail_ro('',5)"          # error path: empty symbol
  run_ro "SELECT public.get_chips_detail_ro('2330',-1)"     # error path: bad window
  run_ro "SELECT public.get_chips_detail_ro('2330'' OR 1=1--',5)"  # error path: injection-shaped input
  run_ro "SELECT public.get_chips_detail_ro('2330',99999)"  # error path: absurd window
done
chk $([ ! -s "$DIR/read.err" ] && echo 0 || echo 1) "B-07 read paths raised no unexpected error" "$(head -3 "$DIR/read.err" 2>/dev/null)"
RDY=$(grep -c '"state": "ready", "stock_id": "2330"' "$DIR/read.out" || true)
PEND=$(grep -c '"state": "pending", "stock_id": "1234"' "$DIR/read.out" || true)
UNAV=$(grep -c '"state": "unavailable", "stock_id": "6515"' "$DIR/read.out" || true)
chk $([ "$RDY" = 3 ] && echo 0 || echo 1) "B-08 success path returns state=ready (2330 x3)" "hits=$RDY"
chk $([ "$PEND" = 3 ] && echo 0 || echo 1) "B-09 cache miss returns state=pending (1234 x3), no rebuild" "hits=$PEND"
chk $([ "$UNAV" = 3 ] && echo 0 || echo 1) "B-10 no-bsr returns state=unavailable (6515 x3)" "hits=$UNAV"
RC=$(grep -c 'get_chips_detail_ro' "$DIR/read.out" || true)
say "  read rows captured=$(wc -l <"$DIR/read.out") errpaths=$RC"
stage_end

############################################################ statement capture
stage statement_capture
tail -c +$((LOGOFF+1)) "$DIR/pg.log" >"$DIR/read_statements.log"
DML=$(grep -icE 'statement:[[:space:]]*(insert|update|delete|truncate|copy .* from)' "$DIR/read_statements.log" || true)
chk $([ "$DML" = 0 ] && echo 0 || echo 1) "B-11 statement capture: 0 INSERT/UPDATE/DELETE/TRUNCATE during read phase" "dml=$DML"
REB=$(grep -ic 'rebuild_bsr_rollup' "$DIR/read_statements.log" || true)
chk $([ "$REB" = 0 ] && echo 0 || echo 1) "B-12 rebuild_bsr_rollup call count=0" "hits=$REB"
WRPC=$(grep -icE 'enqueue_bsr_backfill|ensure_bsr_queued|claim_bsr_queue_jobs|register_symbol_demand|converge_bsr_windows|bsr_snapshot_' "$DIR/read_statements.log" || true)
chk $([ "$WRPC" = 0 ] && echo 0 || echo 1) "B-13 volatile writer RPC call count=0" "hits=$WRPC"
XACT=$(psql "$CL" -AtqX -c "SELECT xact_rollback>=0 AND (SELECT coalesce(sum(n_tup_ins+n_tup_upd+n_tup_del),0) FROM pg_stat_user_tables)>=0 FROM pg_stat_database WHERE datname='clone'")
say "  read-phase statements=$(grep -c 'statement:' "$DIR/read_statements.log" || true)"
stage_end

############################################################ zero-write proof
stage zero_write
psql "$CL" -qX -c 'SELECT pg_stat_clear_snapshot()' >/dev/null
psql "$CL" -AtqX -f db/r1/c/H/h5_fingerprint.sql >"$DIR/after_read.fp"
if diff -u "$DIR/before.fp" "$DIR/after_read.fp" >"$DIR/read.diff"; then
  chk 0 "B-14 rowcounts / max(updated_at) / data hash identical before==after"
else chk 1 "B-14 rowcounts / max(updated_at) / data hash identical" "$(cat "$DIR/read.diff")"; fi
TUP=$(psql "$CL" -AtqX -c "SELECT coalesce(sum(n_tup_ins+n_tup_upd+n_tup_del),0) FROM pg_stat_user_tables WHERE relname IN ('tw_bsr_sync_queue','tw_bsr_attempt_logs','tw_chips_rollup','bsr_coverage_daily')")
FIXTUP=$(psql "$CL" -AtqX -c "SELECT 3")   # fixtures wrote rollup(2)+coverage(1) before the read phase
chk $([ "$TUP" = "$FIXTUP" ] && echo 0 || echo 1) "B-15 tuple stats on the four chips tables show only the pre-read fixtures" "tuples=$TUP expected=$FIXTUP"
for stmt in "INSERT INTO public.tw_bsr_sync_queue(stock_id,trade_date,priority) VALUES ('2330',current_date,1)" \
            "UPDATE public.tw_chips_rollup SET foreign_net=0" \
            "DELETE FROM public.tw_bsr_daily" \
            "TRUNCATE public.bsr_coverage_daily"; do
  if psql "$RO" -qX -c "$stmt" >/dev/null 2>&1; then fail "B-16 drawer_ro executed DML: $stmt"; else CHECKS=$((CHECKS+1)); say "  PASS B-16 refused: ${stmt:0:40}..."; fi
done
# Writer-RPC EXECUTE surface. Any writer reachable by a plain reader is an
# EXISTING production ACL gap (PUBLIC EXECUTE in the restored baseline), not
# something H5 introduces: the set is pinned and any change fails the run.
psql "$CL" -AtqX -c "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('rebuild_bsr_rollup','enqueue_bsr_backfill','ensure_bsr_queued','register_symbol_demand','claim_bsr_queue_jobs','converge_bsr_windows')
    AND has_function_privilege('drawer_ro', p.oid,'EXECUTE') ORDER BY 1" | sort -u >"$DIR/writer_acl_gaps.txt"
if diff -u <(sort -u db/r1/c/H/expected_writer_acl_gaps.txt) "$DIR/writer_acl_gaps.txt" >"$DIR/writer_acl.diff"; then
  chk 0 "B-17 writer-RPC EXECUTE surface for a reader matches the pinned pre-cutover baseline ($(tr '\n' ',' <"$DIR/writer_acl_gaps.txt"))"
else chk 1 "B-17 writer-RPC EXECUTE surface changed" "$(cat "$DIR/writer_acl.diff")"; fi
stage_end

############################################################ rollback
stage rollback
psql "$CL" -qX -v ON_ERROR_STOP=1 -c 'DROP FUNCTION IF EXISTS public.get_chips_detail_ro(text, integer)' >/dev/null
psql "$CL" -AtqX -f db/r1/c/H/h5_fingerprint.sql >"$DIR/rollback.fp"
if diff -u "$DIR/before.fp" "$DIR/rollback.fp" >"$DIR/rollback.diff"; then
  chk 0 "B-18 rollback restores baseline catalog/data/ACL fingerprint"
else chk 1 "B-18 rollback restores baseline fingerprint" "$(cat "$DIR/rollback.diff")"; fi
LEFT=$(psql "$CL" -AtqX -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_chips_detail_ro'")
chk $([ "$LEFT" = 0 ] && echo 0 || echo 1) "B-19 rollback residue=0" "left=$LEFT"
stage_end

############################################################ summary
if [ "$FAILS" = 0 ]; then say "H5_VERIFY_PASS checks=$CHECKS failures=0"; else say "H5_VERIFY_FAIL checks=$CHECKS failures=$FAILS"; fi
SUMMARY_EMITTED=1
