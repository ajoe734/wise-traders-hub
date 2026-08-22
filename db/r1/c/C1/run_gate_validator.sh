#!/usr/bin/env bash
# S3B C1 — thin runner for the read-only gate invariant validator.
#
# There is NO formal DR/restore pipeline in this repo (verified: no existing
# restore-verifier entry point exists under db/ or scripts/), so this runner is
# the explicit manual/CI entry point. It creates nothing and mutates nothing.
#
# Usage:
#   db/r1/c/C1/run_gate_validator.sh                 # uses ambient PG* env (production = read-only)
#   db/r1/c/C1/run_gate_validator.sh <database-url>  # clone / CI target
#
# Exit codes:
#   0  -> RESULT=C1_NEEDED or RESULT=C1_ALREADY_CANONICAL
#   !0 -> any other state; the c1v_* error code is printed verbatim
set -uo pipefail
D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET=${1:-}

if [ -n "$TARGET" ]; then
  OUT=$(psql "$TARGET" -X -v ON_ERROR_STOP=1 -f "$D/validate_gate_invariant.sql" 2>&1); RC=$?
else
  OUT=$(psql -X -v ON_ERROR_STOP=1 -f "$D/validate_gate_invariant.sql" 2>&1); RC=$?
fi

echo "$OUT"
if [ $RC -eq 0 ]; then
  RESULT=$(echo "$OUT" | grep -o 'RESULT=C1_[A-Z_]*' | head -1)
  echo "GATE_VALIDATOR ${RESULT:-RESULT=<missing>} exit=$RC"
  [ -n "$RESULT" ] || exit 2
else
  echo "GATE_VALIDATOR REJECTED exit=$RC code=$(echo "$OUT" | grep -o 'c1v_[a-z0-9_]*' | head -1)"
fi
exit $RC
