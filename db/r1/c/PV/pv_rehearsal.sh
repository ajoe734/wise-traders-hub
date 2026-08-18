#!/usr/bin/env bash
# =====================================================================
# PV rehearsal — projection-status view on a disposable clone.
# Usage: db/r1/c/PV/pv_rehearsal.sh <name> <port> [outdir]
# Production is never contacted (PG* unset before anything runs).
# Fail-loud: any unexpected error / missing verifier summary => exit 1.
# =====================================================================
set -Eeuo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$ROOT"
NAME=${1:-PV1}; PORT=${2:-55901}; OUT=${3:-/tmp/pv-$NAME}
DIR=/tmp/pv$NAME
RUNID="$NAME-$(date -u +%Y%m%dT%H%M%SZ)-$$"
START=$(date -u +%FT%T.%3NZ)
mkdir -p "$OUT"; LOG="$OUT/$NAME.log"; : >"$LOG"
exec > >(tee -a "$LOG") 2>&1

FAILS=0; CHECKS=0; SUMMARY=0; STAGE=init
chk(){ CHECKS=$((CHECKS+1)); if [ "$1" = 0 ]; then echo "  PASS $2"; else FAILS=$((FAILS+1)); echo "  FAIL $2 ${3:-}"; fi; }
fatal(){ FAILS=$((FAILS+1)); echo "!! FATAL stage=$STAGE: $*"; exit 1; }
stage(){ STAGE=$1; echo "== stage $1 $(date -u +%FT%T.%3NZ)"; }
on_err(){ local c=$?; echo "!! ERR stage=$STAGE line=${BASH_LINENO[0]} cmd=[$BASH_COMMAND] exit=$c"; FAILS=$((FAILS+1)); }
cleanup(){
  local c=$?; trap - EXIT ERR; set +e
  [ -d "$DIR/pg" ] && $ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -m immediate -w stop >/dev/null 2>&1
  mkdir -p "$OUT/artifacts"; cp "$DIR"/*.txt "$DIR"/*.out "$DIR"/*.log "$OUT/artifacts/" 2>/dev/null
  rm -rf "$DIR"
  local BG; BG=$(pgrep -f "port=$PORT" | wc -l)
  [ "$BG" = 0 ] || { FAILS=$((FAILS+1)); echo "  FAIL background=$BG"; }
  [ "$SUMMARY" = 1 ] || { FAILS=$((FAILS+1)); echo "!! NO VERIFIER SUMMARY — aborted at stage=$STAGE exit=$c (FAIL, not skip)"; }
  local END H; END=$(date -u +%FT%T.%3NZ); H=$(sha256sum "$LOG" | cut -d' ' -f1)
  echo "### RESULT run_id=$RUNID start=$START end=$END stage=$STAGE checks=$CHECKS failures=$FAILS destroyed=true background=$BG log_sha256_pre_result=$H"
  [ "$FAILS" = 0 ] || exit 1
  exit 0
}
trap on_err ERR; trap cleanup EXIT
echo "### pv rehearsal run_id=$RUNID port=$PORT out=$OUT"

############################################################ preflight
stage preflight
if [ -s db/r1/c/H/pgbin.path ]; then PGBIN=$(cat db/r1/c/H/pgbin.path); else PGBIN=$(dirname "$(command -v initdb)"); fi
[ -x "$PGBIN/initdb" ] || fatal "initdb missing in $PGBIN"
export PATH="$PGBIN:$PATH"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
rm -rf "$DIR"; mkdir -p "$DIR/sock"
ASU=""; if [ "$(id -u)" = 0 ]; then chown -R 1000:1000 "$DIR"; ASU="setpriv --reuid=1000 --regid=1000 --clear-groups"; fi

############################################################ initdb
stage initdb
$ASU "$PGBIN/initdb" -D "$DIR/pg" -U postgres --locale=C -E UTF8 >"$DIR/initdb.log" 2>&1 || { tail -20 "$DIR/initdb.log"; fatal initdb; }
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" \
  -o "-p $PORT -k $DIR/sock -c listen_addresses=127.0.0.1 -c fsync=off" \
  -w -t 60 start >"$DIR/pgctl.log" 2>&1 || { tail -20 "$DIR/pg.log"; fatal "pg_ctl start"; }
psql "postgresql://postgres@localhost:$PORT/postgres?sslmode=disable" -qX -c 'create database clone' >/dev/null
CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"

############################################################ shape
stage shape
psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/c/PV/000_clone_shape.sql >"$DIR/shape.log" 2>&1 \
  || { tail -20 "$DIR/shape.log"; fatal "clone shape"; }
grep -E '^psql:.*(ERROR|FATAL)' "$DIR/shape.log" >"$DIR/shape_errors.txt" || true
chk $([ ! -s "$DIR/shape_errors.txt" ] && echo 0 || echo 1) "PV-S1 clone shape applied with 0 errors" "$(head -3 "$DIR/shape_errors.txt")"

############################################################ negative control: pre-migration state
stage pre_migration
psql "$CL" -qXAt -c "SELECT to_regclass('public.public_expert_state_active') IS NULL" >"$DIR/pre.out"
chk $([ "$(cat "$DIR/pre.out")" = t ] && echo 0 || echo 1) "PV-S2 relation absent before the migration (reproduces the production defect)"
psql "$CL" -qXAt -c "SELECT * FROM public.public_expert_state_active LIMIT 1" >"$DIR/pre_err.out" 2>&1 || true
grep -q '42P01' "$DIR/pre_err.out"
chk $? "PV-S3 pre-migration read raises 42P01 (the code the reader fails closed on)"

############################################################ fingerprint before
stage fingerprint_before
FP='SELECT c.relname||q|q||c.relkind||q|q||coalesce(array_to_string(c.reloptions,q,q),q-q)||q|q||coalesce(c.relacl::text,q-q)||q|q||pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=qpublicq AND c.relkind IN (qrq,qvq) ORDER BY 1'
FP=${FP//q|q/\'\|\'}; FP=${FP//q-q/\'-\'}; FP=${FP//q,q/\',\'}; FP=${FP//qpublicq/\'public\'}; FP=${FP//qrq/\'r\'}; FP=${FP//qvq/\'v\'}
psql "$CL" -qXAt -c "$FP" | sort >"$DIR/fp_before.txt"
psql "$CL" -qXAt -c "SELECT md5(string_agg(t,E'\n' ORDER BY t)) FROM (SELECT id::text||'|'||md5(coalesce(reason_detail,'')||coalesce(learning_points,'')) t FROM public.expert_signals) s" >"$DIR/content_before.md5"
psql "$CL" -qXAt -c "SELECT count(*)||'|'||count(*) FILTER (WHERE quantity=0)||'|'||count(*) FILTER (WHERE entry_price IS NULL) FROM public.trade_records" >"$DIR/trades_before.txt"

############################################################ apply
stage apply
psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/c/PV/001_projection_view.sql >"$DIR/apply.log" 2>&1 \
  || { tail -20 "$DIR/apply.log"; fatal "001_projection_view apply"; }
chk 0 "PV-S4 migration applied with ON_ERROR_STOP"

############################################################ verifier
stage verify
psql "$CL" -qX -f db/r1/c/PV/pv_verify.sql >"$DIR/verify.out" 2>&1 || true
grep -E '^(PASS|FAIL)\|' "$DIR/verify.out" | sed 's/^/  /'
VSUM=$(grep -E '^SUMMARY ' "$DIR/verify.out" || true)
[ -n "$VSUM" ] || fatal "verifier produced no summary: $(tail -5 "$DIR/verify.out")"
SUMMARY=1
VCHECKS=$(sed -E 's/.*checks=([0-9]+).*/\1/' <<<"$VSUM")
VFAILS=$(sed -E 's/.*failures=([0-9]+).*/\1/' <<<"$VSUM")
CHECKS=$((CHECKS+VCHECKS)); FAILS=$((FAILS+VFAILS))
echo "  verifier $VSUM"
[ "$VFAILS" = 0 ] || { grep -E '^FAIL\|' "$DIR/verify.out"; }
chk $([ "$VFAILS" = 0 ] && echo 0 || echo 1) "PV-S5 SQL verifier 0 failures ($VCHECKS checks)"

############################################################ data invariants after apply
stage invariants
psql "$CL" -qXAt -c "SELECT md5(string_agg(t,E'\n' ORDER BY t)) FROM (SELECT id::text||'|'||md5(coalesce(reason_detail,'')||coalesce(learning_points,'')) t FROM public.expert_signals) s" >"$DIR/content_after.md5"
diff -q "$DIR/content_before.md5" "$DIR/content_after.md5" >/dev/null
chk $? "PV-S6 expert_signals content hash unchanged by the migration"
psql "$CL" -qXAt -c "SELECT count(*)||'|'||count(*) FILTER (WHERE quantity=0)||'|'||count(*) FILTER (WHERE entry_price IS NULL) FROM public.trade_records" >"$DIR/trades_after.txt"
diff -q "$DIR/trades_before.txt" "$DIR/trades_after.txt" >/dev/null
chk $? "PV-S7 trade_records counts (total | true-zero | null entry) unchanged"

############################################################ rollback
stage rollback
psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/c/PV/099_rollback.sql >"$DIR/rollback.log" 2>&1 || fatal "rollback"
psql "$CL" -qXAt -c "$FP" | sort >"$DIR/fp_after.txt"
diff -u "$DIR/fp_before.txt" "$DIR/fp_after.txt" >"$DIR/fp.diff" || true
chk $([ ! -s "$DIR/fp.diff" ] && echo 0 || echo 1) "PV-S8 rollback restores the pre-migration catalog fingerprint" "$(head -6 "$DIR/fp.diff")"
psql "$CL" -qXAt -c "SELECT to_regclass('public.public_expert_state_active') IS NULL" >"$DIR/post_rb.out"
chk $([ "$(cat "$DIR/post_rb.out")" = t ] && echo 0 || echo 1) "PV-S9 view removed by rollback"
psql "$CL" -qXAt -c "SELECT count(*)||'|'||(SELECT count(*) FROM public.trade_records) FROM public.expert_signals" >"$DIR/rows_post_rb.out"
chk $([ "$(cat "$DIR/rows_post_rb.out")" = "173|82" ] && echo 0 || echo 1) "PV-S10 rollback touches no data (173|82)" "$(cat "$DIR/rows_post_rb.out")"
