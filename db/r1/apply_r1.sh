#!/usr/bin/env bash
# apply the R1 pipeline to an already-built clone; usage: apply_r1.sh <port>
set -e
export PGHOST=localhost PGPORT=${1:-55601} PGUSER=postgres PGDATABASE=clone PGSSLMODE=disable
unset PGPASSWORD
for f in db/r1/001_expand.sql db/r1/002_ledger.sql db/r1/003_canonical.sql db/r1/004_projection.sql; do
  echo "== $f"; psql -X -v ON_ERROR_STOP=1 -q -f "$f"
done
