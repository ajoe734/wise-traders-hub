#!/usr/bin/env bash
# Flow B2 (clone only, never connects to production):
#   restore production-shape baseline from the S0 backup bundle
#   -> fingerprint(before)
#   -> apply S1-min in ONE transaction
#   -> fingerprint(after)         : must equal before  (additive proof)
#   -> S1-min verifier
#   -> S1-min stage rollback (drops only created objects)
#   -> fingerprint(rollback)      : must equal before, relfilenode included
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$ROOT"
NAME=${1:-s1minA}; PORT=${2:-55971}; OUT=${3:-/tmp/s1min-$NAME}; BK=db/r1/c/S0/backup
DIR=/tmp/$NAME; mkdir -p "$OUT"; rm -rf "$DIR"; mkdir -p "$DIR/sock"
RUNID="$NAME-$(date -u +%Y%m%dT%H%M%SZ)-$$"; START=$(date -u +%FT%T.%3NZ); LOG="$OUT/$NAME.log"; FAILS=0
say(){ echo "$*"|tee -a "$LOG"; }; fail(){ say "FAIL: $*"; FAILS=$((FAILS+1)); }
PGBIN=$(dirname "$(command -v initdb)"); unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
ASU=""; if [ "$(id -u)" = 0 ]; then chown -R 1000:1000 "$DIR"; ASU="setpriv --reuid=1000 --regid=1000 --clear-groups"; fi
$ASU initdb -D "$DIR/pg" -U postgres --locale=C -E UTF8 >"$DIR/initdb.log" 2>&1 || exit 1
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" -o "-p $PORT -k $DIR/sock -c listen_addresses=127.0.0.1 -c fsync=off" -w start >/dev/null 2>&1 || exit 1
psql "postgresql://postgres@localhost:$PORT/postgres?sslmode=disable" -qX -c 'create database clone' >/dev/null
CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"
say "### FLOW B2 (S1-min) run_id=$RUNID start=$START port=$PORT"

for f in $(python3 -c "import json;print(' '.join(json.load(open('$BK/MANIFEST.json'))['restore_bundle']['order']))"); do
  psql "$CL" -qX -f "$BK/restore/$f" >>"$DIR/restore.log" 2>&1
done
say "-- baseline restored from $BK/MANIFEST.json (no R1 base scripts applied)"

psql "$CL" -AtqX -f db/r1/c/S1/s1min_fingerprint.sql >"$DIR/before.fp"

psql "$CL" -qX -v ON_ERROR_STOP=1 --single-transaction \
  -f db/r1/c/S1/001_s1min.sql -f db/r1/c/S1/010_manifest_seed.sql >>"$DIR/s1min.log" 2>&1 \
  || fail "S1-min apply (single transaction)"
say "-- S1-min applied in one transaction"

psql "$CL" -AtqX -f db/r1/c/S1/s1min_fingerprint.sql >"$DIR/after.fp"
diff -u "$DIR/before.fp" "$DIR/after.fp" >"$DIR/additive.diff" || fail "S1-min mutated baseline (relfilenode/economic/ACL/writer/trigger/role)"

psql "$CL" -AtqX -v ON_ERROR_STOP=1 -f db/r1/c/S1/s1min_verify.sql >"$DIR/verify.out" 2>&1 || fail "S1-min verifier"
grep -q S1MIN_VERIFY_PASS "$DIR/verify.out" || fail "verifier did not pass"

psql "$CL" -qX -v ON_ERROR_STOP=1 --single-transaction -f db/r1/c/S1/s1min_rollback.sql >>"$DIR/rollback.log" 2>&1 || fail "S1-min rollback"
psql "$CL" -AtqX -f db/r1/c/S1/s1min_fingerprint.sql >"$DIR/rollback.fp"
diff -u "$DIR/before.fp" "$DIR/rollback.fp" >"$DIR/rollback.diff" || fail "rollback did not restore the baseline fingerprint (relfilenode included)"

# rollback must leave nothing behind
LEFT=$(psql "$CL" -AtqX -c "SELECT (SELECT count(*) FROM pg_namespace WHERE nspname='app_ledger')+(SELECT count(*) FROM pg_roles WHERE rolname='ledger_owner')+(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('public_projection_version','public_projection_withheld'))")
[ "$LEFT" = "0" ] || fail "rollback residue=$LEFT"

mkdir -p "$OUT/$NAME-artifacts"; cp "$DIR"/*.log "$DIR"/*.fp "$DIR"/*.diff "$DIR"/*.out "$OUT/$NAME-artifacts/" 2>/dev/null || true
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -m immediate -w stop >/dev/null 2>&1; rm -rf "$DIR"
BG=$(pgrep -f "port=$PORT"|wc -l); [ "$BG" = 0 ] || fail "background=$BG"
END=$(date -u +%FT%T.%3NZ); H=$(sha256sum "$LOG"|cut -d' ' -f1)
say "### RESULT run_id=$RUNID start=$START end=$END log_sha256=$H failures=$FAILS destroyed=true background=$BG"
exit "$FAILS"
