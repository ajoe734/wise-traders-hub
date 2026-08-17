#!/usr/bin/env bash
# =====================================================================
# R1-P 093 — PRODUCTION READ-ONLY ACL BASELINE (pre-cutover)
#
# Reads production with the restricted read-only role (SELECT only, no DDL,
# no DML, no function execution) and pins the pre-cutover ACL violations so
# that the clone migration can be proven against a fixed, signed baseline.
#
#   pre_cutover_expected_violation  named_pre_cutover  = 3   (hard gate)
#   pre_cutover_expected_violation  pattern family     = 25  (hard gate)
#   signature hash                                     = pinned sha256
#
# Fails when production shows MORE or FEWER violations than the pinned
# baseline, and when the signature set drifts (hash mismatch).
# Production is only read; nothing is granted, revoked or executed.
#
# Usage: db/r1/p/093_prod_acl_baseline.sh [outdir]
# =====================================================================
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd); cd "$ROOT"
OUT=${1:-db/r1/p/evidence}; mkdir -p "$OUT"

EXPECT_NAMED=3
EXPECT_PATTERN=25
PINNED_HASH_FILE=db/r1/p/evidence/prod_acl_baseline.sha256

if [ -z "${PGHOST:-}" ]; then
  echo "093: no production PG* env — cannot take the read-only baseline"; exit 1
fi

RAW="$OUT/prod_acl_watchset.txt"
psql -tAXf db/r1/p/acl_watchset.sql | sed '/^$/d' | sort > "$RAW" || exit 1

NAMED=$(grep -c '|named_pre_cutover$'  "$RAW" || true)
PATT=$(grep -c '|pattern_admin_build_publish$' "$RAW" || true)
HASH=$(sha256sum "$RAW" | cut -d' ' -f1)
FAILS=0

echo "093 production ACL baseline (read-only)"
echo "  named_pre_cutover   = $NAMED (expected $EXPECT_NAMED)"
echo "  pattern family      = $PATT (expected $EXPECT_PATTERN)"
echo "  signature sha256    = $HASH"

[ "$NAMED" = "$EXPECT_NAMED" ] || { echo "  FAIL named count drift"; FAILS=$((FAILS+1)); }
[ "$PATT"  = "$EXPECT_PATTERN" ] || { echo "  FAIL pattern count drift"; FAILS=$((FAILS+1)); }

if [ -f "$PINNED_HASH_FILE" ]; then
  PIN=$(cat "$PINNED_HASH_FILE")
  if [ "$PIN" != "$HASH" ]; then
    echo "  FAIL signature hash drift: pinned=$PIN live=$HASH"; FAILS=$((FAILS+1))
  else
    echo "  signature hash matches pinned baseline"
  fi
else
  echo "$HASH" > "$PINNED_HASH_FILE"
  echo "  pinned signature hash written (first run)"
fi

# machine-readable evidence
python3 - "$RAW" "$NAMED" "$PATT" "$HASH" "$OUT/prod_acl_baseline.json" <<'PY'
import json, sys, datetime
raw, named, patt, h, out = sys.argv[1:6]
rows = [l.rstrip('\n').split('|') for l in open(raw) if l.strip()]
doc = {
  "artifact": "prod_acl_baseline",
  "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "mode": "production_read_only",
  "production_touch": {"ddl": 0, "dml": 0, "execute": 0, "deploy": 0, "publish": 0},
  "pre_cutover_expected_violation": int(named),
  "pre_cutover_expected_violation_pattern_family": int(patt),
  "signature_sha256": h,
  "named_pre_cutover": [s for s, c in rows if c == "named_pre_cutover"],
  "pattern_admin_build_publish": [s for s, c in rows if c != "named_pre_cutover"],
  "post_migration_expectation": {
    "clone_after_002_public_contract": {"named_pre_cutover": 0,
                                        "pattern_admin_build_publish": 0},
    "test_ids": ["T-P98a", "T-P98b", "T-P98c"]
  }
}
json.dump(doc, open(out, "w"), indent=2, ensure_ascii=False)
print("  wrote", out)
PY

echo "093 FAILURES=$FAILS"
exit "$FAILS"
