\set ON_ERROR_STOP on
\pset pager off
\echo === R0-A1 ECONOMIC TABLE SET ===
with t(n) as (values ('trade_records'),('expert_signals'),('signal_trade_applications'),
 ('user_performances'),('holdings_fix_proposals'),('experts'),('expert_signal_legs'),
 ('expert_plans'),('current_prices'),('target_price_history'))
select n as tbl,
  (select count(*) from information_schema.columns c where c.table_schema='public' and c.table_name=t.n) as cols,
  (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=t.n) as policies,
  (select relrowsecurity from pg_class where oid=('public.'||t.n)::regclass) as rls,
  (select pg_get_userbyid(relowner) from pg_class where oid=('public.'||t.n)::regclass) as owner,
  (select n_live_tup from pg_stat_user_tables s where s.schemaname='public' and s.relname=t.n) as approx_rows
from t order by 1;

\echo === R0-A2 COLUMN HASH (per table) ===
with t(n) as (values ('trade_records'),('expert_signals'),('signal_trade_applications'),('user_performances'),('holdings_fix_proposals'),('experts'),('expert_signal_legs'))
select t.n, md5(string_agg(c.column_name||':'||c.data_type||':'||c.is_nullable||':'||coalesce(c.column_default,'-'), '|' order by c.column_name)) as col_hash,
       count(*) as ncols
from t join information_schema.columns c on c.table_schema='public' and c.table_name=t.n
group by t.n order by 1;

\echo === R0-A3 CONSTRAINTS HASH ===
select rel.relname, md5(string_agg(con.conname||'='||pg_get_constraintdef(con.oid), '|' order by con.conname)) h, count(*) n
from pg_constraint con join pg_class rel on rel.oid=con.conrelid join pg_namespace ns on ns.oid=rel.relnamespace
where ns.nspname='public' and rel.relname in ('trade_records','expert_signals','signal_trade_applications','user_performances','holdings_fix_proposals','experts','expert_signal_legs')
group by rel.relname order by 1;

\echo === R0-A4 INDEXES HASH ===
select tablename, md5(string_agg(indexdef,'|' order by indexname)) h, count(*) n
from pg_indexes where schemaname='public' and tablename in ('trade_records','expert_signals','signal_trade_applications','user_performances','holdings_fix_proposals','experts','expert_signal_legs')
group by tablename order by 1;

\echo === R0-A5 TRIGGERS (economic tables, active/inactive) ===
select c.relname as tbl, tg.tgname, tg.tgenabled,
  p.proname as fn, md5(pg_get_triggerdef(tg.oid)) as def_hash
from pg_trigger tg join pg_class c on c.oid=tg.tgrelid join pg_namespace n on n.oid=c.relnamespace
join pg_proc p on p.oid=tg.tgfoid
where not tg.tgisinternal and n.nspname='public'
  and c.relname in ('trade_records','expert_signals','signal_trade_applications','user_performances','holdings_fix_proposals','expert_signal_legs')
order by 1,2;

\echo === R0-A6 RLS POLICIES ===
select tablename, policyname, cmd, roles::text, md5(coalesce(qual,'')||'::'||coalesce(with_check,'')) h
from pg_policies where schemaname='public' and tablename in ('trade_records','expert_signals','signal_trade_applications','user_performances','holdings_fix_proposals','expert_signal_legs')
order by 1,2;

\echo === R0-A7 TABLE ACL ===
select c.relname, coalesce(array_to_string(c.relacl,' '),'(default/owner-only)') acl
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('trade_records','expert_signals','signal_trade_applications','user_performances','holdings_fix_proposals','expert_signal_legs')
order by 1;

\echo === R0-A8 ECONOMIC FUNCTIONS (definer/owner/search_path/hash) ===
select p.proname, p.prosecdef as sec_definer, pg_get_userbyid(p.proowner) as owner,
  coalesce(array_to_string(p.proconfig,','),'(none)') as cfg,
  coalesce(array_to_string(p.proacl,' '),'(default)') as acl,
  md5(pg_get_functiondef(p.oid)) as body_hash, length(pg_get_functiondef(p.oid)) as len
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
 'handle_signal_trade','on_signal_insert_or_update','save_signal_batch','admin_apply_fix_proposal',
 'admin_delete_trade_records_by_signal_ids','admin_delete_trade_records_by_symbol',
 'admin_signal_dupe_trades_fix','admin_trade_dedupe_sweep','realign_instrument_unit',
 'calculate_expert_performance','enforce_signal_capital_limit','enforce_trade_record_market_currency',
 'enforce_unit_consistency','enforce_user_performance_price','get_owned_journal_bundle','admin_generate_fix_proposals')
order by 1;

\echo === R0-A9 CRON JOBS (economic) ===
select jobid, schedule, jobname, active, left(command,140) cmd from cron.job order by jobid;

\echo === R0-A10 TYPES/ENUMS ===
select t.typname, md5(string_agg(e.enumlabel,',' order by e.enumsortorder)) h, string_agg(e.enumlabel,',' order by e.enumsortorder) labels
from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace
where n.nspname='public' group by t.typname order by 1;
