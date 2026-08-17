#!/usr/bin/env bash
# =====================================================================
# R1-P — validation on TWO fresh disposable production-shape clones.
# Per clone, from an empty initdb:
#   1. bootstrap + production-extracted schema + anonymised fixture
#   2. fidelity + shape gates against the production baselines
#   3. hash BEFORE + pristine dump
#   4. R1 (001-004) + R1-D (001,002)  -> R1-D 090_verify must stay green
#   5. R1-P (001,002,010)             -> R1-P 090_verify_p must be green
#   5c. 092_embargo (frozen anchor T+7 lattice, all channels)
#   6. 091_swap_race (concurrent reader during pointer swaps)
#   7. failure injection: aborted build must not move the pointer
#   8. 099_rollback_p + 099_rollback + restore -> hash AFTER == hash BEFORE
#   9. destroy the clone
# Production is never touched (no PG* env inherited, no remote connection).
# Usage: db/r1/p/run_two_fresh_clones_p.sh [outdir]
# =====================================================================
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT"
OUT=${1:-/tmp/r1p-run-$(date +%H%M%S)}; mkdir -p "$OUT"
PGBIN=$(dirname "$(command -v initdb)")
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE

run_clone() { # name port
  local NAME=$1 PORT=$2 DIR=/tmp/$1 CL FAILS=0
  rm -rf "$DIR"; mkdir -p "$DIR/sock"
  local ASU=""
  if [ "$(id -u)" = "0" ]; then chown -R 1000:1000 "$DIR"; ASU="setpriv --reuid=1000 --regid=1000 --clear-groups"; fi
  local RUNID START
  RUNID="${NAME}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  START=$(date -u +%FT%T.%3NZ)
  echo "### CLONE $NAME port=$PORT run_id=$RUNID start=$START pid=$$" | tee -a "$OUT/$NAME.log"
  $ASU initdb -D "$DIR/pg" -U postgres --locale=C -E UTF8 > "$DIR/initdb.log" 2>&1 \
    || { echo "  initdb FAILED" | tee -a "$OUT/$NAME.log"; return 1; }
  $ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" -o \
    "-p $PORT -k $DIR/sock -c listen_addresses=127.0.0.1 -c max_connections=60 -c fsync=off" \
    -w start >/dev/null 2>&1 \
    || { echo "  pg_ctl start FAILED" | tee -a "$OUT/$NAME.log"; tail -5 "$DIR/pg.log"; return 1; }
  CL="postgresql://postgres@localhost:$PORT/postgres?sslmode=disable"
  psql "$CL" -qX -c "CREATE DATABASE clone" >/dev/null
  CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"

  # 1. schema + fixture
  psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/clone/00_bootstrap.sql > "$DIR/bootstrap.log" 2>&1 \
    || { echo "  bootstrap FAILED" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+1)); }
  psql "$CL" -qX -f db/r1/clone/schema.sql > "$DIR/schema.log" 2>&1
  echo "  schema errors: $(grep -c '^ERROR' "$DIR/schema.log")" | tee -a "$OUT/$NAME.log"
  psql "$CL" -qX -f db/r1/clone/tables_acl28.sql > "$DIR/tables28.log" 2>&1
  echo "  tables_acl28 errors: $(grep -c '^ERROR' "$DIR/tables28.log")" | tee -a "$OUT/$NAME.log"
  psql "$CL" -qX -f db/r1/clone/functions_acl28.sql > "$DIR/fn28.log" 2>&1
  echo "  functions_acl28 errors: $(grep -c '^ERROR' "$DIR/fn28.log")" | tee -a "$OUT/$NAME.log"
  psql "$CL" -qX -f db/r1/clone/rls_subscription_tests.sql > "$DIR/rlsfn.log" 2>&1
  psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/clone/10_load_fixture.sql > "$DIR/fixture.log" 2>&1 \
    || { echo "  fixture FAILED" | tee -a "$OUT/$NAME.log"; tail -5 "$DIR/fixture.log"; FAILS=$((FAILS+1)); }

  # 2. gates
  psql "$CL" -tAqXf db/r1/fidelity.sql > "$DIR/fid.txt" 2>&1
  psql "$CL" -tAqXf db/r1/shape_fingerprint.sql > "$DIR/shape.txt" 2>&1
  local FID SHP FIDT SHPT
  FIDT=$(wc -l < db/r1/clone/baseline/fid_prod.txt); SHPT=$(wc -l < db/r1/clone/baseline/shape_prod.txt)
  FID=$(comm -12 <(sort "$DIR/fid.txt") <(sort db/r1/clone/baseline/fid_prod.txt) | wc -l)
  SHP=$(comm -12 <(sort "$DIR/shape.txt") <(sort db/r1/clone/baseline/shape_prod.txt) | wc -l)
  echo "  fidelity $FID/$FIDT   shape $SHP/$SHPT" | tee -a "$OUT/$NAME.log"
  [ "$FID" -lt "$FIDT" ] && { echo "  GATE FAIL fidelity" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+1)); }
  [ "$SHP" -lt "$SHPT" ] && { echo "  GATE FAIL shape" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+1)); }

  # 3. hash BEFORE + pristine dump
  psql "$CL" -tAqXf db/r1/d/095_hashes.sql > "$DIR/hash_before.txt" 2>&1
  pg_dump "$CL" --format=custom --file="$DIR/before.dump" > "$DIR/dump.log" 2>&1 \
    || { echo "  before dump FAILED" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+1)); }

  # 4. R1 + R1-D, then R1-P
  for f in db/r1/001_expand.sql db/r1/002_ledger.sql db/r1/003_canonical.sql \
           db/r1/004_projection.sql db/r1/d/001_compat.sql db/r1/d/002_cutover.sql \
           db/r1/p/001_projection.sql db/r1/p/002_public_contract.sql db/r1/p/010_manifest_seed.sql; do
    psql "$CL" -qX -v ON_ERROR_STOP=1 -f "$f" >> "$DIR/apply.log" 2>&1 \
      || { echo "  APPLY FAILED: $f" | tee -a "$OUT/$NAME.log"; tail -5 "$DIR/apply.log" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+1)); }
  done

  # 5a. R1-D suite must remain green under R1-P
  psql "$CL" -X -f db/e0/10_harness.sql >> "$DIR/apply.log" 2>&1
  psql "$CL" -X -f db/r1/d/090_verify.sql > "$DIR/verify_d.log" 2>&1
  local DTOT DRED
  DTOT=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result")
  DRED=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result WHERE NOT passed")
  echo "  R1-D 090_verify (regression): $DTOT tests, $DRED failures" | tee -a "$OUT/$NAME.log"
  [ "$DRED" = "0" ] || { psql "$CL" -tAqX -c "SELECT name||' | '||coalesce(detail,'') FROM t.result WHERE NOT passed ORDER BY id" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+DRED)); }

  # 5b. R1-P suite
  psql "$CL" -X -f db/r1/p/090_verify_p.sql > "$DIR/verify_p.log" 2>&1
  local PTOT PRED
  PTOT=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result")
  PRED=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result WHERE NOT passed")
  echo "  R1-P 090_verify_p: $PTOT tests, $PRED failures" | tee -a "$OUT/$NAME.log"
  psql "$CL" -tAqX -c "SELECT name||' | '||coalesce(detail,'') FROM t.result WHERE NOT passed ORDER BY id" \
    > "$DIR/verify_p_failures.txt"
  [ "$PRED" = "0" ] || { cat "$DIR/verify_p_failures.txt" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+PRED)); }

  # 5b-2. per-signature ACL disposition verifier (acl-25.json, 31 tests)
  psql "$CL" -qX -c "TRUNCATE t.result" >/dev/null 2>&1
  psql "$CL" -X -f db/r1/p/095_acl25_verify.sql > "$DIR/acl25.log" 2>&1
  local ATOT ARED
  ATOT=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result")
  ARED=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result WHERE NOT passed")
  echo "  R1-P 095_acl25_verify: $ATOT tests, $ARED failures" | tee -a "$OUT/$NAME.log"
  [ "$ARED" = "0" ] || { psql "$CL" -tAqX -c "SELECT name||' | '||coalesce(detail,'') FROM t.result WHERE NOT passed ORDER BY id" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+ARED)); }


  # 5b-3. dynamic ACL proof: real EXECUTE by ordinary authenticated vs company_admin
  psql "$CL" -qX -c "TRUNCATE t.result" >/dev/null 2>&1
  psql "$CL" -X -f db/r1/p/096_acl_dynamic_proof.sql > "$DIR/acl_dyn.log" 2>&1
  local YTOT YRED
  YTOT=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result")
  YRED=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result WHERE NOT passed")
  echo "  R1-P 096_acl_dynamic_proof: $YTOT tests, $YRED failures" | tee -a "$OUT/$NAME.log"
  [ "$YRED" = "0" ] || { psql "$CL" -tAqX -c "SELECT name||' | '||coalesce(detail,'') FROM t.result WHERE NOT passed ORDER BY id" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+YRED)); }

  # 5c. frozen-anchor T+7 embargo closure (fixed entry point)
  bash db/r1/p/092_embargo.sh "$CL" "$DIR/embargo.log" > "$DIR/embargo_out.txt" 2>&1
  local EFAIL=$?
  cat "$DIR/embargo_out.txt" | tee -a "$OUT/$NAME.log"
  FAILS=$((FAILS+EFAIL))

  # 5d. RLS harness (>=15 non-superuser cases) + role matrix (anon/authenticated/service_role)
  local RTOT RRED MTOT MRED
  psql "$CL" -qX -c "TRUNCATE t.result" >/dev/null 2>&1
  psql "$CL" -X -f db/r1/clone/rls_subscription_tests.sql > "$DIR/rls.log" 2>&1
  RTOT=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result")
  RRED=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result WHERE NOT passed")
  echo "  RLS subscription harness: $RTOT tests, $RRED failures (min 15)" | tee -a "$OUT/$NAME.log"
  [ "$RTOT" -ge 15 ] || { echo "  RLS HARNESS UNDERRUN" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+1)); }
  [ "$RRED" = "0" ] || { psql "$CL" -tAqX -c "SELECT name||' | '||coalesce(detail,'') FROM t.result WHERE NOT passed ORDER BY id" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+RRED)); }

  psql "$CL" -qX -c "TRUNCATE t.result" >/dev/null 2>&1
  psql "$CL" -X -f db/r1/p/094_rls_role_matrix.sql > "$DIR/matrix.log" 2>&1
  MTOT=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result")
  MRED=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result WHERE NOT passed")
  echo "  094 role matrix: $MTOT probes, $MRED failures" | tee -a "$OUT/$NAME.log"
  [ "$MTOT" -ge 19 ] || { echo "  ROLE MATRIX UNDERRUN" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+1)); }
  [ "$MRED" = "0" ] || { psql "$CL" -tAqX -c "SELECT name||' | '||coalesce(detail,'') FROM t.result WHERE NOT passed ORDER BY id" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+MRED)); }

  # 6. swap race
  bash db/r1/p/091_swap_race.sh "$PORT" "$DIR/race" > "$DIR/race.log" 2>&1
  local RFAIL=$?
  echo "  091_swap_race violations: $RFAIL" | tee -a "$OUT/$NAME.log"
  FAILS=$((FAILS+RFAIL))

  # 7. failure injection outside the suite (pointer must not move)
  local V0 V1
  V0=$(psql "$CL" -tAqX -c "SELECT active_version FROM public.public_projection_active WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP')")
  psql "$CL" -qX -c "SELECT app_ledger.canonical_publish((SELECT v FROM tp.ids WHERE k='expP'),NULL,'as_reported',true)" >/dev/null 2>&1
  V1=$(psql "$CL" -tAqX -c "SELECT active_version FROM public.public_projection_active WHERE expert_id=(SELECT v FROM tp.ids WHERE k='expP')")
  if [ "$V0" = "$V1" ]; then echo "  failure injection: pointer held at $V0 (PASS)" | tee -a "$OUT/$NAME.log";
  else echo "  failure injection: pointer moved $V0 -> $V1 (FAIL)" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+1)); fi

  # 8. rollback + exact restore identity
  psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/p/099_rollback_p.sql > "$DIR/rollback_p.log" 2>&1 \
    || { echo "  R1-P rollback SQL failed" | tee -a "$OUT/$NAME.log"; tail -5 "$DIR/rollback_p.log" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+1)); }
  psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/d/099_rollback.sql >> "$DIR/rollback_p.log" 2>&1 \
    || { echo "  R1-D rollback SQL failed" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+1)); }
  psql "$CL" -qX -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >> "$DIR/rollback_p.log" 2>&1
  pg_restore --clean --if-exists --no-owner --dbname="$CL" "$DIR/before.dump" >> "$DIR/rollback_p.log" 2>&1
  psql "$CL" -tAqXf db/r1/d/095_hashes.sql > "$DIR/hash_after.txt" 2>&1
  if diff -q "$DIR/hash_before.txt" "$DIR/hash_after.txt" >/dev/null; then
    echo "  rollback hash: before == after (IDENTICAL)" | tee -a "$OUT/$NAME.log"
  else
    echo "  rollback hash MISMATCH:" | tee -a "$OUT/$NAME.log"
    diff "$DIR/hash_before.txt" "$DIR/hash_after.txt" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+1))
  fi

  # 9. destroy
  mkdir -p "$OUT/$NAME-artifacts"
  cp -r "$DIR"/*.txt "$DIR"/*.log "$DIR/race" "$OUT/$NAME-artifacts/" 2>/dev/null
  $ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -m immediate -w stop >/dev/null 2>&1
  rm -rf "$DIR"
  [ -d "$DIR" ] && { echo "  DESTROY FAILED" | tee -a "$OUT/$NAME.log"; FAILS=$((FAILS+1)); } \
                || echo "  clone destroyed: $DIR gone" | tee -a "$OUT/$NAME.log"
  echo "  CLONE $NAME run_id=$RUNID start=$START end=$(date -u +%FT%T.%3NZ) exit=$FAILS" \
    | tee -a "$OUT/$NAME.log"
  echo "  CLONE $NAME TOTAL FAILURES=$FAILS" | tee -a "$OUT/$NAME.log"
  return $FAILS
}

run_clone r1pA 55911; A=$?
run_clone r1pB 55912; B=$?
TOTAL=$((A+B))
echo "=== R1-P TWO-CLONE RESULT: cloneA_failures=$A cloneB_failures=$B ===" | tee -a "$OUT/summary.txt"
[ $TOTAL -eq 0 ] && echo "R1-P: ALL GREEN" | tee -a "$OUT/summary.txt" \
                 || echo "R1-P: NO-GO ($TOTAL failures)" | tee -a "$OUT/summary.txt"
exit $TOTAL
