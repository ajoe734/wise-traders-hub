#!/usr/bin/env bash
# Bring up a disposable production-shape clone and leave it running (iteration aid).
# Usage: db/r1/c/SB/sb_clone_up.sh <dir> <port>
set -Eeuo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$ROOT"
DIR=${1:-/tmp/sbscratch}; PORT=${2:-55890}; BK=db/r1/c/S0/backup
if [ -s db/r1/c/H/pgbin.path ]; then PGBIN=$(cat db/r1/c/H/pgbin.path); else PGBIN=$(dirname "$(command -v initdb)"); fi
export PATH="$PGBIN:$PATH"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
pkill -f "port=$PORT" 2>/dev/null || true
for i in $(seq 1 20); do pgrep -f "port=$PORT" >/dev/null || break; sleep 0.5; done
rm -rf "$DIR"; mkdir -p "$DIR/sock"
ASU=""; if [ "$(id -u)" = 0 ]; then chown -R 1000:1000 "$DIR"; ASU="setpriv --reuid=1000 --regid=1000 --clear-groups"; fi
$ASU "$PGBIN/initdb" -D "$DIR/pg" -U postgres --locale=C -E UTF8 >"$DIR/initdb.log" 2>&1
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" \
  -o "-p $PORT -k $DIR/sock -c listen_addresses=127.0.0.1 -c fsync=off" -w -t 60 start >"$DIR/pgctl.log" 2>&1
psql "postgresql://postgres@localhost:$PORT/postgres?sslmode=disable" -qX -c 'create database clone' >/dev/null
CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"
for f in $(python3 -c "import json;print(' '.join(json.load(open('$BK/MANIFEST.json'))['restore_bundle']['order']))"); do
  psql "$CL" -qX -f "$BK/restore/$f" >>"$DIR/restore.log" 2>&1 || true
done
grep -cE '^psql:.*(ERROR|FATAL)' "$DIR/restore.log" || true
echo "CLONE=$CL"
