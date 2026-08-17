#!/usr/bin/env bash
# hfreshA (clone only, never connects to production):
#   restore production-shape baseline from the S0 backup bundle
#   -> fingerprint(before)
#   -> apply H0 + H1 + H2 in ONE transaction
#   -> fingerprint(after)      : must equal before  (additive proof)
#   -> H verifier (H0 trace/retention, H1 master, H2 abuse/poisoning)
#   -> stage rollback (drops only objects H created)
#   -> fingerprint(rollback)   : must equal before, relfilenode included
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$ROOT"
NAME=${1:-hfreshA}; PORT=${2:-55981}; OUT=${3:-/tmp/hfresh-$NAME}; BK=db/r1/c/S0/backup
DIR=/tmp/$NAME; mkdir -p "$OUT"; rm -rf "$DIR"; mkdir -p "$DIR/sock"
RUNID="$NAME-$(date -u +%Y%m%dT%H%M%SZ)-$$"; START=$(date -u +%FT%T.%3NZ); LOG="$OUT/$NAME.log"; FAILS=0
say(){ echo "$*"|tee -a "$LOG"; }; fail(){ say "FAIL: $*"; FAILS=$((FAILS+1)); }
PGBIN=$(dirname "$(command -v initdb)"); unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
ASU=""; if [ "$(id -u)" = 0 ]; then chown -R 1000:1000 "$DIR"; ASU="setpriv --reuid=1000 --regid=1000 --clear-groups"; fi
$ASU initdb -D "$DIR/pg" -U postgres --locale=C -E UTF8 >"$DIR/initdb.log" 2>&1 || exit 1
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" -o "-p $PORT -k $DIR/sock -c listen_addresses=127.0.0.1 -c fsync=off" -w start >/dev/null 2>&1 || exit 1
psql "postgresql://postgres@localhost:$PORT/postgres?sslmode=disable" -qX -c 'create database clone' >/dev/null
CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"
say "### hfreshA (H0/H1/H2) run_id=$RUNID start=$START port=$PORT"

for f in $(python3 -c "import json;print(' '.join(json.load(open('$BK/MANIFEST.json'))['restore_bundle']['order']))"); do
  psql "$CL" -qX -f "$BK/restore/$f" >>"$DIR/restore.log" 2>&1
done
say "-- baseline restored from $BK/MANIFEST.json"

psql "$CL" -AtqX -f db/r1/c/H/h_fingerprint.sql >"$DIR/before.fp"

psql "$CL" -qX -v ON_ERROR_STOP=1 --single-transaction \
  -f db/r1/c/H/001_h0_observability.sql \
  -f db/r1/c/H/002_h1_market_master.sql \
  -f db/r1/c/H/003_h2_demand_registry.sql >>"$DIR/apply.log" 2>&1 || fail "H apply (single transaction)"
say "-- H0/H1/H2 applied in one transaction"

psql "$CL" -AtqX -f db/r1/c/H/h_fingerprint.sql >"$DIR/after.fp"
diff -u "$DIR/before.fp" "$DIR/after.fp" >"$DIR/additive.diff" || fail "H mutated the baseline (relfilenode/economic/ACL/writer/trigger/role)"

psql "$CL" -AtqX -f db/r1/c/H/h_verify.sql >"$DIR/verify.out" 2>&1
grep -q H_VERIFY_PASS "$DIR/verify.out" || fail "H verifier did not pass"
say "-- verifier: $(grep -E 'H_VERIFY_(PASS|FAIL)' "$DIR/verify.out" | tail -1)"
grep ' : FAIL' "$DIR/verify.out" | tee -a "$LOG"

psql "$CL" -qX -v ON_ERROR_STOP=1 --single-transaction -f db/r1/c/H/h_rollback.sql >>"$DIR/rollback.log" 2>&1 || fail "H rollback"
psql "$CL" -AtqX -f db/r1/c/H/h_fingerprint.sql >"$DIR/rollback.fp"
# the verifier writes synthetic log rows, so the log rowcount line is expected to move
grep -v baseline_log_rowcounts "$DIR/before.fp" >"$DIR/before.core"
grep -v baseline_log_rowcounts "$DIR/rollback.fp" >"$DIR/rollback.core"
diff -u "$DIR/before.core" "$DIR/rollback.core" >"$DIR/rollback.diff" || fail "rollback did not restore the baseline fingerprint (relfilenode included)"

LEFT=$(psql "$CL" -AtqX -c "SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('tw_market_symbols','symbol_demand_registry','freshness_run_trace'))+(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('register_symbol_demand','decay_symbol_demand','upsert_tw_market_symbols','tw_market_symbols_touch','cleanup_old_edge_boot_events','cleanup_old_bsr_attempt_logs','cleanup_old_cron_dispatch_log'))+(SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name='correlation_id' AND table_name IN ('cron_dispatch_log','edge_boot_events'))")
[ "$LEFT" = "0" ] || fail "rollback residue=$LEFT"

mkdir -p "$OUT/$NAME-artifacts"; cp "$DIR"/*.log "$DIR"/*.fp "$DIR"/*.diff "$DIR"/*.out "$OUT/$NAME-artifacts/" 2>/dev/null || true
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -m immediate -w stop >/dev/null 2>&1; rm -rf "$DIR"
BG=$(pgrep -f "port=$PORT"|wc -l); [ "$BG" = 0 ] || fail "background=$BG"
END=$(date -u +%FT%T.%3NZ); H=$(sha256sum "$LOG"|cut -d' ' -f1)
say "### RESULT run_id=$RUNID start=$START end=$END log_sha256=$H failures=$FAILS destroyed=true background=$BG"
exit "$FAILS"
