#!/usr/bin/env python3
"""R1-P: read-only catalog extraction of the extra objects referenced by the 28
ACL targets (db/r1/p/acl-25.json) that the R0 economic subset did not include.

Production is only READ (information_schema / pg_catalog / pg_get_viewdef /
pg_get_functiondef). No pg_dump, no data, no DDL, no DML.

Emits db/r1/clone/tables_acl28.sql — loaded on disposable clones only, so that
096_acl_dynamic_proof.sql can execute the real bodies instead of vacuous stubs.
"""
import subprocess

TABLES = ['backfill_job_queue', 'checkup_storage', 'function_run_logs',
          'institutional_new_stock_queue', 'publish_batch_attempts',
          'system_alerts', 'tw_chip_fact', 'tw_institutional_daily']
VIEWS = ['v_active_tw_holdings']
FUNCS = ['checkup_prefetch_universe']


def q(sql):
    r = subprocess.run(['psql', '-tAqX', '-c', sql], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit('psql failed: ' + r.stderr)
    return [l for l in r.stdout.split('\n') if l.strip()]


out = ["-- R1-P clone: extra objects for the 28 ACL targets",
       "-- generated read-only by db/r1/clone/extract_acl28_tables.py",
       "SET client_min_messages=warning;", "SET check_function_bodies=off;", ""]

tl = ",".join("'%s'" % t for t in TABLES)
out.append('-- SEQUENCES')
for _sq in ('backfill_job_queue_id_seq','tw_chip_fact_id_seq','tw_institutional_daily_id_seq'):
    out.append(f'CREATE SEQUENCE IF NOT EXISTS public.{_sq};')
out.append('\n-- TABLES')
for t in TABLES:
    cols = q(f"""select column_name||' '||
      case when data_type='USER-DEFINED' then 'public.'||udt_name
           when data_type='ARRAY' then replace(udt_name,'_','')||'[]'
           when character_maximum_length is not null then data_type||'('||character_maximum_length||')'
           when data_type='numeric' and numeric_precision is not null then 'numeric('||numeric_precision||','||coalesce(numeric_scale,0)||')'
           else data_type end ||
      case when column_default is not null then ' DEFAULT '||column_default else '' end ||
      case when is_nullable='NO' then ' NOT NULL' else '' end
      from information_schema.columns where table_schema='public' and table_name='{t}' order by ordinal_position""")
    out.append(f"CREATE TABLE IF NOT EXISTS public.{t} (\n  " + ",\n  ".join(cols) + "\n);")

out.append('\n-- PRIMARY/UNIQUE CONSTRAINTS')
for line in q(f"""select replace(rel.relname||'|'||con.conname||'|'||pg_get_constraintdef(con.oid), chr(10), ' ')
 from pg_constraint con join pg_class rel on rel.oid=con.conrelid join pg_namespace ns on ns.oid=rel.relnamespace
 where ns.nspname='public' and rel.relname in ({tl}) and con.contype in ('p','u')
 order by rel.relname, con.conname"""):
    rel, name, defn = line.split('|', 2)
    out.append(f"ALTER TABLE public.{rel} ADD CONSTRAINT {name} {defn};")

out.append('\n-- VIEWS')
for v in VIEWS:
    defn = "\n".join(q(f"select pg_get_viewdef('public.{v}'::regclass, true)"))
    out.append(f"CREATE OR REPLACE VIEW public.{v} AS\n{defn};")

out.append('\n-- SUPPORT FUNCTIONS')
for f in FUNCS:
    for line in q(f"""select pg_get_functiondef(p.oid)||';'
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='{f}'"""):
        out.append(line)

out.append('\n-- Data API grants mirroring production (pre-cutover shape)')
for t in TABLES:
    out.append(f"GRANT SELECT, INSERT, UPDATE, DELETE ON public.{t} TO authenticated;")
    out.append(f"GRANT ALL ON public.{t} TO service_role;")

open('db/r1/clone/tables_acl28.sql', 'w').write("\n".join(out) + "\n")
print(f"wrote db/r1/clone/tables_acl28.sql: {len(TABLES)} tables, {len(VIEWS)} views, {len(FUNCS)} functions")
