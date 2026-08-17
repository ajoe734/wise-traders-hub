\pset pager off
\echo === R0-A10 ENUMS ===
select t.typname, string_agg(e.enumlabel,',' order by e.enumsortorder) labels
from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace
where n.nspname='public' group by t.typname order by 1;
\echo === R0-A11 ROLE CAPABILITY (current session + key roles) ===
select current_user, session_user, current_setting('is_superuser') as is_superuser;
select rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls
from pg_roles where rolname in ('postgres','supabase_admin','authenticator','service_role','authenticated','anon','sandbox_exec','pg_database_owner') order by 1;
\echo === R0-A12 ROLE MEMBERSHIP of postgres ===
select r.rolname as member, g.rolname as granted
from pg_auth_members m join pg_roles r on r.oid=m.member join pg_roles g on g.oid=m.roleid
where r.rolname in ('postgres','authenticator') order by 1,2;
\echo === R0-A13 PUBLIC VIEWS touching economic tables ===
select c.relname, c.relkind, pg_get_userbyid(c.relowner) owner, coalesce(array_to_string(c.reloptions,','),'-') opts
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('v','m')
order by 1;
\echo === R0-A14 SIGNAL SHAPE (for clone fixture fidelity) ===
select count(*) signals, count(distinct expert_id) experts, count(distinct symbol) symbols,
  min(created_at)::date first_at, max(created_at)::date last_at from expert_signals;
select status, action, coalesce(market,'-') market, count(*) from expert_signals group by 1,2,3 order by 4 desc;
select coalesce(instrument_type,'-') instrument, coalesce(unit,'-') unit, count(*) from expert_signals group by 1,2 order by 3 desc;
\echo === R0-A15 TRADE RECORD SHAPE ===
select count(*) trades, count(distinct expert_id) experts, count(distinct symbol) symbols from trade_records;
select status, coalesce(market,'-') market, coalesce(currency,'-') ccy, coalesce(instrument_type,'-') instr, count(*)
from trade_records group by 1,2,3,4 order by 5 desc;
\echo === R0-A16 EXPERTS ===
select count(*) from experts;
select id, asset_class, currency, is_active, role from experts order by created_at;
