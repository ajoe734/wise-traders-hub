#!/usr/bin/env bash
# E0 concurrency evidence (needs 2 real sessions, so it lives outside psql).
# Usage: PGHOST=... PGPORT=... PGUSER=postgres PGSSLMODE=disable ./60_concurrency.sh e0
set -u
DB="${1:-e0}"
A=aaaaaaaa-0000-0000-0000-000000000001
B=bbbbbbbb-0000-0000-0000-000000000002

rec() { # name passed detail expected_sqlstate actual_sqlstate needle
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -c \
    "INSERT INTO t.result(name,passed,detail,kind,expected_sqlstate,actual_sqlstate,expected_needle)
     VALUES ('$1', $2, \$d\$$3\$d\$, '$4', $5, $6, $7)" >/dev/null
}

# session 1 holds the per-expert advisory lock for 5s inside canonical_publish
psql -q -d "$DB" -c "BEGIN; SELECT app_ledger.canonical_publish('$A'::uuid, DATE '2026-08-07');
                     SELECT pg_sleep(5); COMMIT;" >/dev/null 2>&1 &
S1=$!
sleep 1

# (1) NEGATIVE: same expert, second session must not get the lock -> lock_timeout 55P03
OUT=$(psql -q -d "$DB" -v ON_ERROR_STOP=1 \
  -c "SET lock_timeout='500ms'" \
  -c "SELECT app_ledger.canonical_publish('$A'::uuid, DATE '2026-08-07')" 2>&1)
STATE=$(psql -q -d "$DB" -tAc "SET lock_timeout='500ms';
  DO \$\$ BEGIN
    PERFORM app_ledger.canonical_publish('$A'::uuid, DATE '2026-08-07');
    RAISE EXCEPTION 'no_error' USING ERRCODE='P0002';
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t.result(name,passed,detail,kind,expected_sqlstate,actual_sqlstate,expected_needle)
    SELECT 'NEG.concurrency.same_expert_publish_serialised',
           SQLSTATE = '55P03', SQLSTATE||': '||SQLERRM, 'negative','55P03',SQLSTATE,'lock timeout';
  END \$\$;" 2>&1)

# (2) POSITIVE: different expert must NOT be blocked (< 2s while A is locked for 5s)
T0=$(date +%s%N)
psql -q -d "$DB" -tAc "SELECT app_ledger.canonical_publish('$B'::uuid, DATE '2026-08-07')" >/dev/null 2>&1
T1=$(date +%s%N)
MS=$(( (T1-T0)/1000000 ))
rec "POS.concurrency.other_expert_not_blocked" "$( [ $MS -lt 2000 ] && echo true || echo false )" \
    "elapsed_ms=$MS while expert A holds its publish lock" "assert" NULL NULL NULL

wait $S1
# (3) after contention the pointer is the max materialised version, no interleaving
psql -q -d "$DB" -c "INSERT INTO t.result(name,passed,detail,kind)
  SELECT 'POS.concurrency.pointer_is_max_version',
         bool_and(a.active_version = m.mx), string_agg(a.expert_id||'=v'||a.active_version,' '),
         'assert'
    FROM public.public_projection_active a
    JOIN (SELECT expert_id, max(projection_version) mx
            FROM public.public_position_projection GROUP BY 1) m USING (expert_id)" >/dev/null
echo "concurrency: lock_timeout_probe_done elapsed_other_expert_ms=$MS"
