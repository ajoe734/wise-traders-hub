#!/usr/bin/env bash
# =====================================================================
# Real PostgREST HTTP proof against a disposable clone (no SET ROLE
# impersonation). Proves, over the wire, with signed JWTs:
#   service_role  -> POST /rpc/bsr_admission_status            == 200
#   anon          -> POST /rpc/bsr_admission_status            != 2xx
#   authenticated -> POST /rpc/bsr_admission_status            != 2xx
#   any role      -> private_bsr schema unreachable (404 / PGRST106)
# Usage: sb_postgrest_proof.sh <clone-uri> <http-port> <outdir>
# Exits non-zero on any failed expectation. Never contacts production.
# =====================================================================
set -Eeuo pipefail
CL=$1; HP=${2:-3999}; OUT=${3:-/tmp/sb-pgrst}
mkdir -p "$OUT"
SECRET='clone-only-rehearsal-jwt-secret-0123456789abcdef'
PGRST_BIN=${PGRST_BIN:-}
if [ -z "$PGRST_BIN" ]; then PGRST_BIN=$(command -v postgrest || true); fi
if [ -z "$PGRST_BIN" ]; then
  PGRST_BIN=$(ls -d /nix/store/*postgrest*-bin/bin/postgrest 2>/dev/null | head -1 || true)
fi
if [ -z "$PGRST_BIN" ]; then echo "PGRST_MISSING"; exit 3; fi

cat >"$OUT/pgrst.conf" <<EOF
db-uri = "$CL"
db-schemas = "public"
db-anon-role = "anon"
db-pool = 4
server-port = $HP
server-host = "127.0.0.1"
jwt-secret = "$SECRET"
db-use-legacy-gucs = false
EOF

"$PGRST_BIN" "$OUT/pgrst.conf" >"$OUT/pgrst.log" 2>&1 &
PID=$!
trap 'kill -9 $PID 2>/dev/null || true' EXIT
for i in $(seq 1 60); do
  curl -sf -o /dev/null "http://127.0.0.1:$HP/" && break; sleep 0.5
done
curl -sf -o /dev/null "http://127.0.0.1:$HP/" || { tail -20 "$OUT/pgrst.log"; echo "PGRST_NOT_READY"; exit 4; }

python3 - "$HP" "$SECRET" "$OUT" <<'PY'
import base64, hashlib, hmac, json, sys, urllib.request, urllib.error
port, secret, out = sys.argv[1], sys.argv[2], sys.argv[3]
b64=lambda b: base64.urlsafe_b64encode(b).rstrip(b'=')
def jwt(role):
    h=b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
    p=b64(json.dumps({"role":role,"exp":4102444800},separators=(',',':')).encode())
    s=b64(hmac.new(secret.encode(), h+b'.'+p, hashlib.sha256).digest())
    return (h+b'.'+p+b'.'+s).decode()
def call(path, role, headers=None):
    req=urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=b'{}', method='POST')
    req.add_header('Content-Type','application/json')
    req.add_header('Authorization','Bearer '+jwt(role))
    for k,v in (headers or {}).items(): req.add_header(k,v)
    try:
        with urllib.request.urlopen(req) as r: return r.status, r.read().decode()[:200]
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:200]
    except Exception as e: return -1, str(e)[:200]

rows=[]
def chk(cid, ok, note): rows.append((("PASS" if ok else "FAIL"), cid, note))

st,b = call('/rpc/bsr_admission_status','service_role')
chk('HTTP-01 service_role rpc 200', st==200 and 'blocked' in b, f'status={st} body={b}')
st,b = call('/rpc/bsr_admission_status','anon')
chk('HTTP-02 anon denied', st not in (200,201,204), f'status={st} body={b}')
st,b = call('/rpc/bsr_admission_status','authenticated')
chk('HTTP-03 authenticated denied', st not in (200,201,204), f'status={st} body={b}')
st,b = call('/rpc/gate_blocked','service_role')
chk('HTTP-04 private impl not exposed in public', st==404, f'status={st} body={b}')
st,b = call('/rpc/gate_blocked','service_role',{'Content-Profile':'private_bsr','Accept-Profile':'private_bsr'})
chk('HTTP-05 private_bsr schema unreachable', st!=200 and ('PGRST106' in b or st in (404,406,400)), f'status={st} body={b}')
st,b = call('/rpc/bsr_block_and_terminalize_claims','anon')
chk('HTTP-06 anon cannot terminalize', st not in (200,201,204), f'status={st} body={b}')
st,b = call('/rpc/bsr_unblock_after_probe','authenticated')
chk('HTTP-07 authenticated cannot unblock', st not in (200,201,204), f'status={st} body={b}')

with open(out+'/http_proof.txt','w') as f:
    for ok,cid,note in rows: f.write(f"{ok} {cid}  -- {note}\n")
fails=sum(1 for ok,_,_ in rows if ok=='FAIL')
print(open(out+'/http_proof.txt').read())
print(f"HTTP SUMMARY pass={len(rows)-fails} fail={fails}")
sys.exit(1 if fails else 0)
PY
