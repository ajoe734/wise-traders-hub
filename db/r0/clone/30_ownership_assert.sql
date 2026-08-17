\pset pager off
\echo === C1 app_ledger object ownership (expect all ledger_owner) ===
select 'table' kind, c.relname, pg_get_userbyid(c.relowner) owner from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='app_ledger' and c.relkind in ('r','S','v')
union all
select 'function', p.proname, pg_get_userbyid(p.proowner) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_ledger'
union all
select 'schema','app_ledger', pg_get_userbyid(nspowner) from pg_namespace where nspname='app_ledger'
union all
select 'type', t.typname, pg_get_userbyid(t.typowner) from pg_type t join pg_namespace n on n.oid=t.typnamespace
where n.nspname='public' and t.typname='effect_provenance'
order by 1,2;
\echo === C2 non-ledger_owner objects in app_ledger (expect 0) ===
select count(*) as violations from (
 select pg_get_userbyid(c.relowner) o from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_ledger'
 union all select pg_get_userbyid(p.proowner) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_ledger') x
where o <> 'ledger_owner';
\echo === C3 SECURITY DEFINER functions run as ledger_owner ===
select p.proname, p.prosecdef, pg_get_userbyid(p.proowner) owner, coalesce(array_to_string(p.proconfig,','),'-') cfg
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_ledger' and p.prosecdef order by 1;
\echo === C4 raw economic DML privileges for anon/authenticated/service_role/PUBLIC (expect none) ===
select r.rolname, t.tbl, priv,
  has_table_privilege(r.rolname, t.tbl, priv) as granted
from (values ('anon'),('authenticated'),('service_role')) r(rolname),
     (values ('public.trade_records'),('app_ledger.economic_effect'),('app_ledger.effect_projection_mutation'),('app_ledger.portfolio_cash_ledger')) t(tbl),
     (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) p(priv)
where has_table_privilege(r.rolname, t.tbl, priv) order by 1,2,3;
\echo === C5 column-level price-only grant retained ===
select has_column_privilege('service_role','public.trade_records','current_price','UPDATE') px,
       has_column_privilege('service_role','public.trade_records','quantity','UPDATE') qty_should_be_false,
       has_table_privilege('authenticated','public.trade_records','SELECT') auth_select;
\echo === C6 schema usage ===
select r, has_schema_privilege(r,'app_ledger','USAGE') usage, has_schema_privilege(r,'app_ledger','CREATE') create_
from (values ('anon'),('authenticated'),('service_role'),('ledger_owner')) v(r);
