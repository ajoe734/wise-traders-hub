#!/usr/bin/env bash
# =====================================================================
# R1-D 091 CONCURRENCY — two REAL psql sessions, no sleep-only evidence.
# Proves: same-expert serialization (blocked pid observed in pg_locks),
#         different-expert parallelism, retry/publish interleave,
#         batch vs single interleave, admin reconcile vs publish,
#         and non-superuser role boundary (S5).
# Usage: db/r1/d/091_concurrency.sh <port> <outdir>
# =====================================================================
set -uo pipefail
PORT=${1:?port}; OUT=${2:-/tmp/r1d-conc}; mkdir -p "$OUT"
CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"
q() { psql "$CL" -tAqX -c "$1"; }
say() { echo "$@" | tee -a "$OUT/evidence.txt"; }
: > "$OUT/evidence.txt"

EXPA=bbbbbbb1-0000-4000-8000-000000000001
EXPB=bbbbbbb1-0000-4000-8000-000000000002
USERA=aaaaaaa1-0000-4000-8000-000000000001
ADMIN=aaaaaaa1-0000-4000-8000-0000000000ad

mksig() { # id expert instrument qty status
  q "INSERT INTO public.expert_signals(id,expert_id,batch_id,instrument,action,quantity,
        quantity_unit,price_hint,status,executed_at,published_at,created_at)
     VALUES ('$1','$2','ccccccc1-0000-4000-8000-000000000001','$3','buy',$4,'張',100,
             '$5'::public.signal_status, now(), now(), now())
     ON CONFLICT (id) DO NOTHING" >/dev/null
}

fail=0
check() { if [ "$2" = "$3" ]; then say "PASS $1 ($2)"; else say "FAIL $1 got=$2 want=$3"; fail=$((fail+1)); fi; }

