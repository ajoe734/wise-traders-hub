#!/usr/bin/env bash
# S3B C1 clone acceptance. Usage: db/r1/c/C1/run_clone_tests.sh <clone-url>
set -uo pipefail
CL=${1:?clone url}
D=db/r1/c/C1
P=0; F=0
ok(){ echo "PASS $1"; P=$((P+1)); }
no(){ echo "FAIL $1 :: $2"; F=$((F+1)); }
q(){ psql "$CL" -At -X -c "$1"; }

snap(){ q "select (select version from public.tw_bsr_sync_config where key='market_batch')||'|'||(select md5(config::text) from public.tw_bsr_sync_config where key='market_batch')||'|'||(select count(*) from public.audit_logs)||'|'||(select count(*) from public.tw_bsr_degrade_events)||'|'||(select count(*) from public.tw_bsr_sync_queue)||'|'||coalesce((select md5(string_agg(id||':'||status||':'||coalesce(last_error,'-'),',' order by id)) from public.tw_bsr_sync_queue),'-')"; }

echo "== C1-T0 baseline (seeded v7 preimage) =="
B=$(snap); echo "snap_before=$B"
[ "${B%%|*}" = "7" ] && ok "T0 version=7" || no "T0" "$B"
echo "$B" | cut -d'|' -f2 | grep -q '^dd747a45d3e46b2acc3f0c021bc269f8$' && ok "T0 preimage md5" || no "T0 md5" "$B"

echo "== C1-T1 exact v7+hash CAS success =="
psql "$CL" -qX -v ON_ERROR_STOP=1 -f "$D/001_c1_canonical_v8.sql" >/tmp/c1_t1.log 2>&1
E1=$?; echo "apply_exit=$E1"; [ $E1 -eq 0 ] && ok "T1 apply exit 0" || no "T1 apply" "$(tail -3 /tmp/c1_t1.log)"
A=$(snap); echo "snap_after=$A"
IFS='|' read -r av _ aa ad aq ah <<<"$A"; IFS='|' read -r bv _ ba bd bq bh <<<"$B"
[ "$av" = "8" ] && ok "T1 version 7->8" || no "T1 version" "$av"
[ $((aa-ba)) -eq 1 ] && ok "T1 audit +1" || no "T1 audit" "$((aa-ba))"
[ $((ad-bd)) -eq 1 ] && ok "T1 degrade +1" || no "T1 degrade" "$((ad-bd))"
[ "$aq" = "$bq" ] && [ "$ah" = "$bh" ] && ok "T1 queue 0 delta" || no "T1 queue" "$aq/$bq"

echo "-- canonical payload --"
q "select jsonb_pretty(config) from public.tw_bsr_sync_config where key='market_batch'"
CK=$(q "select string_agg(k,',' order by k) from jsonb_object_keys((select config from public.tw_bsr_sync_config where key='market_batch')) k")
echo "keys=$CK"
[ "$(echo "$CK" | tr ',' '\n' | wc -l)" = "16" ] && ok "T1 16 keys (9 legacy + 7 admission)" || no "T1 keycount" "$CK"
q "select case when config->>'admission_reason'='provider_plan_rejected'
       and config->>'admission_terminal_code'='bsr_provider_unsupported'
       and (config->'admission_blocked')='true'::jsonb
       and config->>'probed_at'='2026-08-17T13:30:58.060Z'
       and config->>'last_probe_at'='2026-08-17T13:30:58.060Z'
       and config->>'last_probe_error'='provider_plan_rejected:http_400'
       and config->'admission_evidence' = '{\"schema_version\":1,\"provider\":\"finmind\",\"observed_at\":\"2026-08-17T13:30:58.060Z\",\"http_status\":400,\"outcome\":\"unsupported_plan\",\"decided_by\":\"s3b_c1_migration\"}'::jsonb
       and config->>'admission_run_id' ~ '^[0-9a-f-]{36}$'
       and config->>'admission_nonce' ~ '^[0-9a-f-]{36}$'
       and config->>'admission_blocked_at' ~ '^2[0-9]{3}-'
      then 'CONTRACT_OK' else 'CONTRACT_BAD' end from public.tw_bsr_sync_config where key='market_batch'" | grep -q CONTRACT_OK \
  && ok "T1 canonical v8 exact contract" || no "T1 contract" "$(q "select config from public.tw_bsr_sync_config where key='market_batch'")"
