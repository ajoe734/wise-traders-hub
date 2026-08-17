#!/usr/bin/env bash
# Developer-only helper: build ONE clone and leave it running so individual
# R1-P steps can be re-run by hand. Never used by the acceptance entry point.
# usage: _debug_clone.sh <port> [--keep]
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd); cd "$ROOT"
PORT=${1:-55999}; DIR=/tmp/r1pdbg$PORT
PGBIN=$(dirname "$(command -v initdb)")
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
rm -rf "$DIR"; mkdir -p "$DIR/sock"
ASU=""
if [ "$(id -u)" = "0" ]; then chown -R 1000:1000 "$DIR"; ASU="setpriv --reuid=1000 --regid=1000 --clear-groups"; fi
$ASU initdb -D "$DIR/pg" -U postgres --locale=C -E UTF8 > "$DIR/initdb.log" 2>&1 || { tail -5 "$DIR/initdb.log"; exit 1; }
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" -o \
  "-p $PORT -k $DIR/sock -c listen_addresses=127.0.0.1 -c max_connections=60 -c fsync=off" -w start >/dev/null 2>&1 \
  || { tail -5 "$DIR/pg.log"; exit 1; }
CL0="postgresql://postgres@localhost:$PORT/postgres?sslmode=disable"
psql "$CL0" -qX -c "CREATE DATABASE clone" >/dev/null
CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"
psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/clone/00_bootstrap.sql > "$DIR/bootstrap.log" 2>&1 || { echo BOOTSTRAP; tail -5 "$DIR/bootstrap.log"; }
psql "$CL" -qX -f db/r1/clone/schema.sql > "$DIR/schema.log" 2>&1
echo "schema errors: $(grep -c '^ERROR' "$DIR/schema.log")"
psql "$CL" -qX -f db/r1/clone/tables_acl28.sql > "$DIR/tables28.log" 2>&1
psql "$CL" -qX -f db/r1/clone/functions_acl28.sql > "$DIR/fn28.log" 2>&1
echo "functions_acl28 errors: $(grep -c '^ERROR' "$DIR/fn28.log")"
psql "$CL" -qX -f db/r1/clone/rls_subscription_tests.sql > "$DIR/rlsfn.log" 2>&1
psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/clone/10_load_fixture.sql > "$DIR/fixture.log" 2>&1 || { echo FIXTURE; tail -5 "$DIR/fixture.log"; }
for f in db/r1/001_expand.sql db/r1/002_ledger.sql db/r1/003_canonical.sql db/r1/004_projection.sql \
         db/r1/d/001_compat.sql db/r1/d/002_cutover.sql db/r1/p/001_projection.sql \
         db/r1/p/002_public_contract.sql db/r1/p/010_manifest_seed.sql; do
  psql "$CL" -qX -v ON_ERROR_STOP=1 -f "$f" >> "$DIR/apply.log" 2>&1 || { echo "APPLY FAILED $f"; tail -4 "$DIR/apply.log"; }
done
psql "$CL" -X -f db/e0/10_harness.sql >> "$DIR/apply.log" 2>&1
echo "CLONE READY: $CL   (dir $DIR)"