# --------------------------------------------------------------- S1 same expert serializes
say "== S1 same-expert serialization =="
S1A=$OUT/s1a.txt; S1B=$OUT/s1b.txt
( psql "$CL" -tAqX -v ON_ERROR_STOP=0 <<SQL > "$S1A" 2>&1
\timing on
SELECT pg_backend_pid() AS pid_a;
BEGIN;
SELECT app_ledger.lock_expert('$EXPA');
SELECT pg_sleep(2);
COMMIT;
SQL
) &
PA=$!
sleep 0.7
( psql "$CL" -tAqX -v ON_ERROR_STOP=0 <<SQL > "$S1B" 2>&1
\timing on
SELECT pg_backend_pid() AS pid_b;
BEGIN;
SELECT app_ledger.lock_expert('$EXPA');
SELECT 'B acquired' AS marker;
COMMIT;
SQL
) &
PB=$!
sleep 1.0
BLOCKED=$(q "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
             WHERE l.locktype='advisory' AND NOT l.granted")
WAITERS=$(q "SELECT string_agg(pid::text||':'||coalesce(wait_event_type,'-'),',')
             FROM pg_stat_activity WHERE wait_event_type='Lock'")
wait $PA $PB
say "blocked_advisory_locks_observed=$BLOCKED waiters=[$WAITERS]"
say "session A: $(grep -c . "$S1A") lines / session B blocked-then-acquired:"
grep -E 'acquired|Time:' "$S1B" | tail -3 | tee -a "$OUT/evidence.txt"
check "S1 second session blocked on the same expert" "$([ "$BLOCKED" -ge 1 ] && echo yes || echo no)" yes

# --------------------------------------------------------------- S2 different experts parallel
say "== S2 different-expert parallelism =="
T0=$(date +%s.%N)
( psql "$CL" -tAqX -c "BEGIN; SELECT app_ledger.lock_expert('$EXPA'); SELECT pg_sleep(1.5); COMMIT;" >/dev/null 2>&1 ) &
( psql "$CL" -tAqX -c "BEGIN; SELECT app_ledger.lock_expert('$EXPB'); SELECT pg_sleep(1.5); COMMIT;" >/dev/null 2>&1 ) &
wait
T1=$(date +%s.%N)
EL=$(echo "$T1 - $T0" | bc)
say "elapsed_parallel=${EL}s (serial would exceed 3.0s)"
check "S2 different experts run in parallel" "$(echo "$EL < 2.6" | bc)" 1

# --------------------------------------------------------------- S3 same signal concurrent insert
say "== S3 same signal concurrent insert/update -> single logical effect =="
SIG=ddddddd1-0000-4000-8000-00000000e001
( psql "$CL" -tAqX -c "SELECT set_config('request.jwt.claim.sub','$USERA',false);
   INSERT INTO public.expert_signals(id,expert_id,batch_id,instrument,action,quantity,quantity_unit,
     price_hint,status,executed_at,published_at,created_at)
   VALUES ('$SIG','$EXPA','ccccccc1-0000-4000-8000-000000000001','2330','buy',4,'張',100,
     'published'::public.signal_status,now(),now(),now()) ON CONFLICT (id) DO NOTHING" >"$OUT/s3a.txt" 2>&1 ) &
( psql "$CL" -tAqX -c "SELECT set_config('request.jwt.claim.sub','$USERA',false);
   INSERT INTO public.expert_signals(id,expert_id,batch_id,instrument,action,quantity,quantity_unit,
     price_hint,status,executed_at,published_at,created_at)
   VALUES ('$SIG','$EXPA','ccccccc1-0000-4000-8000-000000000001','2330','buy',4,'張',100,
     'published'::public.signal_status,now(),now(),now()) ON CONFLICT (id) DO NOTHING" >"$OUT/s3b.txt" 2>&1 ) &
wait
N_EFF=$(q "SELECT count(*) FROM app_ledger.effect_key WHERE origin_signal_id='$SIG' AND state='applied'")
N_EVT=$(q "SELECT count(*) FROM app_ledger.economic_effect WHERE origin_signal_id='$SIG'")
say "effect_keys=$N_EFF economic_effects=$N_EVT"
check "S3 exactly one logical effect" "$N_EFF" 1
check "S3 exactly one economic event" "$N_EVT" 1

# --------------------------------------------------------------- S4 pending->published vs retry
say "== S4 pending(executed_at) -> published interleaved with retry =="
SIG2=ddddddd1-0000-4000-8000-00000000e002
mksig "$SIG2" "$EXPB" 2317 3 pending
Q_BEFORE=$(q "SELECT coalesce(sum(quantity),0) FROM public.trade_records WHERE signal_id='$SIG2'")
( psql "$CL" -tAqX -c "UPDATE public.expert_signals SET status='published'::public.signal_status WHERE id='$SIG2'" >/dev/null 2>&1 ) &
( psql "$CL" -tAqX -c "UPDATE public.expert_signals SET reason_summary='retry' WHERE id='$SIG2'" >/dev/null 2>&1 ) &
wait
Q_AFTER=$(q "SELECT coalesce(sum(quantity),0) FROM public.trade_records WHERE signal_id='$SIG2'")
VIS=$(q "SELECT count(*) FROM app_ledger.economic_effect WHERE origin_signal_id='$SIG2' AND visible_at IS NOT NULL")
say "qty_before=$Q_BEFORE qty_after=$Q_AFTER visible_effects=$VIS"
check "S4 publish does not re-apply economics" "$Q_AFTER" "$Q_BEFORE"

# --------------------------------------------------------------- S4b batch vs single
say "== S4b save_signal_batch vs single insert interleave =="
SIGB=ddddddd1-0000-4000-8000-00000000e003
( psql "$CL" -tAqX -c "SELECT set_config('request.jwt.claim.sub','$USERA',false);
   SELECT public.save_signal_batch('$EXPA','ccccccc1-0000-4000-8000-0000000000b1',
     jsonb_build_array(jsonb_build_object('id','$SIGB','expert_id','$EXPA',
       'batch_id','ccccccc1-0000-4000-8000-0000000000b1','instrument','2454','action','buy',
       'quantity',1,'quantity_unit','張','price_hint',600,'executed_at',now(),'status','published')))"
  >"$OUT/s4b_batch.txt" 2>&1 ) &
( psql "$CL" -tAqX -c "UPDATE public.expert_signals SET reason_summary='parallel'
    WHERE id='$SIG'" >"$OUT/s4b_single.txt" 2>&1 ) &
wait
NB=$(q "SELECT count(*) FROM app_ledger.effect_key WHERE origin_signal_id='$SIGB' AND state='applied'")
check "S4b batch path applies exactly once" "$NB" 1

# --------------------------------------------------------------- S4c admin reconcile vs publish
say "== S4c admin reconcile vs publish =="
( psql "$CL" -tAqX -c "SELECT set_config('request.jwt.claim.sub','$ADMIN',false);
   SELECT public.trade_dedupe_sweep(true)" >"$OUT/s4c_admin.txt" 2>&1 ) &
( psql "$CL" -tAqX -c "UPDATE public.expert_signals SET status='published'::public.signal_status
    WHERE id='$SIG2'" >"$OUT/s4c_pub.txt" 2>&1 ) &
wait
DUP=$(q "SELECT count(*) FROM (SELECT expert_id,instrument_key FROM public.trade_records
         WHERE status='open'::public.trade_status
           AND expert_id IN ('$EXPA','$EXPB')
           AND signal_id IN ('$SIG','$SIG2','$SIGB')
         GROUP BY 1,2 HAVING count(*)>1) x")
check "S4c no duplicate open rows after interleave" "$DUP" 0

# --------------------------------------------------------------- S5 non-superuser role boundary
say "== S5 non-superuser sessions (real role boundary, no superuser bypass) =="
for R in anon authenticated service_role; do
  psql "postgresql://$R@localhost:$PORT/clone?sslmode=disable" -tAqX -c "select 1" >/dev/null 2>&1 \
    || psql "$CL" -tAqX -c "ALTER ROLE $R LOGIN" >/dev/null
done
for R in anon authenticated service_role; do
  RC=$(psql "postgresql://$R@localhost:$PORT/clone?sslmode=disable" -tAqX \
        -c "INSERT INTO public.trade_records(id,expert_id,instrument,quantity,quantity_unit,market,
              currency,entry_price,status,entry_date,created_at)
            VALUES (gen_random_uuid(),'$EXPA','2330',1,'張','tw_stock','TWD',1,
              'open'::public.trade_status,now(),now())" 2>&1 | head -2)
  say "  $R raw INSERT trade_records -> $(echo "$RC" | tr '\n' ' ')"
  check "S5 $R cannot raw-insert trade_records" "$(echo "$RC" | grep -qi 'permission denied' && echo denied || echo allowed)" denied
  RC=$(psql "postgresql://$R@localhost:$PORT/clone?sslmode=disable" -tAqX \
        -c "SET ROLE ledger_owner" 2>&1 | head -1)
  check "S5 $R cannot SET ROLE ledger_owner" "$(echo "$RC" | grep -qi 'permission denied' && echo denied || echo allowed)" denied
  RC=$(psql "postgresql://$R@localhost:$PORT/clone?sslmode=disable" -tAqX \
        -c "SET ROLE wrapper_owner" 2>&1 | head -1)
  check "S5 $R cannot SET ROLE wrapper_owner" "$(echo "$RC" | grep -qi 'permission denied' && echo denied || echo allowed)" denied
  RC=$(psql "postgresql://$R@localhost:$PORT/clone?sslmode=disable" -tAqX \
        -c "SELECT app_ledger.canonical_apply_signal('$SIG')" 2>&1 | head -1)
  check "S5 $R cannot EXECUTE canonical" "$(echo "$RC" | grep -qiE 'permission denied' && echo denied || echo allowed)" denied
  RC=$(psql "postgresql://$R@localhost:$PORT/clone?sslmode=disable" -tAqX \
        -c "INSERT INTO app_ledger.effect_projection_mutation(mutation_id,event_id,target_table,op,
              target_row_id,before_hash,after_hash,consumed)
            VALUES (gen_random_uuid(),gen_random_uuid(),'trade_records','insert',
                    gen_random_uuid(),NULL,'forged',false)" 2>&1 | head -1)
  check "S5 $R cannot forge a mutation token" "$(echo "$RC" | grep -qi 'permission denied' && echo denied || echo allowed)" denied
done
for R in anon authenticated service_role; do psql "$CL" -tAqX -c "ALTER ROLE $R NOLOGIN" >/dev/null; done

# --------------------------------------------------------------- price whitelist negatives
say "== S6 price whitelist =="
PW=$(psql "$CL" -tAqX -v ON_ERROR_STOP=1 -c "SELECT set_config('request.jwt.claim.sub','$ADMIN',false);
   SELECT public.upsert_current_price('sync', jsonb_build_array(jsonb_build_object(
     'trade_record_id',(SELECT id FROM public.trade_records LIMIT 1),'current_price',1,
     'quantity',999)))" 2>&1 || true)
check "S6 qty mutation via price sync rejected" \
  "$(echo "$PW" | grep -q 'price_field_not_whitelisted' && echo rejected || echo allowed)" rejected

# --------------------------------------------------------------- final row counts + hashes
say "== final state =="
q "SELECT 'trade_records='||count(*) FROM public.trade_records" | tee -a "$OUT/evidence.txt"
q "SELECT 'economic_effect='||count(*) FROM app_ledger.economic_effect" | tee -a "$OUT/evidence.txt"
q "SELECT 'effect_key='||count(*) FROM app_ledger.effect_key" | tee -a "$OUT/evidence.txt"
psql "$CL" -tAqXf db/r1/d/095_hashes.sql | tee "$OUT/hash_after_concurrency.txt" >> "$OUT/evidence.txt"
say "CONCURRENCY_FAILURES=$fail"
exit $fail
