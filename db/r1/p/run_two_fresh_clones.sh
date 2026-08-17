#!/usr/bin/env bash
# =====================================================================
# R1-P FIXED ENTRY POINT — runs the complete R1-P acceptance:
#   A. consumer-matrix scanner (CI gate: metadata + coverage + fallbacks)
#   B. UI contract: typecheck + unit/component tests for the review state
#   C. two fresh disposable production-shape clones
#      (schema fidelity, R1-D 090, R1-P 090, 092 embargo, swap race,
#       failure injection, rollback hash, destroy)
# Production is never contacted: PG* is unset before anything runs.
# Usage: db/r1/p/run_two_fresh_clones.sh [outdir]
# =====================================================================
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd); cd "$ROOT"
OUT=${1:-/tmp/r1p-full-$(date +%H%M%S)}; mkdir -p "$OUT"
# capture the production read-only connection BEFORE unsetting: step C uses it
# for a SELECT-only ACL baseline; every other step runs with PG* unset.
P_HOST=${PGHOST:-}; P_PORT=${PGPORT:-}; P_USER=${PGUSER:-}
P_PASS=${PGPASSWORD:-}; P_DB=${PGDATABASE:-}
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
FAILS=0

echo "=== A. consumer matrix scanner ===" | tee -a "$OUT/summary.txt"
python3 db/r1/p/consumer_scanner.py --check 2>&1 | tee -a "$OUT/scanner.log" | tail -30
[ "${PIPESTATUS[0]}" = "0" ] || { echo "SCANNER FAILED" | tee -a "$OUT/summary.txt"; FAILS=$((FAILS+1)); }

echo "=== B. UI contract (typecheck + tests) ===" | tee -a "$OUT/summary.txt"
npx tsgo --noEmit -p tsconfig.app.json > "$OUT/typecheck.log" 2>&1 \
  || { echo "TYPECHECK FAILED" | tee -a "$OUT/summary.txt"; tail -20 "$OUT/typecheck.log"; FAILS=$((FAILS+1)); }
npx vitest run src/contracts src/components/expert > "$OUT/vitest.log" 2>&1 \
  || { echo "UI TESTS FAILED" | tee -a "$OUT/summary.txt"; tail -30 "$OUT/vitest.log"; FAILS=$((FAILS+1)); }
grep -E "Tests +[0-9]+ passed" "$OUT/vitest.log" | tee -a "$OUT/summary.txt"

echo "=== C. production read-only ACL baseline (0 touch) ===" | tee -a "$OUT/summary.txt"
( export PGHOST="$P_HOST" PGPORT="$P_PORT" PGUSER="$P_USER" PGPASSWORD="$P_PASS" \
         PGDATABASE="$P_DB"; db/r1/p/093_prod_acl_baseline.sh "$OUT" ) 2>&1 \
  | tee -a "$OUT/prod_acl.log"
[ "${PIPESTATUS[0]}" = "0" ] || { echo "PROD ACL BASELINE FAILED" | tee -a "$OUT/summary.txt"; FAILS=$((FAILS+1)); }

echo "=== C2. acl-25 disposition artifact (frozen, 25+3) ===" | tee -a "$OUT/summary.txt"
python3 db/r1/p/build_acl25.py --check 2>&1 | tee -a "$OUT/acl25.log"
[ "${PIPESTATUS[0]}" = "0" ] || { echo "ACL-25 ARTIFACT FAILED" | tee -a "$OUT/summary.txt"; FAILS=$((FAILS+1)); }


echo "=== D. two fresh disposable clones ===" | tee -a "$OUT/summary.txt"
bash db/r1/p/run_two_fresh_clones_p.sh "$OUT/clones" 2>&1 | tee -a "$OUT/clones.log" | tail -40
CF=${PIPESTATUS[0]}; FAILS=$((FAILS+CF))

echo "=== R1-P TOTAL FAILURES=$FAILS ===" | tee -a "$OUT/summary.txt"
[ "$FAILS" -eq 0 ] && echo "R1-P: ALL GREEN" | tee -a "$OUT/summary.txt" \
                   || echo "R1-P: NO-GO" | tee -a "$OUT/summary.txt"
exit "$FAILS"
