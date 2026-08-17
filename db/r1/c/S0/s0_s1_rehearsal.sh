#!/usr/bin/env bash
# Flow B, clone only: restore baseline -> apply only the three proposed S1 files
# -> verify additive/no-economic-drift/old-writer compatibility -> S1-only
# rollback -> byte-identical baseline catalog/data/ACL. Never connects to prod.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$ROOT"
NAME=${1:-s0s1A}; PORT=${2:-55931}; OUT=${3:-/tmp/s0-s1-$NAME}; BK=db/r1/c/S0/backup
DIR=/tmp/$NAME; mkdir -p "$OUT"; rm -rf "$DIR"; mkdir -p "$DIR/sock"
RUNID="$NAME-$(date -u +%Y%m%dT%H%M%SZ)-$$"; START=$(date -u +%FT%T.%3NZ); LOG="$OUT/$NAME.log"; FAILS=0
say(){ echo "$*"|tee -a "$LOG"; }; fail(){ say "FAIL: $*"; FAILS=$((FAILS+1)); }
PGBIN=$(dirname "$(command -v initdb)"); unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
ASU=""; if [ "$(id -u)" = 0 ]; then chown -R 1000:1000 "$DIR"; ASU="setpriv --reuid=1000 --regid=1000 --clear-groups"; fi
$ASU initdb -D "$DIR/pg" -U postgres --locale=C -E UTF8 >"$DIR/initdb.log" 2>&1 || exit 1
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" -o "-p $PORT -k $DIR/sock -c listen_addresses=127.0.0.1 -c fsync=off" -w start >/dev/null 2>&1 || exit 1
CL="postgresql://postgres@localhost:$PORT/postgres?sslmode=disable"; psql "$CL" -qX -c 'create database clone'; CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"
say "### FLOW B run_id=$RUNID start=$START"
for f in $(python3 -c "import json;print(' '.join(json.load(open('$BK/MANIFEST.json'))['restore_bundle']['order']))"); do psql "$CL" -qX -f "$BK/restore/$f" >>"$DIR/restore.log" 2>&1; done
psql "$CL" -qX -f db/r1/clone/00_bootstrap.sql >>"$DIR/bootstrap.log" 2>&1
psql "$CL" -qX -c "ALTER TABLE auth.users ALTER COLUMN is_sso_user SET DEFAULT false; ALTER TABLE auth.users ALTER COLUMN is_anonymous SET DEFAULT false" >>"$DIR/bootstrap.log" 2>&1
psql "$CL" -qX -f db/r1/clone/rls_subscription_tests.sql >>"$DIR/bootstrap.log" 2>&1
psql "$CL" -qX -f db/r1/clone/10_load_fixture.sql >>"$DIR/fixture.log" 2>&1
# S1 depends on the already clone-approved R1 base ledger shape; this is fixture
# infrastructure, not one of the three staged production files.
for f in db/r1/001_expand.sql db/r1/002_ledger.sql db/r1/003_canonical.sql db/r1/004_projection.sql; do psql "$CL" -qX -f "$f" >>"$DIR/base.log" 2>&1; done
psql "$CL" -AtqX -f db/r1/c/S0/s1_fingerprint.sql >"$DIR/before.fp"
for f in db/r1/d/001_compat.sql db/r1/p/001_projection.sql db/r1/p/010_manifest_seed.sql; do psql "$CL" -qX -v ON_ERROR_STOP=1 -f "$f" >>"$DIR/s1.log" 2>&1 || fail "apply $f"; done
psql "$CL" -AtqX -f db/r1/c/S0/s1_fingerprint.sql >"$DIR/after.fp"
diff -u "$DIR/before.fp" "$DIR/after.fp" >"$DIR/no_drift.diff" || fail "existing relfilenode/economic data/ACL/old writer contract changed"
psql "$CL" -AtqX -f db/r1/c/S0/s1_verify.sql >"$DIR/s1_verify.out" 2>&1 || fail "S1 verifier"
psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/c/S0/s1_rollback.sql >>"$DIR/rollback.log" 2>&1 || fail "S1 rollback"
psql "$CL" -AtqX -f db/r1/c/S0/s1_fingerprint.sql >"$DIR/rollback.fp"
diff -u "$DIR/before.fp" "$DIR/rollback.fp" >"$DIR/rollback.diff" || fail "rollback not byte-identical"
mkdir -p "$OUT/$NAME-artifacts"; cp "$DIR"/*.log "$DIR"/*.fp "$DIR"/*.diff "$DIR"/*.out "$OUT/$NAME-artifacts/" 2>/dev/null || true
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -m immediate -w stop >/dev/null 2>&1; rm -rf "$DIR"
BG=$(pgrep -f "port=$PORT"|wc -l); [ "$BG" = 0 ] || fail "background=$BG"
END=$(date -u +%FT%T.%3NZ); H=$(sha256sum "$LOG"|cut -d' ' -f1); say "### RESULT run_id=$RUNID start=$START end=$END log_sha256=$H failures=$FAILS destroyed=true background=$BG"; exit "$FAILS"