#!/usr/bin/env bash
# =====================================================================
# Stage B v6 — EDGE end-to-end rehearsal on a disposable clone.
#   real Deno runtime  +  real PostgREST  +  real supabase-js
#   +  loopback FinMind provider mock (production never contacted)
#
# Usage: db/r1/c/SB/sb_edge_rehearsal.sh <name> <pg-port> [outdir]
# Fail-loud: ERR/EXIT traps, missing summary == FAIL (never a silent skip).
# =====================================================================
set -Eeuo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$ROOT"
NAME=${1:-B12}; PORT=${2:-55901}; OUT=${3:-/tmp/sb-$NAME}
BK=db/r1/c/S0/backup; DIR=/tmp/sb$NAME
PGRST_PORT=$((PORT + 1)); PROXY_PORT=$((PORT + 2)); MOCK_PORT=$((PORT + 3))
WORKER_PORT=$((PORT + 4)); ADMIN_PORT=$((PORT + 5)); AUTH_PORT=$((PORT + 6))
SECRET='clone-only-rehearsal-jwt-secret-0123456789abcdef'
GOTRUE_BIN=${GOTRUE_BIN:-/tmp/gotrue-sb/auth}

RUNID="$NAME-$(date -u +%Y%m%dT%H%M%SZ)-$$"
START=$(date -u +%FT%T.%3NZ)
mkdir -p "$OUT"; LOG="$OUT/$NAME.log"; : >"$LOG"
exec > >(tee -a "$LOG") 2>&1

