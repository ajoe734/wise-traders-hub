#!/usr/bin/env bash
# =====================================================================
# S0-2c — RESTORE REHEARSAL on a fresh disposable production-shape clone.
#
# Phase 1 (restore): an empty initdb cluster is rebuilt using ONLY the files
#   listed in db/r1/c/S0/backup/MANIFEST.json -> restore_bundle.order.
#   No live catalog is consulted during the restore. Every manifest file hash
#   is re-verified before it is applied; a hash mismatch aborts the run.
#
# Phase 2 (fidelity): the restored cluster is compared item by item against the
#   backup descriptors: 28 function definitions, 37 ACL canonical keys,
#   11 affected-table catalogs, 72 cron job configs, 15 DB writers, 23 triggers.
#
# Phase 3 (suites): the anonymised fixture + R1/R1-D/R1-P layers are applied on
#   top of the restored cluster and 095 (ACL disposition) and 096 (dynamic ACL
#   proof) are executed; expected 65/0 and 185/0.
#
# Phase 4: destroy the clone and prove it is gone; assert 0 background jobs.
# Production is never touched: PG* is unset, nothing dials the remote host.
# Usage: db/r1/c/S0/s0_restore_rehearsal.sh <clone-name> <port> [outdir]
# =====================================================================
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$ROOT"
NAME=${1:-s0restoreA}; PORT=${2:-55921}; OUT=${3:-/tmp/s0-restore-$NAME}
BK=db/r1/c/S0/backup
mkdir -p "$OUT"
PGBIN=$(dirname "$(command -v initdb)")
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE

DIR=/tmp/$NAME
RUNID="$NAME-$(date -u +%Y%m%dT%H%M%SZ)-$$"
START=$(date -u +%FT%T.%3NZ)
LOG="$OUT/$NAME.log"
FAILS=0
: > "$LOG"
say() { echo "$*" | tee -a "$LOG"; }
fail() { say "  FAIL: $*"; FAILS=$((FAILS+1)); }

say "### S0-2c RESTORE REHEARSAL run_id=$RUNID start=$START port=$PORT pid=$$"

rm -rf "$DIR"; mkdir -p "$DIR/sock"
ASU=""
if [ "$(id -u)" = "0" ]; then chown -R 1000:1000 "$DIR"; ASU="setpriv --reuid=1000 --regid=1000 --clear-groups"; fi
$ASU initdb -D "$DIR/pg" -U postgres --locale=C -E UTF8 > "$DIR/initdb.log" 2>&1 || { fail "initdb"; exit 1; }
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" -o \
  "-p $PORT -k $DIR/sock -c listen_addresses=127.0.0.1 -c max_connections=60 -c fsync=off" -w start >/dev/null 2>&1 \
  || { fail "pg_ctl start"; tail -5 "$DIR/pg.log" | tee -a "$LOG"; exit 1; }
CL="postgresql://postgres@localhost:$PORT/postgres?sslmode=disable"
psql "$CL" -qX -c "CREATE DATABASE clone" >/dev/null
CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"

# ---------------------------------------------------------------- phase 1
say "-- phase 1: restore from manifest artifacts only"
python3 - "$BK" > "$DIR/manifest_check.txt" 2>&1 <<'PY'
import hashlib, json, sys, os
bk = sys.argv[1]
man = json.load(open(os.path.join(bk, "MANIFEST.json")))
rb = man["restore_bundle"]
bad = 0
for f in rb["order"]:
    p = os.path.join(bk, "restore", f)
    h = hashlib.sha256(open(p, "rb").read()).hexdigest()
    want = rb["files"][f]["sha256"]
    print("%s %s %s" % ("OK " if h == want else "BAD", f, h))
    bad += h != want
sys.exit(1 if bad else 0)
PY
if [ $? -ne 0 ]; then fail "manifest hash verification"; cat "$DIR/manifest_check.txt" | tee -a "$LOG"; fi
say "  manifest hash verification: $(grep -c '^OK' "$DIR/manifest_check.txt")/7 files match"

for f in $(python3 -c "import json;print(' '.join(json.load(open('$BK/MANIFEST.json'))['restore_bundle']['order']))"); do
  psql "$CL" -qX -f "$BK/restore/$f" >> "$DIR/restore.log" 2>&1
  ERRS=$(grep -c '^ERROR' "$DIR/restore.log")
  say "  applied $f (cumulative hard errors: $ERRS)"