q "select 'sanitized_ok' from (select private_bsr.assert_sanitized(config,0) from public.tw_bsr_sync_config where key='market_batch') s" | grep -q sanitized_ok && ok "T1 assert_sanitized" || no "T1 sanitized" ""
q "select 'no_raw' where not exists (select 1 from public.tw_bsr_sync_config where key='market_batch' and config::text ~* '(token_tail|finmindtrade|https?://)')" | grep -q no_raw && ok "T1 no raw/url/token leak" || no "T1 leak" ""
echo "-- audit/degrade rows --"
q "select action, detail->>'terminal_code', detail->>'gate_version' from public.audit_logs order by created_at desc limit 1"
q "select from_mode, to_mode, reason, detail->>'terminal_code' from public.tw_bsr_degrade_events order by created_at desc limit 1"
q "select case when from_mode='legacy_config_missing' and to_mode='admission_blocked' and reason='provider_plan_rejected' then 'DEG_OK' else 'DEG_BAD' end from public.tw_bsr_degrade_events order by created_at desc limit 1" | grep -q DEG_OK && ok "T1 degrade modes" || no "T1 degrade modes" ""

echo "== C1-T2 rerun true no-op =="
R=$(snap)
psql "$CL" -qX -v ON_ERROR_STOP=1 -f "$D/001_c1_canonical_v8.sql" >/tmp/c1_t2.log 2>&1; E2=$?
grep -q 'c1_noop' /tmp/c1_t2.log && ok "T2 noop notice" || no "T2 notice" "$(tail -3 /tmp/c1_t2.log)"
R2=$(snap); [ $E2 -eq 0 ] && [ "$R" = "$R2" ] && ok "T2 0 delta (exit $E2)" || no "T2" "$R vs $R2"

