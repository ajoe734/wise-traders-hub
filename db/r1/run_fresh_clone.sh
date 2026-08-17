#!/usr/bin/env bash
# R1: build a fresh disposable production-shape clone and run the R1 pipeline.
# Usage: db/r1/run_fresh_clone.sh <name> <port> [stage]
#   stage: fidelity | pipeline (default) | expandonly
set -euo pipefail
NAME=${1:-r1a}; PORT=${2:-55601}; STAGE=${3:-pipeline}
ROOT=/tmp/$NAME; PGDATA=$ROOT/pg; SOCK=$ROOT/sock; FIX=/tmp/r1fixture
CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"
export PGDATABASE_ORIG=${PGDATABASE:-postgres}

echo "== [0] reset $ROOT (port $PORT) =="
pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
pkill -f "postgres.*-p $PORT" >/dev/null 2>&1 || true
sleep 1
rm -rf "$ROOT"; mkdir -p "$PGDATA" "$SOCK"

echo "== [1] initdb =="
chown -R lovable "$ROOT"
AS_PG="setpriv --reuid=1000 --regid=1000 --clear-groups /bin/bash -c"
$AS_PG "env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE initdb -D $PGDATA -U postgres --auth=trust" >"$ROOT/initdb.log" 2>&1
$AS_PG "env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE pg_ctl -D $PGDATA -o '-p $PORT -k $SOCK -c listen_addresses=localhost -c fsync=off' -l $ROOT/pg.log -w start" >/dev/null
psql "$CL" -c 'select 1' >/dev/null 2>&1 || psql "postgresql://postgres@localhost:$PORT/postgres?sslmode=disable" -c 'CREATE DATABASE clone' >/dev/null

echo "== [2] bootstrap + production-extracted schema + anonymized fixture =="
psql "$CL" -v ON_ERROR_STOP=1 -qf db/r1/clone/00_bootstrap.sql >/dev/null
psql "$CL" -v ON_ERROR_STOP=1 -qf db/r1/clone/schema.sql >"$ROOT/schema.log" 2>&1 || { tail -5 "$ROOT/schema.log"; exit 1; }
psql "$CL" -v ON_ERROR_STOP=1 -qf db/r1/clone/10_load_fixture.sql >"$ROOT/fixture.log" 2>&1

echo "== [3] fidelity gates (catalog 104 + shape 39) =="
psql            -tAqXf db/r1/fidelity.sql | sort > "$ROOT/fid_prod.txt"
psql "$CL"      -tAqXf db/r1/fidelity.sql | sort > "$ROOT/fid_clone.txt"
psql            -tAqXf db/r1/shape_fingerprint.sql | grep '|' | sort > "$ROOT/shape_prod.txt"
psql "$CL"      -tAqXf db/r1/shape_fingerprint.sql | grep '|' | sort > "$ROOT/shape_clone.txt"
CATN=$(wc -l < "$ROOT/fid_prod.txt"); SHN=$(wc -l < "$ROOT/shape_prod.txt")
diff -q "$ROOT/fid_prod.txt" "$ROOT/fid_clone.txt" >/dev/null && echo "CATALOG_FIDELITY=$CATN/$CATN PASS" || { echo "CATALOG_FIDELITY=FAIL"; diff "$ROOT/fid_prod.txt" "$ROOT/fid_clone.txt" | head; exit 1; }
diff -q "$ROOT/shape_prod.txt" "$ROOT/shape_clone.txt" >/dev/null && echo "SHAPE_FIDELITY=$SHN/$SHN PASS" || { echo "SHAPE_FIDELITY=FAIL"; diff "$ROOT/shape_prod.txt" "$ROOT/shape_clone.txt" | head; exit 1; }
[ "$STAGE" = fidelity ] && { echo "stage=fidelity done ($CL)"; exit 0; }

echo "== [4] before-hashes =="
psql "$CL" -tAqXf db/r1/095_hashes.sql | sort > "$ROOT/hash_before.txt"; wc -l < "$ROOT/hash_before.txt"

echo "== [5] migrations =="
for f in 001_expand 002_writer_compat 003_atomic_cutover 004_public_projection; do
  /usr/bin/time -f "   $f %es" psql "$CL" -v ON_ERROR_STOP=1 -qf "db/r1/$f.sql" 2>&1 | grep -vE '^$' || { echo "MIGRATION_FAIL=$f"; exit 1; }
done
[ "$STAGE" = expandonly ] && { echo "stage=expandonly done ($CL)"; exit 0; }

echo "== [6] tests =="
psql "$CL" -v ON_ERROR_STOP=1 -qf db/r1/tests/00_harness.sql >/dev/null
for f in db/r1/tests/[1-9]*.sql; do psql "$CL" -qf "$f" > "$ROOT/$(basename $f).out" 2>&1; done
psql "$CL" -qf db/r1/090_verify.sql | tee "$ROOT/verify.txt" | tail -40
echo "clone=$CL root=$ROOT"