FAILS=0; CHECKS=0; SUMMARY=0; STAGE=init; PIDS=()
chk(){ CHECKS=$((CHECKS+1)); if [ "$1" = 0 ]; then echo "  PASS $2"; else FAILS=$((FAILS+1)); echo "  FAIL $2 ${3:-}"; fi; }
fatal(){ FAILS=$((FAILS+1)); echo "!! FATAL stage=$STAGE: $*"; exit 1; }
stage(){ STAGE=$1; echo "== stage $1 $(date -u +%FT%T.%3NZ)"; }
on_err(){ local c=$?; echo "!! ERR stage=$STAGE line=${BASH_LINENO[0]} cmd=[$BASH_COMMAND] exit=$c"; FAILS=$((FAILS+1)); }
cleanup(){
  local c=$?; trap - EXIT ERR; set +e
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -9 "$p" >/dev/null 2>&1; done
  [ -d "$DIR/pg" ] && $ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -m immediate -w stop >/dev/null 2>&1
  mkdir -p "$OUT/artifacts"; cp "$DIR"/*.txt "$DIR"/*.log "$DIR"/*.out "$DIR"/*.jsonl "$OUT/artifacts/" 2>/dev/null
  rm -rf "$DIR"
  local BG; BG=$(pgrep -f "port=$PORT|$PGRST_PORT|$WORKER_PORT" 2>/dev/null | wc -l)
  [ "$SUMMARY" = 1 ] || { FAILS=$((FAILS+1)); echo "!! NO EDGE SUMMARY — aborted at stage=$STAGE exit=$c (FAIL, not skip)"; }
  local END H; END=$(date -u +%FT%T.%3NZ); H=$(sha256sum "$LOG" | cut -d' ' -f1)
  echo "### RESULT run_id=$RUNID start=$START end=$END stage=$STAGE checks=$CHECKS failures=$FAILS destroyed=true log_sha256_pre_result=$H"
  [ "$FAILS" = 0 ] || exit 1
  exit 0
}
trap on_err ERR; trap cleanup EXIT
echo "### stage-b EDGE rehearsal run_id=$RUNID pg=$PORT pgrst=$PGRST_PORT proxy=$PROXY_PORT mock=$MOCK_PORT worker=$WORKER_PORT admin=$ADMIN_PORT auth=$AUTH_PORT"

############################################################ preflight
stage preflight
if [ -s db/r1/c/H/pgbin.path ]; then PGBIN=$(cat db/r1/c/H/pgbin.path); else PGBIN=$(dirname "$(command -v initdb)"); fi
[ -x "$PGBIN/initdb" ] || fatal "initdb missing in $PGBIN"
export PATH="$PGBIN:$PATH"
command -v deno >/dev/null || fatal "deno missing (real edge runtime required)"
# Real Supabase Auth (GoTrue) is mandatory. A mock/sb_rest_proxy stand-in must
# NEVER impersonate GoTrue: if the binary is absent we abort and the run is
# recorded as an exact Auth GAP instead of a green-but-fake pass.
[ -x "$GOTRUE_BIN" ] || fatal "AUTH GAP: real supabase-auth binary missing at $GOTRUE_BIN (refusing to mock GoTrue)"
[ -f "$BK/MANIFEST.json" ] || fatal "baseline manifest missing"
PGRST_BIN=$(command -v postgrest || true)
[ -n "$PGRST_BIN" ] || PGRST_BIN=$(ls -d /nix/store/*postgrest*-bin/bin/postgrest 2>/dev/null | head -1 || true)
[ -n "$PGRST_BIN" ] || fatal "postgrest missing (real HTTP path required, not a skip)"
for p in $PORT $PGRST_PORT $PROXY_PORT $MOCK_PORT $WORKER_PORT $ADMIN_PORT $AUTH_PORT; do
python3 - "$p" <<'PY' || fatal "port $p busy"
import socket,sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
try: s.bind(("127.0.0.1",int(sys.argv[1])))
except OSError: sys.exit(1)
s.close()
PY
done
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
rm -rf "$DIR"; mkdir -p "$DIR/sock"
ASU=""; if [ "$(id -u)" = 0 ]; then chown -R 1000:1000 "$DIR"; ASU="setpriv --reuid=1000 --regid=1000 --clear-groups"; fi

############################################################ clone + apply
stage clone
$ASU "$PGBIN/initdb" -D "$DIR/pg" -U postgres --locale=C -E UTF8 >"$DIR/initdb.log" 2>&1 || { tail -20 "$DIR/initdb.log"; fatal initdb; }
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" \
  -o "-p $PORT -k $DIR/sock -c listen_addresses=127.0.0.1 -c fsync=off" -w -t 60 start >"$DIR/pgctl.log" 2>&1 \
  || { tail -20 "$DIR/pg.log"; fatal "pg_ctl start"; }
psql "postgresql://postgres@localhost:$PORT/postgres?sslmode=disable" -qX -c 'create database clone' >/dev/null
CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"
for f in $(python3 -c "import json;print(' '.join(json.load(open('$BK/MANIFEST.json'))['restore_bundle']['order']))"); do
  psql "$CL" -qX -f "$BK/restore/$f" >>"$DIR/restore.log" 2>&1 || true
done
grep -E '^psql:.*(ERROR|FATAL)' "$DIR/restore.log" | sort >"$DIR/restore_errors.txt" || true
RE=$(wc -l <"$DIR/restore_errors.txt")
chk $([ "$RE" = 0 ] && echo 0 || echo 1) "EB-01 fresh restore 0 errors" "$(head -3 "$DIR/restore_errors.txt")"
psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/c/SB/001_stage_b.sql >"$DIR/apply1.log" 2>&1 || { tail -20 "$DIR/apply1.log"; fatal "001 apply"; }
psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/c/SB/002_recover_gate_aware.sql >"$DIR/apply2.log" 2>&1 || { tail -20 "$DIR/apply2.log"; fatal "002 apply"; }
chk 0 "EB-02 stage B applied to clone"
# clone-only fixture: the baseline bundle carries no row data, so a fresh clone
# has neither the `market_batch` gate row nor any auth identity (EF-01/RC-1/RC-2).
psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/c/SB/fixtures/010_clone_fixture.sql >"$DIR/fixture.log" 2>&1 \
  || { tail -20 "$DIR/fixture.log"; fatal "clone fixture"; }
GATEROW=$(psql "$CL" -qXAt -c "SELECT count(*) FROM public.tw_bsr_sync_config WHERE key='market_batch' AND config ? 'admission_nonce' AND config->>'admission_blocked'='false'")
chk $([ "$GATEROW" = 1 ] && echo 0 || echo 1) "EB-02b fixture seeded an explicit OPEN market_batch gate row ($GATEROW)"
psql "$CL" -qXAt -f db/r1/c/SB/sb_fingerprint.sql | sort >"$DIR/fp_pre_edge.txt"

############################################################ services
stage services
cat >"$DIR/pgrst.conf" <<EOF
db-uri = "$CL"
db-schemas = "public"
db-anon-role = "anon"
db-pool = 6
server-port = $PGRST_PORT
server-host = "127.0.0.1"
jwt-secret = "$SECRET"
db-use-legacy-gucs = false
EOF
"$PGRST_BIN" "$DIR/pgrst.conf" >"$DIR/pgrst.log" 2>&1 & PIDS+=($!)
python3 db/r1/c/SB/sb_rest_proxy.py "$PROXY_PORT" "$PGRST_PORT" "$DIR/proxy.jsonl" "$AUTH_PORT" >"$DIR/proxy.log" 2>&1 & PIDS+=($!)
# --- real Supabase Auth (GoTrue) against this clone -------------------------
env GOTRUE_DB_DRIVER=postgres \
    DATABASE_URL="postgres://gotrue_admin:clone-only@127.0.0.1:$PORT/clone?sslmode=disable" \
    GOTRUE_DB_NAMESPACE=auth GOTRUE_JWT_SECRET="$SECRET" GOTRUE_JWT_AUD=authenticated \
    GOTRUE_JWT_EXP=3600 GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
    GOTRUE_API_HOST=127.0.0.1 PORT=$AUTH_PORT GOTRUE_SITE_URL=http://localhost \
    API_EXTERNAL_URL="http://127.0.0.1:$AUTH_PORT" GOTRUE_DISABLE_SIGNUP=false \
    GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_LOG_LEVEL=warn \
    "$GOTRUE_BIN" serve >"$DIR/gotrue.log" 2>&1 & PIDS+=($!)
echo reject >"$DIR/mock_mode"
python3 db/r1/c/SB/sb_provider_mock.py "$MOCK_PORT" "$DIR/mock_mode" "$DIR/provider.jsonl" >"$DIR/mock.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 80); do curl -sf -o /dev/null "http://127.0.0.1:$PGRST_PORT/" && break; sleep 0.5; done
curl -sf -o /dev/null "http://127.0.0.1:$PGRST_PORT/" || { tail -20 "$DIR/pgrst.log"; fatal "postgrest not ready"; }
curl -sf -o /dev/null "http://127.0.0.1:$PROXY_PORT/" || fatal "proxy not ready"
curl -sf -o /dev/null "http://127.0.0.1:$MOCK_PORT/?dataset=x" || fatal "provider mock not ready"
chk 0 "EB-03 postgrest + rest proxy + provider mock up"
for i in $(seq 1 80); do curl -sf -o /dev/null "http://127.0.0.1:$AUTH_PORT/health" && break; sleep 0.5; done
curl -sf -o /dev/null "http://127.0.0.1:$AUTH_PORT/health" || { tail -20 "$DIR/gotrue.log"; fatal "AUTH GAP: real GoTrue did not become healthy"; }
AUTHVER=$(curl -s "http://127.0.0.1:$AUTH_PORT/health" | python3 -c "import json,sys;print(json.load(sys.stdin).get('version',''))")
chk $([ -n "$AUTHVER" ] && echo 0 || echo 1) "EB-03b real supabase-auth up (version=$AUTHVER)"

SRK=$(python3 - "$SECRET" service_role <<'PY'
import base64,hashlib,hmac,json,sys
b=lambda x: base64.urlsafe_b64encode(x).rstrip(b'=')
h=b(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
p=b(json.dumps({"role":sys.argv[2],"exp":4102444800},separators=(',',':')).encode())
s=b(hmac.new(sys.argv[1].encode(),h+b'.'+p,hashlib.sha256).digest())
print((h+b'.'+p+b'.'+s).decode())
PY
)
export SUPABASE_URL="http://127.0.0.1:$PROXY_PORT"
export SUPABASE_SERVICE_ROLE_KEY="$SRK"
export SUPABASE_ANON_KEY="$SRK"
export FINMIND_TOKEN=rehearsal-token
export CRON_SHARED_SECRET=rehearsal-cron-secret
CRONH="X-Cron-Key: rehearsal-cron-secret"
export BSR_PROBE_ALLOW_LOCAL=1
export FINMIND_PROBE_BASE_URL="http://127.0.0.1:$MOCK_PORT/api/v4/data"

deno run -A db/r1/c/SB/sb_edge_driver.ts "$ROOT/supabase/functions/tw-bsr-finmind-sync/index.ts" "$WORKER_PORT" >"$DIR/worker_edge.log" 2>&1 & PIDS+=($!)
deno run -A db/r1/c/SB/sb_edge_driver.ts "$ROOT/supabase/functions/admin-bsr-admission/index.ts" "$ADMIN_PORT" >"$DIR/admin_edge.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 120); do grep -q EDGE_READY "$DIR/worker_edge.log" && grep -q EDGE_READY "$DIR/admin_edge.log" && break; sleep 0.5; done
grep -q EDGE_READY "$DIR/worker_edge.log" || { tail -30 "$DIR/worker_edge.log"; fatal "worker edge boot"; }
grep -q EDGE_READY "$DIR/admin_edge.log" || { tail -30 "$DIR/admin_edge.log"; fatal "admin edge boot"; }
chk 0 "EB-04 both edge functions booted in the real Deno runtime"

W="http://127.0.0.1:$WORKER_PORT"; A="http://127.0.0.1:$ADMIN_PORT"
POST_MAX_TIME=${POST_MAX_TIME:-60}
post(){ curl -s --max-time "$POST_MAX_TIME" -o "$2" -w '%{http_code}' -X POST "$1" -H 'Content-Type: application/json' ${4:+-H "$4"} -d "$3"; }
jqf(){ python3 -c "import json,sys;d=json.load(open(sys.argv[1]));
ks=sys.argv[2].split('.');v=d
for k in ks:
    v=(v or {}).get(k) if isinstance(v,dict) else None
print(json.dumps(v))" "$1" "$2"; }
gateblocked(){ psql "$CL" -qXAt -c "SELECT public.bsr_admission_status()->>'blocked'"; }
provider_calls(){ wc -l <"$DIR/provider.jsonl" 2>/dev/null || echo 0; }
open_gate(){ psql "$CL" -qX -c "UPDATE public.tw_bsr_sync_config SET config = config - 'admission_blocked' - 'admission_blocked_at' - 'admission_terminal_code' - 'admission_reason' || '{\"admission_blocked\": false}'::jsonb WHERE key='market_batch'" >/dev/null; }

############################################################ A. gate OPEN → enqueue + worker happy path
stage open_path
open_gate
: >"$DIR/provider.jsonl"
echo ok >"$DIR/mock_mode"
psql "$CL" -qX -c "DELETE FROM public.tw_bsr_sync_queue WHERE enqueued_by LIKE 'edge_rehearsal%'" >/dev/null
psql "$CL" -qX >/dev/null <<SQL
INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, enqueued_by, next_run_at)
VALUES ('2330', current_date - 3, 1, 'pending', 'edge_rehearsal_open', now())
ON CONFLICT DO NOTHING;
SQL
C=$(post "$W" "$DIR/w_nokey.json" '{"mode":"worker","batch":3,"budget_ms":8000}')
chk $([ "$C" = 403 ] && echo 0 || echo 1) "EB-09 worker rejects missing X-Cron-Key (got $C)"
C=$(post "$W" "$DIR/w_open.json" '{"mode":"worker","batch":3,"budget_ms":8000}' "$CRONH")
cat "$DIR/w_open.json"; echo
chk $([ "$C" = 200 ] && echo 0 || echo 1) "EB-10 worker HTTP 200 when gate open (got $C)"
chk $([ "$(jqf "$DIR/w_open.json" note)" = 'null' ] && echo 0 || echo 1) "EB-11 worker did NOT short-circuit on admission_gate_closed"
chk $([ "$(jqf "$DIR/w_open.json" admission.decision)" = '"open"' ] && echo 0 || echo 1) "EB-12 worker payload reports admission decision=open"
chk $([ "$(provider_calls)" -ge 1 ] && echo 0 || echo 1) "EB-13 provider WAS called while gate open ($(provider_calls) calls)"

C=$(post "$W" "$DIR/e_open.json" '{"mode":"enqueue","tier1":true,"tier2":false,"tier3":false}' "$CRONH")
chk $([ "$C" = 200 ] && echo 0 || echo 1) "EB-14 enqueue HTTP 200 when gate open (got $C)"
chk $([ "$(jqf "$DIR/e_open.json" admission.decision)" = '"open"' ] && echo 0 || echo 1) "EB-15 enqueue payload reports decision=open"
chk $([ "$(jqf "$DIR/e_open.json" admission_accounting.blocked_count)" = '0' ] && echo 0 || echo 1) "EB-16 open gate never accounts rows as blocked"

############################################################ B. terminal rejection → atomic block+terminalize
stage terminal
open_gate
echo reject >"$DIR/mock_mode"
: >"$DIR/provider.jsonl"
psql "$CL" -qX >/dev/null <<SQL
INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, enqueued_by, next_run_at)
VALUES ('2317', current_date - 4, 1, 'pending', 'edge_rehearsal_term', now()),
       ('2454', current_date - 4, 1, 'pending', 'edge_rehearsal_term', now())
ON CONFLICT DO NOTHING;
SQL
BEFORE_OTHER=$(psql "$CL" -qXAt -c "SELECT count(*) FROM public.tw_bsr_sync_queue WHERE status='pending' AND enqueued_by NOT LIKE 'edge_rehearsal%'")
VER_PRE_TERM=$(psql "$CL" -qXAt -c "SELECT public.bsr_admission_status()->>'version'")
C=$(post "$W" "$DIR/w_term.json" '{"mode":"worker","batch":5,"budget_ms":8000}' "$CRONH")
cat "$DIR/w_term.json"; echo
chk $([ "$C" = 200 ] && echo 0 || echo 1) "EB-20 worker returns 200 on terminal rejection (got $C)"
chk $([ "$(jqf "$DIR/w_term.json" stopped_by_terminal)" = 'true' ] && echo 0 || echo 1) "EB-21 worker halted on exact terminal signature"
chk $([ "$(jqf "$DIR/w_term.json" terminal.rpc_ok)" = 'true' ] && echo 0 || echo 1) "EB-22 single atomic block+terminalize RPC succeeded"
# batch>1 means several jobs hit the same exact terminal signature concurrently:
# the first wins with transition=blocked, the rest legitimately observe
# already_blocked. Both are a real transition of THIS run, so the assertion is
# (transition in blocked|already_blocked) AND the DB gate version advanced.
TERMTR=$(jqf "$DIR/w_term.json" terminal.transition)
VER_POST_TERM=$(psql "$CL" -qXAt -c "SELECT public.bsr_admission_status()->>'version'")
chk $([ \( "$TERMTR" = '"blocked"' -o "$TERMTR" = '"already_blocked"' \) ] && [ "$VER_POST_TERM" -gt "$VER_PRE_TERM" ] && echo 0 || echo 1) "EB-23 gate transitioned blocked (transition=$TERMTR version $VER_PRE_TERM->$VER_POST_TERM)"
chk $([ "$(gateblocked)" = 'true' ] && echo 0 || echo 1) "EB-24 DB gate is closed after the run"
TERMROWS=$(psql "$CL" -qXAt -c "SELECT count(*) FROM public.tw_bsr_sync_queue WHERE enqueued_by='edge_rehearsal_term' AND status<>'pending'")
chk $([ "$TERMROWS" -ge 1 ] && echo 0 || echo 1) "EB-25 this run's claimed rows terminalized ($TERMROWS)"
AFTER_OTHER=$(psql "$CL" -qXAt -c "SELECT count(*) FROM public.tw_bsr_sync_queue WHERE status='pending' AND enqueued_by NOT LIKE 'edge_rehearsal%'")
chk $([ "$BEFORE_OTHER" = "$AFTER_OTHER" ] && echo 0 || echo 1) "EB-26 no blanket pending UPDATE: unrelated pending rows untouched ($BEFORE_OTHER->$AFTER_OTHER)"

############################################################ C. gate CLOSED → fail-closed worker + enqueue
stage blocked_path
: >"$DIR/provider.jsonl"
echo ok >"$DIR/mock_mode"
C=$(post "$W" "$DIR/w_blocked.json" '{"mode":"worker","batch":5,"budget_ms":8000}' "$CRONH")
cat "$DIR/w_blocked.json"; echo
chk $([ "$C" = 200 ] && echo 0 || echo 1) "EB-30 worker responds 200 while blocked (got $C)"
chk $([ "$(jqf "$DIR/w_blocked.json" note)" = '"admission_gate_closed"' ] && echo 0 || echo 1) "EB-31 worker short-circuits with admission_gate_closed"
chk $([ "$(jqf "$DIR/w_blocked.json" claimed)" = '0' ] && echo 0 || echo 1) "EB-32 worker claimed 0 jobs while blocked"
chk $([ "$(jqf "$DIR/w_blocked.json" admission.reason)" != 'null' ] && echo 0 || echo 1) "EB-33 blocked reason surfaced in HTTP payload"
chk $([ "$(jqf "$DIR/w_blocked.json" admission.gate_version)" != 'null' ] && echo 0 || echo 1) "EB-34 gate version surfaced in HTTP payload"
chk $([ "$(provider_calls)" = 0 ] && echo 0 || echo 1) "EB-35 ZERO provider calls while blocked ($(provider_calls))"
if grep -q 'admission' "$DIR/worker_edge.log"; then chk 0 "EB-36 edge log carries admission context"; else chk 1 "EB-36 edge log carries admission context"; fi

QB=$(psql "$CL" -qXAt -c "SELECT count(*) FROM public.tw_bsr_sync_queue")
C=$(post "$W" "$DIR/e_blocked.json" '{"mode":"enqueue","tier1":true,"tier2":true,"tier3":false}' "$CRONH")
cat "$DIR/e_blocked.json"; echo
chk $([ "$C" = 200 ] && echo 0 || echo 1) "EB-40 enqueue responds 200 while blocked (got $C)"
chk $([ "$(jqf "$DIR/e_blocked.json" admission.decision)" = '"blocked"' ] && echo 0 || echo 1) "EB-41 enqueue reports decision=blocked"
chk $([ "$(jqf "$DIR/e_blocked.json" admission.terminal_code)" != 'null' ] && echo 0 || echo 1) "EB-42 enqueue reports terminal_code"
QA=$(psql "$CL" -qXAt -c "SELECT count(*) FROM public.tw_bsr_sync_queue")
chk $([ "$QB" = "$QA" ] && echo 0 || echo 1) "EB-43 DB-level gate refused every enqueue insert ($QB->$QA)"
BC=$(jqf "$DIR/e_blocked.json" admission_accounting.blocked_count)
chk $([ "$BC" != 'null' ] && echo 0 || echo 1) "EB-44 per-chunk blocked accounting present (blocked_count=$BC)"

############################################################ D. admin probe auth matrix
stage admin_auth
# Identities are created through the REAL GoTrue admin API and the tokens are
# REAL password-grant JWTs. Nothing here is minted by the harness except the
# deliberately invalid ones (expired / wrong-signature / not-a-jwt).
AU="http://127.0.0.1:$AUTH_PORT"
mkuser(){ # <email> <password> -> uuid
  curl -s -m 15 -X POST "$AU/admin/users" -H "Authorization: Bearer $SRK" \
       -H 'Content-Type: application/json' \
       -d "{\"email\":\"$1\",\"password\":\"$2\",\"email_confirm\":true}" \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))"
}
mktoken(){ # <email> <password> -> access_token
  curl -s -m 15 -X POST "$AU/token?grant_type=password" -H 'Content-Type: application/json' \
       -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}
badjwt(){ # <kind> -> token  (expired | forged)
  python3 - "$SECRET" "$1" <<'PY2'
import base64,hashlib,hmac,json,sys,time
b=lambda x: base64.urlsafe_b64encode(x).rstrip(b'=')
kind=sys.argv[2]
secret=sys.argv[1] if kind!='forged' else 'attacker-controlled-secret'
exp=int(time.time())-60 if kind=='expired' else 4102444800
h=b(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
p=b(json.dumps({"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001",
                "aud":"authenticated","exp":exp,"iat":int(time.time())-120,
                "email":"forged@example.test"},separators=(',',':')).encode())
s=b(hmac.new(secret.encode(),h+b'.'+p,hashlib.sha256).digest())
print((h+b'.'+p+b'.'+s).decode())
PY2
}

ADMIN_UID=$(mkuser admin@clone.test 'Clone-Rehearsal-1')
PLAIN_UID=$(mkuser plain@clone.test 'Clone-Rehearsal-2')
[ -n "$ADMIN_UID" ] || { tail -5 "$DIR/gotrue.log"; fatal "AUTH GAP: GoTrue could not create the admin identity"; }
[ -n "$PLAIN_UID" ] || fatal "AUTH GAP: GoTrue could not create the non-admin identity"
psql "$CL" -qX -c "INSERT INTO public.user_roles(user_id, role) VALUES ('$ADMIN_UID','company_admin') ON CONFLICT DO NOTHING" >/dev/null
chk $([ "$(psql "$CL" -qXAt -c "SELECT public.has_role('$ADMIN_UID','company_admin')")" = t ] && echo 0 || echo 1) "EB-48 clone fixture identity holds company_admin via has_role()"
chk $([ "$(psql "$CL" -qXAt -c "SELECT public.has_role('$PLAIN_UID','company_admin')")" = f ] && echo 0 || echo 1) "EB-49 non-admin identity does NOT hold company_admin"

ADMTOK=$(mktoken admin@clone.test 'Clone-Rehearsal-1')
PLNTOK=$(mktoken plain@clone.test 'Clone-Rehearsal-2')
[ -n "$ADMTOK" ] || { tail -5 "$DIR/gotrue.log"; fatal "AUTH GAP: real password grant returned no access_token"; }
[ -n "$PLNTOK" ] || fatal "AUTH GAP: non-admin password grant returned no access_token"
ADMJWT="Authorization: Bearer $ADMTOK"
chk 0 "EB-49b real GoTrue password grant issued both access tokens"

C=$(post "$A" "$DIR/a_noauth.json" '{"action":"status"}')
chk $([ "$C" = 401 ] && echo 0 || echo 1) "EB-50 admin probe rejects missing JWT (got $C)"
C=$(post "$A" "$DIR/a_bad.json" '{"action":"status"}' "Authorization: Bearer not.a.jwt")
chk $([ "$C" = 401 ] && echo 0 || echo 1) "EB-51 admin probe rejects malformed JWT (got $C)"
C=$(post "$A" "$DIR/a_exp.json" '{"action":"probe"}' "Authorization: Bearer $(badjwt expired)")
chk $([ "$C" = 401 ] && echo 0 || echo 1) "EB-51b real getUser rejects an expired JWT (got $C)"
C=$(post "$A" "$DIR/a_forged.json" '{"action":"probe"}' "Authorization: Bearer $(badjwt forged)")
chk $([ "$C" = 401 ] && echo 0 || echo 1) "EB-51c real getUser rejects a wrong-signature JWT (got $C)"
C=$(post "$A" "$DIR/a_plain.json" '{"action":"probe"}' "Authorization: Bearer $PLNTOK")
chk $([ "$C" = 403 ] && echo 0 || echo 1) "EB-52 real non-admin user forbidden from probe (got $C)"
chk $([ "$(gateblocked)" = 'true' ] && echo 0 || echo 1) "EB-53 gate still closed after unauthorized attempts"
C=$(post "$A" "$DIR/a_anon.json" '{"action":"probe"}' "Authorization: Bearer $SRK")
chk $([ "$C" != 200 ] && echo 0 || echo 1) "EB-54 raw service_role JWT (no real user) cannot probe (got $C)"
C=$(post "$A" "$DIR/a_status.json" '{"action":"status"}' "$ADMJWT")
chk $([ "$C" = 200 ] && echo 0 || echo 1) "EB-55 admin status readable by a real company_admin (got $C)"
chk $([ "$(jqf "$DIR/a_status.json" admission.blocked)" = 'true' ] && echo 0 || echo 1) "EB-56 admin status reflects the closed gate"
# caller-supplied "success" must never be trusted: only a server-side probe unblocks
C=$(post "$A" "$DIR/a_selfclaim.json" '{"action":"unblock","probe_ok":true,"result":{"ok":true},"unblocked":true}' "$ADMJWT")
chk $([ "$(gateblocked)" = 'true' ] && echo 0 || echo 1) "EB-57 caller-forged success payload cannot unblock (http=$C)"
# SSRF: caller-supplied provider endpoints must be ignored.
# The provider mock is forced to reject first, otherwise this probe would run a
# genuinely successful server-side probe and silently UNBLOCK the gate, which
# would contaminate every later probe_negative/probe_positive assertion.
echo reject >"$DIR/mock_mode"
C=$(post "$A" "$DIR/a_ssrf.json" '{"action":"probe","base_url":"http://169.254.169.254/latest/meta-data","url":"http://169.254.169.254/","stock_id":"2330"}' "$ADMJWT")
if grep -q '169.254.169.254' "$DIR/provider.jsonl" 2>/dev/null; then chk 1 "EB-58 probe ignores caller-supplied SSRF target"; else chk 0 "EB-58 probe ignores caller-supplied SSRF target (http=$C)"; fi
chk $([ "$(gateblocked)" = 'true' ] && echo 0 || echo 1) "EB-58b SSRF probe left the gate closed"

############################################################ E. admin probe: provider still failing → NO unblock
stage probe_negative
for m in reject reject4 rate fail5; do
  echo "$m" >"$DIR/mock_mode"
  C=$(post "$A" "$DIR/a_$m.json" '{"action":"probe","stock_id":"2330","trade_date":"2026-08-14"}' "$ADMJWT")
  UNB=$(jqf "$DIR/a_$m.json" unblocked)
  chk $([ "$C" = 200 ] && [ "$UNB" = 'false' ] && echo 0 || echo 1) "EB-6$m probe($m) did NOT unblock (http=$C unblocked=$UNB)"
  chk $([ "$(gateblocked)" = 'true' ] && echo 0 || echo 1) "EB-6$m gate still closed after probe($m)"
done
if grep -qiE 'token|bearer|http://127|api key' "$DIR/a_reject.json"; then chk 1 "EB-70 probe evidence leaks no token/url/secret" "$(head -c 200 "$DIR/a_reject.json")"; else chk 0 "EB-70 probe evidence leaks no token/url/secret"; fi

############################################################ F. admin probe success → unblock, then recovery
stage probe_positive
echo ok >"$DIR/mock_mode"
VER_BEFORE=$(psql "$CL" -qXAt -c "SELECT public.bsr_admission_status()->>'version'")
C=$(post "$A" "$DIR/a_ok.json" '{"action":"probe","stock_id":"2330","trade_date":"2026-08-14"}' "$ADMJWT")
cat "$DIR/a_ok.json"; echo
chk $([ "$C" = 200 ] && echo 0 || echo 1) "EB-80 successful probe HTTP 200 (got $C)"
chk $([ "$(jqf "$DIR/a_ok.json" unblocked)" = 'true' ] && echo 0 || echo 1) "EB-81 real server-side probe success unblocked the gate"
chk $([ "$(gateblocked)" = 'false' ] && echo 0 || echo 1) "EB-82 DB gate open after verified probe"
VER_AFTER=$(psql "$CL" -qXAt -c "SELECT public.bsr_admission_status()->>'version'")
chk $([ "$VER_AFTER" -gt "$VER_BEFORE" ] && echo 0 || echo 1) "EB-83 gate version advanced ($VER_BEFORE->$VER_AFTER)"
# replay: identical request must not re-apply against the stale version
C=$(post "$A" "$DIR/a_replay.json" '{"action":"probe","stock_id":"2330","trade_date":"2026-08-14"}' "$ADMJWT")
chk $([ "$(jqf "$DIR/a_replay.json" transition)" = '"already_open"' ] && echo 0 || echo 1) "EB-84 replay is a no-op (already_open)"
: >"$DIR/provider.jsonl"
# recovery must have claimable work: the terminal stage terminalized its own rows
psql "$CL" -qX >/dev/null <<SQL
INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, enqueued_by, next_run_at)
VALUES ('2382', current_date - 4, 1, 'pending', 'edge_rehearsal_recover', now())
ON CONFLICT DO NOTHING;
SQL
C=$(post "$W" "$DIR/w_recover.json" '{"mode":"worker","batch":5,"budget_ms":8000}' "$CRONH")
chk $([ "$C" = 200 ] && echo 0 || echo 1) "EB-85 worker resumes after unblock (got $C)"
chk $([ "$(jqf "$DIR/w_recover.json" note)" != '"admission_gate_closed"' ] && echo 0 || echo 1) "EB-86 worker no longer short-circuits"
chk $([ "$(provider_calls)" -ge 1 ] && echo 0 || echo 1) "EB-87 provider reached again after recovery ($(provider_calls))"

############################################################ G. concurrency: two workers, one terminal
stage concurrency
echo reject >"$DIR/mock_mode"
psql "$CL" -qX >/dev/null <<SQL
INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, enqueued_by, next_run_at)
SELECT s, current_date - 6, 1, 'pending', 'edge_rehearsal_conc', now()
  FROM unnest(ARRAY['2603','2609','2615','3008','1301','1303']) s
ON CONFLICT DO NOTHING;
SQL
# EF-05: a bare `wait` here also waits on the long-lived GoTrue/PostgREST/proxy/
# provider/2x Deno services started earlier by this script, so it can never
# return. Bounded-wait ONLY the two worker PIDs; never `wait` with no args.
SVC_PIDS=("${PIDS[@]}")            # snapshot: long-lived services only
CONC_DEADLINE=${CONC_DEADLINE:-90}
: >"$DIR/c1.code"; : >"$DIR/c2.code"; : >"$DIR/c1.rc"; : >"$DIR/c2.rc"
( set +e; post "$W" "$DIR/w_c1.json" '{"mode":"worker","batch":3,"budget_ms":8000}' "$CRONH" >"$DIR/c1.code"; echo $? >"$DIR/c1.rc" ) & CP1=$!
( set +e; post "$W" "$DIR/w_c2.json" '{"mode":"worker","batch":3,"budget_ms":8000}' "$CRONH" >"$DIR/c2.code"; echo $? >"$DIR/c2.rc" ) & CP2=$!
PIDS+=("$CP1" "$CP2")
echo "   concurrency worker pids: $CP1 $CP2 (bounded wait ${CONC_DEADLINE}s)"
CW=0; CTIMEOUT=0
while :; do
  ALIVE=0
  kill -0 "$CP1" 2>/dev/null && ALIVE=1
  kill -0 "$CP2" 2>/dev/null && ALIVE=1
  [ "$ALIVE" = 0 ] && break
  if [ "$CW" -ge "$CONC_DEADLINE" ]; then CTIMEOUT=1; break; fi
  sleep 1; CW=$((CW+1))
done
if [ "$CTIMEOUT" = 1 ]; then
  kill -9 "$CP1" "$CP2" >/dev/null 2>&1 || true
  { echo "EF-05 concurrency bounded wait TIMEOUT after ${CONC_DEADLINE}s"; echo "pid1=$CP1 pid2=$CP2"; } >"$DIR/concurrency_timeout.txt"
fi
set +e; wait "$CP1"; CE1=$?; wait "$CP2"; CE2=$?; set -e
CC1=$(cat "$DIR/c1.code" 2>/dev/null); CC2=$(cat "$DIR/c2.code" 2>/dev/null)
CR1=$(cat "$DIR/c1.rc" 2>/dev/null); CR2=$(cat "$DIR/c2.rc" 2>/dev/null)
{ echo "timeout=$CTIMEOUT waited_s=$CW"
  echo "w1 pid=$CP1 proc_exit=$CE1 curl_rc=${CR1:-none} http=${CC1:-none}"
  echo "w2 pid=$CP2 proc_exit=$CE2 curl_rc=${CR2:-none} http=${CC2:-none}"; } | tee "$DIR/concurrency.out"
chk $([ "$CTIMEOUT" = 0 ] && echo 0 || echo 1) "EB-89 concurrency completed inside the bounded wait (waited=${CW}s)"
chk $([ "${CR1:-1}" = 0 ] && [ "${CR2:-1}" = 0 ] && echo 0 || echo 1) "EB-89b both concurrent curl processes exited 0 (rc=${CR1:-none}/${CR2:-none})"
chk $([ "${CC1:-x}" = 200 ] && [ "${CC2:-x}" = 200 ] && echo 0 || echo 1) "EB-90 both concurrent workers returned 200 (http=${CC1:-none}/${CC2:-none})"
chk $([ "$(gateblocked)" = 'true' ] && echo 0 || echo 1) "EB-91 gate closed exactly once under concurrency"
DUP=$(psql "$CL" -qXAt -c "SELECT count(*) FROM public.tw_bsr_sync_queue WHERE enqueued_by='edge_rehearsal_conc' AND status='processing' AND started_at < now() - interval '2 minutes'")
chk $([ "${DUP:-0}" = 0 ] && echo 0 || echo 1) "EB-92 no job left pending with a stale lease (${DUP:-0})"
DEAD=""
for p in "${SVC_PIDS[@]}"; do kill -0 "$p" 2>/dev/null || DEAD="$DEAD $p"; done
chk $([ -z "$DEAD" ] && echo 0 || echo 1) "EB-92b all long-lived services still alive after concurrency (dead:${DEAD:-none})"
if [ "${STOP_AFTER:-}" = concurrency ]; then
  SUMMARY=1
  echo "### FOCUSED RUN stop_after=concurrency checks=$CHECKS failures=$FAILS"
  exit 0
fi

############################################################ G2. gate state matrix (row missing / flag absent / malformed / rpc_error)
stage gate_matrix
# Contract split (EF-06). The Edge classifier fails closed when the gate ROW is
# unreadable; the DB wrapper deliberately COALESCEs an absent/malformed
# `admission_blocked` KEY to false (001_stage_b.sql v4 §3 compatibility rule),
# so a present row with a junk key is compatibility-OPEN, not fail-closed.
# Both are asserted here explicitly instead of assuming one of them.
# The row is hidden by renaming the key (not deleted): tw_bsr_sync_config has a
# history trigger with a UNIQUE(key,version), so delete+reinsert collides.

# --- A. gate ROW missing -> Edge fail-closed
: >"$DIR/provider.jsonl"; echo ok >"$DIR/mock_mode"
psql "$CL" -qX -c "UPDATE public.tw_bsr_sync_config SET key='market_batch__hidden' WHERE key='market_batch'" >/dev/null
C=$(post "$W" "$DIR/w_norow.json" '{"mode":"worker","batch":3,"budget_ms":8000}' "$CRONH")
chk $([ "$C" = 200 ] && echo 0 || echo 1) "EB-100 worker responds 200 when the gate row is missing (got $C)"
chk $([ "$(jqf "$DIR/w_norow.json" claimed)" = '0' ] && echo 0 || echo 1) "EB-101 missing gate ROW is fail-closed (claimed=0)"
chk $([ "$(jqf "$DIR/w_norow.json" note)" = '"admission_gate_closed"' ] && echo 0 || echo 1) "EB-101b missing gate ROW short-circuits with admission_gate_closed"
chk $([ "$(jqf "$DIR/w_norow.json" admission.decision)" = '"missing"' ] && echo 0 || echo 1) "EB-101c decision=missing reported to the caller"
chk $([ "$(provider_calls)" = 0 ] && echo 0 || echo 1) "EB-102 ZERO provider calls when the gate row is missing"
C=$(post "$W" "$DIR/e_norow.json" '{"mode":"enqueue","tier1":true,"tier2":true,"tier3":true}' "$CRONH")
QN=$(psql "$CL" -qXAt -c "SELECT count(*) FROM public.tw_bsr_sync_queue WHERE enqueued_by LIKE 'tier%' AND created_at > now() - interval '1 minute'")
chk $([ "${QN:-1}" = 0 ] && echo 0 || echo 1) "EB-102b enqueue inserted nothing with the gate row missing (${QN:-?})"
psql "$CL" -qX -c "UPDATE public.tw_bsr_sync_config SET key='market_batch' WHERE key='market_batch__hidden'" >/dev/null

# --- B. row present, flag KEY absent -> documented compatibility-OPEN
: >"$DIR/provider.jsonl"
psql "$CL" -qX -c "UPDATE public.tw_bsr_sync_config SET config = config - 'admission_blocked' WHERE key='market_batch'" >/dev/null
C=$(post "$W" "$DIR/w_missing.json" '{"mode":"worker","batch":3,"budget_ms":8000}' "$CRONH")
chk $([ "$C" = 200 ] && echo 0 || echo 1) "EB-103 worker responds 200 when the admission flag key is absent (got $C)"
chk $([ "$(jqf "$DIR/w_missing.json" note)" != '"admission_gate_closed"' ] && echo 0 || echo 1) "EB-103b absent flag key is compatibility-OPEN per 001_stage_b.sql v4 §3"
chk $([ "$(gateblocked)" = 'false' ] && echo 0 || echo 1) "EB-103c absent flag key does not report the gate as blocked"

# --- C. row present, flag value malformed -> DB COALESCEs to false (same rule)
psql "$CL" -qX -c "UPDATE public.tw_bsr_sync_config SET config = config || '{\"admission_blocked\": \"not-a-boolean\"}'::jsonb WHERE key='market_batch'" >/dev/null
: >"$DIR/provider.jsonl"
C=$(post "$W" "$DIR/w_malformed.json" '{"mode":"worker","batch":3,"budget_ms":8000}' "$CRONH")
chk $([ "$C" = 200 ] && echo 0 || echo 1) "EB-104 worker responds 200 on a malformed admission value (got $C)"
chk $([ "$(psql "$CL" -qXAt -c "SELECT public.bsr_admission_status()->>'blocked'")" = 'false' ] && echo 0 || echo 1) "EB-104b malformed value resolves to blocked=false (documented COALESCE)"
chk $([ "$(jqf "$DIR/w_malformed.json" note)" != '"admission_gate_closed"' ] && echo 0 || echo 1) "EB-105 malformed value follows the same compatibility-OPEN rule"
chk $([ "$(jqf "$DIR/w_malformed.json" ok)" = 'true' ] && echo 0 || echo 1) "EB-106 worker stays ok=true under a malformed admission value"

# rpc_error: the status wrapper itself is unavailable -> still fail-closed
psql "$CL" -qX -c "ALTER FUNCTION public.bsr_admission_status() RENAME TO bsr_admission_status_hidden" >/dev/null
: >"$DIR/provider.jsonl"
C=$(post "$W" "$DIR/w_rpcerr.json" '{"mode":"worker","batch":3,"budget_ms":8000}' "$CRONH")
chk $([ "$C" = 200 ] && echo 0 || echo 1) "EB-107 worker survives an admission RPC error (got $C)"
chk $([ "$(provider_calls)" = 0 ] && echo 0 || echo 1) "EB-108 admission RPC error is fail-closed: ZERO provider calls"
chk $([ "$(jqf "$DIR/w_rpcerr.json" claimed)" = '0' ] && echo 0 || echo 1) "EB-109 admission RPC error claims nothing"
psql "$CL" -qX -c "ALTER FUNCTION public.bsr_admission_status_hidden() RENAME TO bsr_admission_status" >/dev/null
open_gate

############################################################ G3. worker fast-exit + retryable provider classes
stage worker_edges
psql "$CL" -qX -c "DELETE FROM public.tw_bsr_sync_queue" >/dev/null
: >"$DIR/provider.jsonl"; echo ok >"$DIR/mock_mode"
C=$(post "$W" "$DIR/w_noclaim.json" '{"mode":"worker","batch":3,"budget_ms":8000}' "$CRONH")
NC=$(jqf "$DIR/w_noclaim.json" claimed)
chk $([ "$C" = 200 ] && echo 0 || echo 1) "EB-110 worker fast-exits with an empty queue (got $C)"
chk $([ "$NC" = '0' ] || [ "$NC" = 'null' ] && echo 0 || echo 1) "EB-111 empty queue claims nothing (claimed=$NC)"
chk $([ "$(jqf "$DIR/w_noclaim.json" note)" = '"no_jobs"' ] && echo 0 || echo 1) "EB-111b empty queue reports note=no_jobs"
chk $([ "$(provider_calls)" = 0 ] && echo 0 || echo 1) "EB-112 empty queue never touches the provider"

for m in rate fail5 net unknown; do
  open_gate
  psql "$CL" -qX -c "DELETE FROM public.tw_bsr_sync_queue" >/dev/null
  psql "$CL" -qX -c "INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, enqueued_by, next_run_at) VALUES ('2330', current_date - 5, 1, 'pending', 'edge_rehearsal_$m', now())" >/dev/null
  echo "$m" >"$DIR/mock_mode"
  C=$(post "$W" "$DIR/w_$m.json" '{"mode":"worker","batch":2,"budget_ms":8000}' "$CRONH")
  chk $([ "$C" = 200 ] && echo 0 || echo 1) "EB-11$m worker survives provider class '$m' (got $C)"
  chk $([ "$(gateblocked)" = 'false' ] && echo 0 || echo 1) "EB-12$m retryable/unknown class '$m' must NOT close the gate"
  ST=$(psql "$CL" -qXAt -c "SELECT status FROM public.tw_bsr_sync_queue WHERE enqueued_by='edge_rehearsal_$m' LIMIT 1")
  chk $([ "$ST" != 'terminal' ] && echo 0 || echo 1) "EB-13$m class '$m' did not terminalize the job (status=$ST)"
done

# lost lease: another worker stole the row mid-flight -> terminalize must not
# resurrect or double-write it
open_gate
psql "$CL" -qX -c "DELETE FROM public.tw_bsr_sync_queue" >/dev/null
psql "$CL" -qX -c "INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, enqueued_by, next_run_at, started_at) VALUES ('2317', current_date - 5, 1, 'processing', 'edge_rehearsal_lease', now(), now())" >/dev/null
LEASE_T0=$(psql "$CL" -qXAt -c "SELECT started_at FROM public.tw_bsr_sync_queue WHERE enqueued_by='edge_rehearsal_lease'")
echo reject >"$DIR/mock_mode"
C=$(post "$W" "$DIR/w_lease.json" '{"mode":"worker","batch":2,"budget_ms":8000}' "$CRONH")
LEASE_ST=$(psql "$CL" -qXAt -c "SELECT status FROM public.tw_bsr_sync_queue WHERE enqueued_by='edge_rehearsal_lease'")
LEASE_T1=$(psql "$CL" -qXAt -c "SELECT started_at FROM public.tw_bsr_sync_queue WHERE enqueued_by='edge_rehearsal_lease'")
chk $([ "$LEASE_ST" = 'processing' ] && [ "$LEASE_T1" = "$LEASE_T0" ] && echo 0 || echo 1) "EB-140 a live foreign lease is never stolen (status=$LEASE_ST started_at_changed=$([ "$LEASE_T1" = "$LEASE_T0" ] && echo no || echo yes))"
chk $([ "$C" = 200 ] && echo 0 || echo 1) "EB-141 worker returns 200 with only foreign-leased rows (got $C)"

############################################################ G4. admin nonce replay / stale version
stage admin_nonce
echo reject >"$DIR/mock_mode"
psql "$CL" -qX -c "INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, enqueued_by, next_run_at) VALUES ('2454', current_date - 5, 1, 'pending', 'edge_rehearsal_nonce', now()) ON CONFLICT DO NOTHING" >/dev/null
post "$W" "$DIR/w_nonce_close.json" '{"mode":"worker","batch":2,"budget_ms":8000}' "$CRONH" >/dev/null
chk $([ "$(gateblocked)" = 'true' ] && echo 0 || echo 1) "EB-150 gate closed again for the nonce tests"
NONCE=$(psql "$CL" -qXAt -c "SELECT config->>'admission_nonce' FROM public.tw_bsr_sync_config WHERE key='market_batch'")
VER=$(psql "$CL" -qXAt -c "SELECT public.bsr_admission_status()->>'version'")
R=$(psql "$CL" -qXAt -c "SELECT public.bsr_unblock_after_probe($((VER - 1)), '$NONCE', 'stale-version-attempt')" 2>&1 || true)
chk $([ "$(gateblocked)" = 'true' ] && echo 0 || echo 1) "EB-151 stale expected_version cannot unblock"
R=$(psql "$CL" -qXAt -c "SELECT public.bsr_unblock_after_probe($VER, '00000000-0000-4000-8000-0000000000ff', 'wrong-nonce-attempt')" 2>&1 || true)
chk $([ "$(gateblocked)" = 'true' ] && echo 0 || echo 1) "EB-152 wrong nonce cannot unblock"
echo ok >"$DIR/mock_mode"
C=$(post "$A" "$DIR/a_ok2.json" '{"action":"probe","stock_id":"2330","trade_date":"2026-08-14"}' "$ADMJWT")
chk $([ "$(gateblocked)" = 'false' ] && echo 0 || echo 1) "EB-153 a verified server-side probe still unblocks (http=$C)"
C=$(post "$A" "$DIR/a_ok2_replay.json" '{"action":"probe","stock_id":"2330","trade_date":"2026-08-14"}' "$ADMJWT")
chk $([ "$(jqf "$DIR/a_ok2_replay.json" transition)" = '"already_open"' ] && echo 0 || echo 1) "EB-154 replayed probe is a no-op"

############################################################ H. rollback fidelity
stage rollback
psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/c/SB/099_rollback.sql >"$DIR/rollback.log" 2>&1 || { tail -20 "$DIR/rollback.log"; fatal rollback; }
psql "$CL" -qXAt -f db/r1/c/SB/sb_fingerprint.sql | sort >"$DIR/fp_post_rollback.txt"
diff -u <(grep -E '^(replmeta|acl|obj)\|' "$DIR/fp_pre_edge.txt") \
        <(grep -E '^(replmeta|acl|obj)\|' "$DIR/fp_post_rollback.txt") >"$DIR/fp_rollback.diff" || true
if [ ! -s "$DIR/fp_rollback.diff" ]; then chk 0 "EB-95 rollback restores metadata/ACL fingerprint byte-for-byte"; else chk 1 "EB-95 rollback restores metadata/ACL fingerprint byte-for-byte" "$(head -10 "$DIR/fp_rollback.diff")"; fi
LEFT=$(psql "$CL" -qXAt -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('bsr_admission_status','bsr_block_and_terminalize_claims','bsr_unblock_after_probe')")
chk $([ "$LEFT" = 0 ] && echo 0 || echo 1) "EB-96 wrappers removed by rollback ($LEFT left)"

############################################################ summary
stage summary
SUMMARY=1
echo "EDGE SUMMARY run_id=$RUNID checks=$CHECKS failures=$FAILS"