echo "== C1-T3/T4/T5 negative: wrong version / wrong hash / malformed =="
for T in "T3 wrong_version:update public.tw_bsr_sync_config set version=9, config=config-'admission_blocked' where key='market_batch'" \
         "T4 wrong_hash:update public.tw_bsr_sync_config set version=7, config=(config-'admission_blocked')||'{\"enabled\":false}'::jsonb where key='market_batch'" \
         "T5 malformed:update public.tw_bsr_sync_config set version=7, config='[]'::jsonb where key='market_batch'" \
         "T6 row_missing:delete from public.tw_bsr_sync_config where key='market_batch'"; do
  NAME=${T%%:*}; SQL=${T#*:}
  OUT=$(psql "$CL" -qX <<SQL2 2>&1
BEGIN;
$SQL;
\i $D/part1_cas.sql
ROLLBACK;
SQL2
)
  echo "$OUT" | grep -q 'ERROR:  c1_' && ok "$NAME raises $(echo "$OUT"|grep -o 'c1_[a-z_]*'|head -1)" || no "$NAME" "$(echo "$OUT"|tail -2)"
  S=$(snap); [ "$S" = "$R2" ] && ok "$NAME 0 delta after rollback" || no "$NAME delta" "$S"
done

echo "== C1-T7 concurrency: only one transition =="
psql "$CL" -qX -v ON_ERROR_STOP=1 -c "delete from public.tw_bsr_sync_config_history where key='market_batch'" >/dev/null
psql "$CL" -qX -v ON_ERROR_STOP=1 -f "$D/seed_preimage.sql" >/dev/null
q "select 'reseed_md5='||md5(config::text)||' v'||version from public.tw_bsr_sync_config where key='market_batch'"
CB=$(snap)
( psql "$CL" -qX <<SQL3 >/tmp/c1_cc_a.log 2>&1
BEGIN;
\i $D/part1_cas.sql
select pg_sleep(3);
COMMIT;
SQL3
) &
sleep 1
psql "$CL" -qX -f "$D/part1_cas.sql" >/tmp/c1_cc_b.log 2>&1; EB=$?
wait
CA=$(snap)
IFS='|' read -r cv _ ca cd _ _ <<<"$CA"; IFS='|' read -r _ _ cba cbd _ _ <<<"$CB"
grep -q 'c1_noop' /tmp/c1_cc_b.log && ok "T7 loser = no-op" || no "T7 loser" "$(tail -2 /tmp/c1_cc_b.log)"
[ "$cv" = "8" ] && [ $((ca-cba)) -eq 1 ] && [ $((cd-cbd)) -eq 1 ] && ok "T7 exactly one transition (v=$cv audit+$((ca-cba)) degrade+$((cd-cbd)))" || no "T7" "$CB -> $CA"

echo "== C1-T8..T11 wrapper contract =="
q "select 'sig='||p.oid::regprocedure::text||' ret='||pg_get_function_result(p.oid)||' secdef='||p.prosecdef::text||' vol='||p.provolatile::text||' cfg='||coalesce(p.proconfig::text,'-')||' owner='||pg_get_userbyid(p.proowner)||' acl='||md5(coalesce(p.proacl::text,'')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='bsr_block_and_terminalize_claims'"
WACL=$(q "select md5(coalesce(proacl::text,'')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='bsr_block_and_terminalize_claims'")
[ "$WACL" = "$(cat /tmp/c1_wacl_before.txt 2>/dev/null)" ] && ok "T8 wrapper ACL unchanged" || no "T8 ACL" "$WACL vs $(cat /tmp/c1_wacl_before.txt 2>/dev/null)"
q "select case when count(*)=1 then 'NO_OVERLOAD' else 'OVERLOAD:'||count(*) end from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='bsr_block_and_terminalize_claims'" | grep -q NO_OVERLOAD && ok "T8 single OID no overload" || no "T8 overload" ""

OUT=$(psql "$CL" -qX -At <<SQL4 2>&1
BEGIN;
update public.tw_bsr_sync_config set config = config || '{"admission_blocked": false}'::jsonb where key='market_batch';
select 'legacy_input=' || public.bsr_block_and_terminalize_claims(gen_random_uuid(), '{}'::bigint[], '{}'::timestamptz[], '{}'::int[], 'finmind_admission_provider_plan_rejected', '{"schema_version":1,"provider":"finmind"}'::jsonb)::text;
select 'stored_code=' || (config->>'admission_terminal_code') || ' stored_reason=' || (config->>'admission_reason') from public.tw_bsr_sync_config where key='market_batch';
select 'audit_code=' || (detail->>'terminal_code') || ' src=' || coalesce(detail->>'source_event','-') from public.audit_logs order by created_at desc limit 1;
ROLLBACK;
SQL4
)
echo "$OUT"
echo "$OUT" | grep -q '"terminal_code": "bsr_provider_unsupported"' && ok "T9 body terminal_code = DB code" || no "T9 body" "$OUT"
echo "$OUT" | grep -q 'stored_code=bsr_provider_unsupported stored_reason=provider_plan_rejected' && ok "T9 stored config canonical" || no "T9 stored" "$OUT"
echo "$OUT" | grep -q 'audit_code=bsr_provider_unsupported src=finmind_admission_provider_plan_rejected' && ok "T9 audit canonical + source preserved" || no "T9 audit" "$OUT"
echo "$OUT" | grep -q "legacy_input=" && ok "T9 legacy source input still accepted" || no "T9 legacy input" "$OUT"

OUT=$(psql "$CL" -qX -At -c "select public.bsr_block_and_terminalize_claims(gen_random_uuid(),'{}'::bigint[],'{}'::timestamptz[],'{}'::int[],'bsr_provider_unsupported','{}'::jsonb)" 2>&1)
echo "$OUT" | grep -q 'terminal_code_not_allowed: bsr_provider_unsupported' && ok "T10 DB code as input still rejected (no widening)" || no "T10" "$OUT"
OUT=$(psql "$CL" -qX -At -c "select public.bsr_block_and_terminalize_claims(gen_random_uuid(),'{}'::bigint[],'{}'::timestamptz[],'{}'::int[],'whatever','{}'::jsonb)" 2>&1)
echo "$OUT" | grep -q 'terminal_code_not_allowed: whatever' && ok "T10 arbitrary code rejected" || no "T10b" "$OUT"

NB=$(snap)
OUT=$(psql "$CL" -qX -At -c "select public.bsr_block_and_terminalize_claims(gen_random_uuid(),'{}'::bigint[],'{}'::timestamptz[],'{}'::int[],'finmind_admission_provider_plan_rejected','{\"schema_version\":1}'::jsonb)" 2>&1)
echo "$OUT"
NA=$(snap)
echo "$OUT" | grep -q '"transition": "already_blocked"' && [ "$NB" = "$NA" ] && ok "T11 canonical already-blocked no-op, 0 delta" || no "T11" "$OUT / $NB vs $NA"

echo "== C1-T12 S3B-A regression (gate helpers + ingest_allowed) =="
q "select 'ingest_allowed='||private_bsr.ingest_allowed()::text" | grep -q 'ingest_allowed=false' && ok "T12 ingest_allowed false under canonical block" || no "T12" ""
psql "$CL" -qX -c "delete from public.tw_bsr_sync_config_history where key='market_batch'" >/dev/null
for t in supabase/tests/bsr_gate_helper_acl_test.sql supabase/tests/bsr_queue_selector_test.sql supabase/tests/bsr_gate_ingest_allowed_test.sql supabase/tests/bsr_ingest_suppression_test.sql; do [ -f "$t" ] || continue; psql "$CL" -qX -f "$t" >/tmp/c1_reg_$(basename $t).log 2>&1 && ok "T12 $(basename $t)" || no "T12 $(basename $t)" "$(tail -2 /tmp/c1_reg_$(basename $t).log)"; done
q "select 'public_create '||r||'='||has_schema_privilege(r,'public','CREATE')::text from unnest(array['anon','authenticated','service_role']) r"
q "select 'private_bsr_usage '||r||'='||has_schema_privilege(r,'private_bsr','USAGE')::text from unnest(array['anon','authenticated','service_role']) r"
q "select case when bool_or(has_schema_privilege(r,'public','CREATE')) or bool_or(has_schema_privilege(r,'private_bsr','USAGE')) then 'PRIV_BAD' else 'PRIV_OK' end from unnest(array['anon','authenticated','service_role']) r" | grep -q PRIV_OK && ok "T12 no public CREATE / private_bsr USAGE" || no "T12 priv" ""

echo
echo "RESULT pass=$P fail=$F"
[ $F -eq 0 ]
