#!/usr/bin/env bash
# =====================================================================
# R1-D — full validation on TWO fresh disposable production-shape clones.
# Each clone runs from an empty initdb:
#   1. bootstrap + production-extracted schema
#   2. fidelity 104/104 + shape 63/63 gates
#   3. hash BEFORE
#   4. R1 ledger pipeline + R1-D 001_compat + 002_cutover
#   5. 090_verify (all inventory tests, SQLSTATE+needle negatives)
#   6. 091_concurrency (two real psql sessions)
#   7. 099_rollback + function replay -> hash AFTER == hash BEFORE
#   8. destroy the clone
# Production is never touched by this script (no PG* env is inherited).
# Usage: db/r1/d/run_two_fresh_clones.sh [outdir]
# =====================================================================
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT"
OUT=${1:-/tmp/r1d-run-$(date +%H%M%S)}; mkdir -p "$OUT"
PGBIN=$(dirname "$(command -v initdb)")
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
GLOBAL_FAIL=0

run_clone() { # name port
  local NAME=$1 PORT=$2 DIR=/tmp/$1 CL FAILS=0
  rm -rf "$DIR"; mkdir -p "$DIR/sock"
  # the postgres binaries refuse to run as root; own the cluster as uid 1000
  local ASU=""
  if [ "$(id -u)" = "0" ]; then chown -R 1000:1000 "$DIR"; ASU="setpriv --reuid=1000 --regid=1000 --clear-groups"; fi
  echo "### CLONE $NAME port=$PORT" | tee -a "$OUT/$NAME.log"
  $ASU initdb -D "$DIR/pg" -U postgres --locale=C -E UTF8 > "$DIR/initdb.log" 2>&1 \
    || { echo "  initdb FAILED"; tail -3 "$DIR/initdb.log"; return 1; }
  $ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" -o \
    "-p $PORT -k $DIR/sock -c listen_addresses=127.0.0.1 -c max_connections=60 -c fsync=off" \
    -w start >/dev/null 2>&1 \
    || { echo "  pg_ctl start FAILED"; tail -5 "$DIR/pg.log"; return 1; }
  CL="postgresql://postgres@localhost:$PORT/postgres?sslmode=disable"
  psql "$CL" -qX -c "CREATE DATABASE clone" >/dev/null
  CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"

  # 1. schema
  psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/clone/00_bootstrap.sql > "$DIR/bootstrap.log" 2>&1 \
    || { echo "  bootstrap FAILED"; FAILS=$((FAILS+1)); }
  psql "$CL" -qX -f db/r1/clone/schema.sql > "$DIR/schema.log" 2>&1
  local SCHEMA_ERR; SCHEMA_ERR=$(grep -c '^ERROR' "$DIR/schema.log")
  echo "  schema errors: $SCHEMA_ERR" | tee -a "$OUT/$NAME.log"
  psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/clone/10_load_fixture.sql > "$DIR/fixture.log" 2>&1 \
    || { echo "  fixture FAILED"; tail -5 "$DIR/fixture.log"; FAILS=$((FAILS+1)); }

  # 2. gates
  psql "$CL" -tAqXf db/r1/fidelity.sql > "$DIR/fid.txt" 2>&1
  psql "$CL" -tAqXf db/r1/shape_fingerprint.sql > "$DIR/shape.txt" 2>&1
  # gate = exact line-for-line match against the production baselines captured
  # read-only from production (db/r1/clone/baseline/*)
  local FID SHP FIDT SHPT
  FIDT=$(wc -l < db/r1/clone/baseline/fid_prod.txt)
  SHPT=$(wc -l < db/r1/clone/baseline/shape_prod.txt)
  FID=$(comm -12 <(sort "$DIR/fid.txt") <(sort db/r1/clone/baseline/fid_prod.txt) | wc -l)
  SHP=$(comm -12 <(sort "$DIR/shape.txt") <(sort db/r1/clone/baseline/shape_prod.txt) | wc -l)
  echo "  fidelity $FID/$FIDT   shape $SHP/$SHPT" | tee -a "$OUT/$NAME.log"
  if [ "$FID" -lt "$FIDT" ]; then
    echo "  GATE FAIL fidelity"; comm -13 <(sort "$DIR/fid.txt") <(sort db/r1/clone/baseline/fid_prod.txt) | head -20
    FAILS=$((FAILS+1)); fi
  if [ "$SHP" -lt "$SHPT" ]; then
    echo "  GATE FAIL shape"; comm -13 <(sort "$DIR/shape.txt") <(sort db/r1/clone/baseline/shape_prod.txt) | head -20
    FAILS=$((FAILS+1)); fi

  # 3. hash BEFORE (production-shape anonymized fixture baseline)
  psql "$CL" -tAqXf db/r1/d/095_hashes.sql > "$DIR/hash_before.txt" 2>&1

  # 4. R1 + R1-D pipeline
  for f in db/r1/001_expand.sql db/r1/002_ledger.sql db/r1/003_canonical.sql \
           db/r1/004_projection.sql db/r1/d/001_compat.sql db/r1/d/002_cutover.sql; do
    psql "$CL" -qX -v ON_ERROR_STOP=1 -f "$f" >> "$DIR/apply.log" 2>&1 \
      || { echo "  APPLY FAILED: $f"; tail -5 "$DIR/apply.log"; FAILS=$((FAILS+1)); }
  done

  # 5. verify
  psql "$CL" -X -f db/e0/10_harness.sql >> "$DIR/apply.log" 2>&1
  psql "$CL" -X -f db/r1/d/090_verify.sql > "$DIR/verify.log" 2>&1
  local TOT RED
  TOT=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result")
  RED=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result WHERE NOT passed")
  echo "  090_verify: $TOT tests, $RED failures" | tee -a "$OUT/$NAME.log"
  psql "$CL" -tAqX -c "SELECT name||' | '||coalesce(detail,'') FROM t.result WHERE NOT passed ORDER BY id" \
    > "$DIR/verify_failures.txt"
  [ "$RED" = "0" ] || { cat "$DIR/verify_failures.txt" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+RED)); }

  # 6. concurrency
  bash db/r1/d/091_concurrency.sh "$PORT" "$DIR/conc" > "$DIR/conc.log" 2>&1
  local CFAIL=$?
  echo "  091_concurrency failures: $CFAIL" | tee -a "$OUT/$NAME.log"
  grep -E '^(PASS|FAIL|blocked|elapsed)' "$DIR/conc/evidence.txt" >> "$OUT/$NAME.log" 2>/dev/null
  FAILS=$((FAILS+CFAIL))

  # 7. rollback -> hash AFTER (restore legacy bodies from the production snapshot)
  psql "$CL" -qX -f db/r1/d/099_rollback.sql > "$DIR/rollback.log" 2>&1
  psql "$CL" -qX -f db/r1/clone/functions.sql >> "$DIR/rollback.log" 2>&1
  psql "$CL" -tAqXf db/r1/d/095_hashes.sql > "$DIR/hash_after.txt" 2>&1
  if diff -q "$DIR/hash_before.txt" "$DIR/hash_after.txt" >/dev/null; then
    echo "  rollback hash: before == after (IDENTICAL)" | tee -a "$OUT/$NAME.log"
  else
    echo "  rollback hash MISMATCH:" | tee -a "$OUT/$NAME.log"
    diff "$DIR/hash_before.txt" "$DIR/hash_after.txt" | tee -a "$OUT/$NAME.log"
    FAILS=$((FAILS+1))
  fi

  # 8. destroy
  $ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -m immediate -w stop >/dev/null 2>&1
  cp -r "$DIR"/*.txt "$DIR"/*.log "$OUT/$NAME-artifacts-"/ 2>/dev/null || \
    { mkdir -p "$OUT/$NAME-artifacts"; cp -r "$DIR"/*.txt "$DIR"/*.log "$DIR/conc" "$OUT/$NAME-artifacts/" 2>/dev/null; }
  rm -rf "$DIR"
  if [ -d "$DIR" ]; then echo "  DESTROY FAILED"; FAILS=$((FAILS+1)); else echo "  clone destroyed: $DIR gone" | tee -a "$OUT/$NAME.log"; fi
  echo "  CLONE $NAME TOTAL FAILURES=$FAILS" | tee -a "$OUT/$NAME.log"
  return $FAILS
}

run_clone r1dA 55901; A=$?
run_clone r1dB 55902; B=$?
GLOBAL_FAIL=$((A+B))
echo "=== R1-D TWO-CLONE RESULT: cloneA_failures=$A cloneB_failures=$B ===" | tee -a "$OUT/summary.txt"
[ $GLOBAL_FAIL -eq 0 ] && echo "R1-D: ALL GREEN" | tee -a "$OUT/summary.txt" \
  || echo "R1-D: NO-GO ($GLOBAL_FAIL failures)" | tee -a "$OUT/summary.txt"
exit $GLOBAL_FAIL
