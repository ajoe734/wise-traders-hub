#!/usr/bin/env bash
# =====================================================================
# PV-E2E rehearsal — real browser + real GoTrue + real PostgREST on a
# disposable clone. Production is never contacted (PG* unset up front).
# Usage: db/r1/c/PV/pve_rehearsal.sh <name> <basePort> [outdir]
#   ports used: base (pg), base+1 (gotrue), base+2 (postgrest),
#               base+3 (gateway), base+4 (app preview)
# =====================================================================
set -Eeuo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$ROOT"
NAME=${1:-PVE1}; BASE=${2:-55950}; OUT=${3:-/tmp/pve-$NAME}
DIR=/tmp/pve$NAME
PGPORT_=$BASE; AUTHPORT=$((BASE+1)); RESTPORT=$((BASE+2)); GWPORT=$((BASE+3)); APPPORT=$((BASE+4))
RUNID="$NAME-$(date -u +%Y%m%dT%H%M%SZ)-$$"
START=$(date -u +%FT%T.%3NZ)
mkdir -p "$OUT"; LOG="$OUT/$NAME.log"; : >"$LOG"
exec > >(tee -a "$LOG") 2>&1

FAILS=0; CHECKS=0; SUMMARY=0; STAGE=init
chk(){ CHECKS=$((CHECKS+1)); if [ "$1" = 0 ]; then echo "  PASS $2"; else FAILS=$((FAILS+1)); echo "  FAIL $2 ${3:-}"; fi; }
fatal(){ FAILS=$((FAILS+1)); echo "!! FATAL stage=$STAGE: $*"; exit 1; }
stage(){ STAGE=$1; echo "== stage $1 $(date -u +%FT%T.%3NZ)"; }
on_err(){ local c=$?; echo "!! ERR stage=$STAGE line=${BASH_LINENO[0]} cmd=[$BASH_COMMAND] exit=$c"; FAILS=$((FAILS+1)); }
cleanup(){
  local c=$?; trap - EXIT ERR; set +e
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -9 "$p" >/dev/null 2>&1; done
  [ -d "$DIR/pg" ] && $ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -m immediate -w stop >/dev/null 2>&1
  mkdir -p "$OUT/artifacts"; cp -r "$DIR"/*.txt "$DIR"/*.out "$DIR"/*.log "$DIR/e2e" "$OUT/artifacts/" 2>/dev/null
  rm -rf "$DIR"
  local BG; BG=$(pgrep -f "port=$PGPORT_|$AUTHPORT|$RESTPORT" | wc -l)
  [ "$SUMMARY" = 1 ] || { FAILS=$((FAILS+1)); echo "!! NO E2E SUMMARY — aborted at stage=$STAGE exit=$c (FAIL, not skip)"; }
  local END H; END=$(date -u +%FT%T.%3NZ); H=$(sha256sum "$LOG" | cut -d' ' -f1)
  echo "### RESULT run_id=$RUNID start=$START end=$END stage=$STAGE checks=$CHECKS failures=$FAILS destroyed=true log_sha256_pre_result=$H"
  [ "$FAILS" = 0 ] || exit 1
  exit 0
}
PIDS=()
trap on_err ERR; trap cleanup EXIT
echo "### pv-e2e rehearsal run_id=$RUNID pg=$PGPORT_ auth=$AUTHPORT rest=$RESTPORT gw=$GWPORT app=$APPPORT out=$OUT"

wait_http(){ local url=$1 n=${2:-60}; for i in $(seq 1 "$n"); do curl -sf -o /dev/null "$url" && return 0; sleep 1; done; return 1; }

############################################################ preflight
stage preflight
PGBIN=""
if [ -s db/r1/c/H/pgbin.path ] && [ -x "$(cat db/r1/c/H/pgbin.path)/initdb" ]; then PGBIN=$(cat db/r1/c/H/pgbin.path); fi
[ -n "$PGBIN" ] || PGBIN=$(dirname "$(readlink -f "$(command -v initdb)")")
[ -x "$PGBIN/initdb" ] || fatal "initdb missing in $PGBIN"
AUTHBIN=${AUTHBIN:-/opt/pve/bin/auth}
RESTBIN=${RESTBIN:-$(command -v postgrest || true)}
[ -x "$AUTHBIN" ] || fatal "gotrue binary missing: $AUTHBIN"
[ -x "$RESTBIN" ] || fatal "postgrest binary missing"
[ -d /opt/pve/migrations ] || fatal "gotrue migrations missing"
export PATH="$PGBIN:$PATH"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
rm -rf "$DIR"; mkdir -p "$DIR/sock" "$DIR/e2e"
ASU=""; if [ "$(id -u)" = 0 ]; then chown -R 1000:1000 "$DIR"; ASU="setpriv --reuid=1000 --regid=1000 --clear-groups"; fi

############################################################ initdb
stage initdb
$ASU "$PGBIN/initdb" -D "$DIR/pg" -U postgres --locale=C -E UTF8 >"$DIR/initdb.log" 2>&1 || { tail -20 "$DIR/initdb.log"; fatal initdb; }
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" \
  -o "-p $PGPORT_ -k $DIR/sock -c listen_addresses=127.0.0.1 -c fsync=off" \
  -w -t 60 start >"$DIR/pgctl.log" 2>&1 || { tail -20 "$DIR/pg.log"; fatal "pg_ctl start"; }
CL="postgresql://postgres@localhost:$PGPORT_/clone?sslmode=disable"
psql "postgresql://postgres@localhost:$PGPORT_/postgres?sslmode=disable" -qX -c 'create database clone' >/dev/null

############################################################ schema
stage schema
for f in db/r1/c/PV/000_clone_shape.sql db/r1/c/PV/e2e/002_e2e_shape.sql \
         db/r1/c/PV/001_projection_view.sql db/r1/c/PV/e2e/003_prod_rpcs.sql; do
  psql "$CL" -qX -v ON_ERROR_STOP=1 -f "$f" >>"$DIR/schema.log" 2>&1 || { tail -25 "$DIR/schema.log"; fatal "apply $f"; }
done
grep -E '^psql:.*(ERROR|FATAL)' "$DIR/schema.log" >"$DIR/schema_errors.txt" || true
chk $([ ! -s "$DIR/schema_errors.txt" ] && echo 0 || echo 1) "PVE-01 clone schema (shape+delta+view+rpcs) applied with 0 errors" "$(head -3 "$DIR/schema_errors.txt")"

psql "$CL" -qX -v ON_ERROR_STOP=1 >>"$DIR/schema.log" 2>&1 <<SQL
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'pve';
-- GoTrue runs unqualified queries against the auth schema (identities/users);
-- give it a dedicated login role whose search_path resolves them (EF-PVE-01).
CREATE ROLE gotrue LOGIN SUPERUSER PASSWORD 'pve';
ALTER ROLE gotrue SET search_path = auth, public;
GRANT anon, authenticated, service_role TO authenticator;
GRANT USAGE ON SCHEMA public TO authenticator;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
SQL

############################################################ gotrue
stage gotrue
JWT_SECRET="pve-e2e-jwt-secret-$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')"
ANON_KEY=$(python3 - "$JWT_SECRET" <<'PY'
import base64, hashlib, hmac, json, sys, time
def b(o): return base64.urlsafe_b64encode(json.dumps(o,separators=(',',':')).encode()).rstrip(b'=')
h=b({"alg":"HS256","typ":"JWT"}); now=int(time.time())
p=b({"role":"anon","iss":"supabase","iat":now,"exp":now+86400})
s=base64.urlsafe_b64encode(hmac.new(sys.argv[1].encode(), h+b'.'+p, hashlib.sha256).digest()).rstrip(b'=')
print((h+b'.'+p+b'.'+s).decode())
PY
)
export GOTRUE_DB_DRIVER=postgres \
  DATABASE_URL="postgres://gotrue:pve@localhost:$PGPORT_/clone?sslmode=disable" \
  GOTRUE_DB_MIGRATIONS_PATH=/opt/pve/migrations \
  GOTRUE_API_HOST=127.0.0.1 PORT=$AUTHPORT \
  GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
  GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  GOTRUE_SITE_URL="http://127.0.0.1:$APPPORT" \
  GOTRUE_URI_ALLOW_LIST="http://127.0.0.1:$APPPORT/*" \
  GOTRUE_DISABLE_SIGNUP=false GOTRUE_MAILER_AUTOCONFIRM=true \
  GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_LOG_LEVEL=warn \
  API_EXTERNAL_URL="http://127.0.0.1:$GWPORT/auth/v1"
"$AUTHBIN" migrate >"$DIR/gotrue_migrate.log" 2>&1 || { tail -25 "$DIR/gotrue_migrate.log"; fatal "gotrue migrate"; }
"$AUTHBIN" serve >"$DIR/gotrue.log" 2>&1 & PIDS+=($!)
wait_http "http://127.0.0.1:$AUTHPORT/health" 60 || { tail -25 "$DIR/gotrue.log"; fatal "gotrue not healthy"; }
chk 0 "PVE-02 real GoTrue up and healthy on $AUTHPORT"

############################################################ postgrest
stage postgrest
cat >"$DIR/postgrest.conf" <<CFG
db-uri = "postgres://authenticator:pve@localhost:$PGPORT_/clone?sslmode=disable"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
jwt-aud = "authenticated"
server-host = "127.0.0.1"
server-port = $RESTPORT
db-pool = 10
CFG
"$RESTBIN" "$DIR/postgrest.conf" >"$DIR/postgrest.log" 2>&1 & PIDS+=($!)
wait_http "http://127.0.0.1:$RESTPORT/experts?limit=1" 60 || { tail -25 "$DIR/postgrest.log"; fatal "postgrest not up"; }
chk 0 "PVE-03 real PostgREST up on $RESTPORT (authenticator role, RLS enforced)"

############################################################ gateway
stage gateway
node db/r1/c/PV/e2e/gateway.mjs "$GWPORT" "$AUTHPORT" "$RESTPORT" >"$DIR/gateway.log" 2>&1 & PIDS+=($!)
wait_http "http://127.0.0.1:$GWPORT/auth/v1/health" 30 || { tail -20 "$DIR/gateway.log"; fatal "gateway not up"; }
chk 0 "PVE-04 gateway routing /auth/v1 + /rest/v1 on $GWPORT"

############################################################ identities + fixture
stage fixture
node db/r1/c/PV/e2e/mint_users.mjs "http://127.0.0.1:$GWPORT/auth/v1" "$ANON_KEY" >"$DIR/users.txt" 2>"$DIR/users_err.txt" \
  || { cat "$DIR/users_err.txt"; fatal "mint users via real GoTrue"; }
UA=$(awk '/pve-alpha@/{print $2}' "$DIR/users.txt")
UB=$(awk '/pve-beta@/{print $2}' "$DIR/users.txt")
UADM=$(awk '/pve-admin@/{print $2}' "$DIR/users.txt")
UMEM=$(awk '/pve-member@/{print $2}' "$DIR/users.txt")
[ -n "$UA" ] && [ -n "$UB" ] && [ -n "$UADM" ] && [ -n "$UMEM" ] || fatal "missing minted user ids"
chk 0 "PVE-05 4 identities minted through the real GoTrue HTTP API"
psql "$CL" -qX -v ON_ERROR_STOP=1 -v ua="$UA" -v ub="$UB" -v uadm="$UADM" -v umem="$UMEM" \
  -f db/r1/c/PV/e2e/004_e2e_fixture.sql >"$DIR/fixture.log" 2>&1 || { tail -25 "$DIR/fixture.log"; fatal "fixture"; }
COUNTS=$(psql "$CL" -qXAt -c "SELECT (SELECT count(*) FROM experts)||'|'||(SELECT count(*) FROM expert_signals)||'|'||(SELECT count(*) FROM trade_records)||'|'||(SELECT count(*) FROM trade_records WHERE quantity=0)")
chk $([ "$COUNTS" = "2|6|7|1" ] && echo 0 || echo 1) "PVE-06 synthetic fixture 2 experts / 6 signals / 7 trades / 1 true-zero" "$COUNTS"

############################################################ app build
stage build
BUILDDIR="$DIR/app"
VITE_SUPABASE_URL="http://127.0.0.1:$GWPORT" \
VITE_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" \
VITE_SUPABASE_PROJECT_ID="pve-clone" \
  npx vite build --outDir "$BUILDDIR" --emptyOutDir >"$DIR/build.log" 2>&1 \
  || { tail -30 "$DIR/build.log"; fatal "vite build"; }
chk $([ -f "$BUILDDIR/index.html" ] && echo 0 || echo 1) "PVE-07 real app build produced dist"
grep -q "127.0.0.1:$GWPORT" -r "$BUILDDIR/assets" >/dev/null 2>&1
chk $? "PVE-08 build is wired to the clone gateway (no production endpoint baked in)"
grep -rl "yqacmrgdjlenbijclngi" "$BUILDDIR" >"$DIR/prod_ref.txt" 2>/dev/null || true
chk $([ ! -s "$DIR/prod_ref.txt" ] && echo 0 || echo 1) "PVE-09 build contains no production project reference" "$(head -1 "$DIR/prod_ref.txt")"

npx vite preview --outDir "$BUILDDIR" --port "$APPPORT" --strictPort --host 127.0.0.1 >"$DIR/preview.log" 2>&1 & PIDS+=($!)
wait_http "http://127.0.0.1:$APPPORT/" 60 || { tail -20 "$DIR/preview.log"; fatal "app preview not up"; }
chk 0 "PVE-10 real app served on $APPPORT with SPA fallback"

############################################################ browser e2e
stage e2e
set +e
python3 db/r1/c/PV/e2e/pve_e2e.py "http://127.0.0.1:$APPPORT" "http://127.0.0.1:$GWPORT" "$DIR/e2e" "$CL" \
  >"$DIR/e2e.log" 2>&1
E2E_RC=$?
set -e
cat "$DIR/e2e.log"
E2E_LINE=$(grep '^### E2E SUMMARY' "$DIR/e2e.log" || true)
[ -n "$E2E_LINE" ] || fatal "e2e produced no summary (silent exit = FAIL)"
SUMMARY=1
E2E_CHECKS=$(sed -n 's/.*checks=\([0-9]*\).*/\1/p' <<<"$E2E_LINE")
E2E_FAILED=$(sed -n 's/.*failed=\([0-9]*\).*/\1/p' <<<"$E2E_LINE")
CHECKS=$((CHECKS+E2E_CHECKS)); FAILS=$((FAILS+E2E_FAILED))
echo "  e2e checks=$E2E_CHECKS failed=$E2E_FAILED rc=$E2E_RC"

############################################################ evidence + rollback
stage rollback
psql "$CL" -qXAt -f db/r1/c/PV/pv_fingerprint.sql | sort >"$DIR/fp_with_view.txt"
psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/c/PV/099_rollback.sql >"$DIR/rollback.log" 2>&1 || fatal rollback
psql "$CL" -qXAt -c "SELECT to_regclass('public.public_expert_state_active') IS NULL" >"$DIR/post_rollback.out"
chk $([ "$(cat "$DIR/post_rollback.out")" = t ] && echo 0 || echo 1) "PVE-11 rollback removes the view"
POST=$(psql "$CL" -qXAt -c "SELECT (SELECT count(*) FROM expert_signals)||'|'||(SELECT count(*) FROM trade_records)")
chk $([ "$POST" = "6|7" ] && echo 0 || echo 1) "PVE-12 rollback changed no rows (6|7)" "$POST"

mkdir -p "$OUT/artifacts"
cp -r "$DIR/e2e" "$OUT/artifacts/e2e" 2>/dev/null
for f in gotrue.log postgrest.log gateway.log preview.log build.log e2e.log schema.log fixture.log; do
  [ -f "$DIR/$f" ] && sed -E "s/$JWT_SECRET/<REDACTED_JWT_SECRET>/g; s/eyJ[A-Za-z0-9_.-]{20,}/<REDACTED_JWT>/g" \
    "$DIR/$f" >"$OUT/artifacts/$f"
done
sed -E "s/$JWT_SECRET/<REDACTED_JWT_SECRET>/g; s/eyJ[A-Za-z0-9_.-]{20,}/<REDACTED_JWT>/g" -i "$LOG"
echo "### ENDPOINTS app=http://127.0.0.1:$APPPORT gateway=http://127.0.0.1:$GWPORT gotrue=http://127.0.0.1:$AUTHPORT postgrest=http://127.0.0.1:$RESTPORT"
