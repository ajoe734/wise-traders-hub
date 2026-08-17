\pset pager off
\pset tuples_only on
\pset format unaligned
with t(n) as (values ('experts'),('expert_signals'),('expert_signal_legs'),('trade_records'),('signal_trade_applications'),('user_performances'),('holdings_fix_proposals'))
select 'COLS|'||t.n||'|'||md5(string_agg(c.column_name||':'||c.data_type||':'||c.is_nullable||':'||coalesce(c.column_default,'-'),'|' order by c.column_name))
from t join information_schema.columns c on c.table_schema='public' and c.table_name=t.n group by t.n order by 1;
select 'CONS|'||rel.relname||'|'||md5(string_agg(con.conname||'='||pg_get_constraintdef(con.oid),'|' order by con.conname))
from pg_constraint con join pg_class rel on rel.oid=con.conrelid join pg_namespace ns on ns.oid=rel.relnamespace
where ns.nspname='public' and rel.relname in ('experts','expert_signals','expert_signal_legs','trade_records','signal_trade_applications','user_performances','holdings_fix_proposals')
group by rel.relname order by 1;
select 'IDX|'||tablename||'|'||md5(string_agg(replace(indexdef,chr(10),' '),'|' order by indexname))
from pg_indexes where schemaname='public' and tablename in ('experts','expert_signals','expert_signal_legs','trade_records','signal_trade_applications','user_performances','holdings_fix_proposals')
group by tablename order by 1;
select 'TRG|'||c.relname||'|'||tg.tgname||'|'||md5(replace(pg_get_triggerdef(tg.oid),chr(10),' '))
from pg_trigger tg join pg_class c on c.oid=tg.tgrelid join pg_namespace n on n.oid=c.relnamespace
where not tg.tgisinternal and n.nspname='public' and c.relname in ('experts','expert_signals','expert_signal_legs','trade_records','signal_trade_applications','user_performances','holdings_fix_proposals')
order by 1;
select 'POL|'||tablename||'|'||policyname||'|'||cmd||'|'||md5(replace(coalesce(qual,'')||'::'||coalesce(with_check,''),chr(10),' '))
from pg_policies where schemaname='public' and tablename in ('experts','expert_signals','expert_signal_legs','trade_records','signal_trade_applications','user_performances','holdings_fix_proposals')
order by 1;
select 'FN|'||p.proname||'|'||p.prosecdef||'|'||coalesce(array_to_string(p.proconfig,','),'-')||'|'||md5(replace(pg_get_functiondef(p.oid),chr(10),' '))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
and p.proname in ('handle_signal_trade','save_signal_batch','admin_apply_fix_proposal','admin_delete_trade_records_by_signal_ids','admin_delete_trade_records_by_symbol','admin_signal_dupe_trades_fix','admin_trade_dedupe_sweep','realign_instrument_unit','calculate_expert_performance','enforce_signal_capital_limit','enforce_trade_record_market_currency','enforce_unit_consistency','enforce_user_performance_price','has_role','signal_in_subscription_window')
order by 1;
select 'ENUM|'||t.typname||'|'||md5(string_agg(e.enumlabel,',' order by e.enumsortorder))
from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' group by t.typname order by 1;
-- R1-P T-P99b: auth.users dependency fingerprint. The RLS subscription
-- harness seeds auth.users directly, so the clone must reproduce production's
-- exact column list, defaults, generated columns, constraints, indexes,
-- owner, RLS flag and grantee set — not a stub.
with u as (select c.oid, c.relowner, c.relacl, c.relrowsecurity from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname='auth' and c.relname='users')
select 'AUTHDEP|cols|'||md5(string_agg(
         a.attnum||':'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull
         ||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'-')||':'||coalesce(nullif(a.attgenerated::text,''),'-'),
         '|' order by a.attnum))
from pg_attribute a join u on u.oid=a.attrelid
left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attnum>0 and not a.attisdropped;
select 'AUTHDEP|colcount|'||count(*) from pg_attribute a
  join (select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='auth' and c.relname='users') u on u.oid=a.attrelid
where a.attnum>0 and not a.attisdropped;
select 'AUTHDEP|cons|'||md5(coalesce(string_agg(conname||'='||pg_get_constraintdef(oid),'|' order by conname),'-'))
from pg_constraint where conrelid=(select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
                                   where n.nspname='auth' and c.relname='users');
select 'AUTHDEP|idx|'||md5(string_agg(replace(indexdef,chr(10),' '),'|' order by indexname))
from pg_indexes where schemaname='auth' and tablename='users';
select 'AUTHDEP|meta|'||c.relowner::regrole::text||'|'||c.relrowsecurity||'|'||
       coalesce((select count(*)::text from aclexplode(c.relacl) x
                 where x.grantee::regrole::text in ('anon','authenticated','service_role')),'0')
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='auth' and c.relname='users';