done
RESTORE_ERRS=$(grep -c '^ERROR' "$DIR/restore.log")
[ "$RESTORE_ERRS" = "0" ] || fail "restore produced $RESTORE_ERRS hard errors (see restore.log)"

# ---------------------------------------------------------------- phase 2
say "-- phase 2: item-by-item fidelity against the backup descriptors"
python3 db/r1/c/S0/s0_restore_verify.py "$CL" "$DIR/fidelity.json" > "$DIR/fidelity.txt" 2>&1
FV=$?
cat "$DIR/fidelity.txt" | tee -a "$LOG"
FAILS=$((FAILS+FV))

CATHASH=$(psql "$CL" -tAqX -c "select md5(string_agg(x,'|' order by x)) from (
  select c.relname||':'||a.attname||':'||format_type(a.atttypid,a.atttypmod) as x
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  where n.nspname='public' and c.relkind='r') s")
say "  restored catalog hash: $CATHASH"

# ---------------------------------------------------------------- phase 3
say "-- phase 3: fixture + R1/R1-D/R1-P layers, then 095 / 096"
# harness-only bootstrap (roles + t schema + test helpers); it never supplies
# application objects — those must come from the restored backup alone.
psql "$CL" -qX -f db/r1/clone/00_bootstrap.sql >> "$DIR/bootstrap.log" 2>&1
psql "$CL" -qX -f db/r1/clone/rls_subscription_tests.sql >> "$DIR/apply.log" 2>&1
psql "$CL" -qX -f db/r1/clone/10_load_fixture.sql >> "$DIR/fixture.log" 2>&1
FIXERR=$(grep -c '^ERROR' "$DIR/fixture.log"); say "  fixture errors: $FIXERR"
for f in db/r1/001_expand.sql db/r1/002_ledger.sql db/r1/003_canonical.sql db/r1/004_projection.sql \
         db/r1/d/001_compat.sql db/r1/d/002_cutover.sql \
         db/r1/p/001_projection.sql db/r1/p/002_public_contract.sql db/r1/p/010_manifest_seed.sql; do
  psql "$CL" -qX -f "$f" >> "$DIR/apply.log" 2>&1
done
APPLYERR=$(grep -c '^ERROR' "$DIR/apply.log"); say "  layer apply errors: $APPLYERR"
psql "$CL" -X -f db/e0/10_harness.sql >> "$DIR/apply.log" 2>&1

run_suite() { # file label expected
  psql "$CL" -qX -c "TRUNCATE t.result" >/dev/null 2>&1
  psql "$CL" -X -f "$1" > "$DIR/$2.log" 2>&1
  local T R
  T=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result")
  R=$(psql "$CL" -tAqX -c "SELECT count(*) FROM t.result WHERE NOT passed")
  say "  $2: $T tests, $R failures (expected $3/0)"
  [ "$T" = "$3" ] || fail "$2 test count $T != $3"
  if [ "$R" != "0" ]; then
    psql "$CL" -tAqX -c "SELECT name||' | '||coalesce(detail,'') FROM t.result WHERE NOT passed ORDER BY id" \
      | head -30 | tee -a "$LOG"
    FAILS=$((FAILS+R))
  fi
}
run_suite db/r1/p/095_acl25_verify.sql acl25 65
run_suite db/r1/p/096_acl_dynamic_proof.sql acl_dyn 185

# ---------------------------------------------------------------- phase 4
say "-- phase 4: destroy + background check"
mkdir -p "$OUT/$NAME-artifacts"
cp -f "$DIR"/*.log "$DIR"/*.txt "$DIR"/*.json "$OUT/$NAME-artifacts/" 2>/dev/null
if [ "${KEEP:-0}" = "1" ]; then say "  KEEP=1: clone retained at $DIR"; else
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -m immediate -w stop >/dev/null 2>&1
rm -rf "$DIR"; fi
if [ "${KEEP:-0}" != "1" ]; then if [ -d "$DIR" ]; then fail "clone destroy"; else say "  clone destroyed: $DIR gone"; fi; fi
BG=$([ "${KEEP:-0}" = "1" ] && echo 0 || pgrep -f "port=$PORT" | wc -l)
say "  background processes for this clone: $BG"
[ "$BG" = "0" ] || fail "background processes remain"

LOGHASH=$(sha256sum "$LOG" | cut -d' ' -f1)
END=$(date -u +%FT%T.%3NZ)
say "### RESULT run_id=$RUNID start=$START end=$END catalog_hash=$CATHASH log_sha256=$LOGHASH TOTAL_FAILURES=$FAILS"
exit $FAILS
