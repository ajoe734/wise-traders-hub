#!/usr/bin/env python3
"""R1-D: build the machine-readable writer inventory from the PRODUCTION catalog
(read-only) plus a static scan of the Edge function sources.
Outputs: db/r1/d/writer-inventory.json, writer-inventory.csv, writer-inventory.md
"""
import subprocess, json, re, os, csv, pathlib

ECON = ['trade_records','expert_signals','expert_signal_legs','user_performances',
        'daily_price_snapshots','current_prices','signal_trade_applications',
        'holdings_fix_proposals','target_price_history','user_summaries','portfolio_cash_ledger']
ROOT = pathlib.Path('db/r1/d')

def psql(sql):
    r = subprocess.run(['psql','-tAqX','-F','\x1f','-c',sql],capture_output=True,text=True)
    if r.returncode: raise SystemExit('psql failed: '+r.stderr)
    return [l.split('\x1f') for l in r.stdout.split('\n') if l.strip()]

tblvals = ",".join("('%s')" % t for t in ECON)
rows = psql(f"""
with tbl(t) as (values {tblvals})
select p.proname,
       pg_get_function_identity_arguments(p.oid),
       pg_get_userbyid(p.proowner),
       p.prosecdef::text,
       coalesce(array_to_string(p.proconfig,';'),''),
       coalesce((select string_agg(distinct t,',' order by t) from tbl
         where p.prosrc ~* ('(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(public\\.)?'||t||'\\M')),''),
       coalesce(p.proacl::text,''),
       coalesce((select string_agg(distinct c.relname||':'||tg.tgname,',')
          from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
          where tg.tgfoid=p.oid and not tg.tgisinternal),''),
       coalesce((select string_agg(distinct q.proname,',') from pg_proc q
          join pg_namespace qn on qn.oid=q.pronamespace
          where qn.nspname='public' and q.oid<>p.oid and q.prosrc ~* ('\\M'||p.proname||'[[:space:]]*\\(')),'')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and exists (select 1 from tbl where p.prosrc ~* ('(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(public\\.)?'||t||'\\M'))
order by 1""")

# triggers on the economic tables (a trigger is a writer entry point too)
trg = psql("""select c.relname, tg.tgname, tg.tgfoid::regproc::text, replace(pg_get_triggerdef(tg.oid),chr(10),' ')
 from pg_trigger tg join pg_class c on c.oid=tg.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where not tg.tgisinternal and n.nspname='public' and c.relname in (%s) order by 1,2"""
 % ",".join("'%s'"%t for t in ECON))

# table-level ACL on economic tables
acl = psql("""select c.relname, coalesce(c.relacl::text,'') from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in (%s) order by 1""" % ",".join("'%s'"%t for t in ECON))

DISPO = {
 'handle_signal_trade': ('trigger', 'REWRITE: thin wrapper -> app_ledger.canonical_apply_effect', 'W01'),
 'save_signal_batch': ('rpc', 'REWRITE: per-signal loop -> canonical_apply_effect (idempotent by origin_signal_id)', 'W02'),
 'handle_signal_takedown': ('trigger', 'REWRITE: emit reversal effect via canonical_apply_effect', 'W03'),
 'admin_apply_fix_proposal': ('rpc-admin', 'REWRITE: correction effect via canonical_apply_effect', 'W04'),
 'admin_delete_trade_records_by_signal_ids': ('rpc-admin','REWRITE: reversal effects, no raw DELETE','W05'),
 'admin_delete_trade_records_by_symbol': ('rpc-admin','REWRITE: reversal effects, no raw DELETE','W06'),
 'admin_signal_dupe_trades_fix': ('rpc-admin','REWRITE: dedupe via canonical idempotency, no raw DELETE','W07'),
 'trade_dedupe_sweep': ('rpc-admin','REWRITE: dedupe via canonical idempotency, no raw DELETE','W08'),
 'realign_instrument_unit': ('rpc-admin','REWRITE: unit realignment as correction effect','W09'),
 'admin_reset_expert_asset_class': ('rpc-admin','REWRITE: routed through canonical correction','W10'),
 'admin_generate_fix_proposals': ('rpc-admin','KEEP: proposals table only, no economic write','W11'),
 'admin_reject_fix_proposal': ('rpc-admin','KEEP: proposals table only, no economic write','W12'),
 'upsert_current_price': ('rpc-price','KEEP + NARROW: price whitelist only','W13'),
 'delete_old_prices': ('rpc-price','KEEP: current_prices retention only','W14'),
 'recalc_user_summary_on_perf_delete': ('trigger','KEEP: derived summary only, no economic write','W15'),
}

writers=[]
for (name,args,owner,secdef,cfg,writes,fnacl,attached,callers) in rows:
    kind,disp,tid = DISPO.get(name, ('rpc','REVIEW','W??'))
    writers.append(dict(id=tid, layer='db', kind=kind,
      signature=f"public.{name}({args})", owner=owner,
      security_definer=(secdef=='t'), search_path=cfg or '(none)',
      execute_acl=fnacl or '(default: PUBLIC)',
      writes_tables=[w for w in writes.split(',') if w],
      attached_triggers=[a for a in attached.split(',') if a],
      called_by=[c for c in callers.split(',') if c],
      cutover_disposition=disp,
      tests=[f"{tid}.happy", f"{tid}.retry", f"{tid}.negative_unauthorized", f"{tid}.rollback"]))

# ---- Edge function scan ----
EDGE_TID = {}
edge=[]
fnroot = pathlib.Path('supabase/functions')
pat_from = re.compile(r"""\.from\(\s*['"]([a-z_]+)['"]\s*\)((?:[^\n]|\n)_{0,0}[^\n]{0,400})""")
i=0
for p in sorted(fnroot.rglob('*.ts')):
    src = p.read_text()
    hits={}
    for m in re.finditer(r"\.from\(\s*['\"]([a-z_]+)['\"]\s*\)", src):
        tbl = m.group(1)
        if tbl not in ECON: continue
        tail = src[m.end():m.end()+400]
        ops = set(re.findall(r"\.(insert|upsert|update|delete)\(", tail[:200]))
        if ops: hits.setdefault(tbl,set()).update(ops)
    rpcs = sorted(set(re.findall(r"\.rpc\(\s*['\"]([a-z_]+)['\"]", src)))
    econ_rpcs = [r for r in rpcs if r in DISPO]
    if not hits and not econ_rpcs: continue
    i+=1; tid=f"E{i:02d}"
    name = str(p.relative_to(fnroot))
    if 'stock-price-sync' in name:
        disp='NARROW: whitelist current_price/price_updated_at only (R1-D §6)'
    elif hits:
        disp='REPOINT: economic DML must call canonical RPC'
    else:
        disp='KEEP: already goes through an RPC'
    edge.append(dict(id=tid, layer='edge', kind='edge-function', source=f"supabase/functions/{name}",
      owner='service_role (JWT)', security_definer=False, search_path='n/a',
      execute_acl='service_role key', writes_tables={k:sorted(v) for k,v in hits.items()},
      rpc_calls=econ_rpcs, cutover_disposition=disp,
      tests=[f"{tid}.happy", f"{tid}.retry", f"{tid}.negative_unauthorized", f"{tid}.rollback"]))

inv = dict(generated_from='production catalog (read-only) + static Edge scan',
           economic_tables=ECON,
           table_acl={r[0]: (r[1] or '(default)') for r in acl},
           triggers=[dict(table=t[0], trigger=t[1], function=t[2], definition=t[3]) for t in trg],
           writers=writers, edge_writers=edge,
           counts=dict(db_writers=len(writers), edge_writers=len(edge), triggers=len(trg)))
ROOT.mkdir(parents=True, exist_ok=True)
(ROOT/'writer-inventory.json').write_text(json.dumps(inv, indent=2, ensure_ascii=False))

with open(ROOT/'writer-inventory.csv','w',newline='') as f:
    w=csv.writer(f); w.writerow(['id','layer','kind','signature_or_source','owner','security_definer','search_path','execute_acl','writes','callers','cutover_disposition','tests'])
    for x in writers:
        w.writerow([x['id'],x['layer'],x['kind'],x['signature'],x['owner'],x['security_definer'],x['search_path'],x['execute_acl'],
                    ';'.join(x['writes_tables']),';'.join(x['called_by'] + x['attached_triggers']),x['cutover_disposition'],';'.join(x['tests'])])
    for x in edge:
        w.writerow([x['id'],x['layer'],x['kind'],x['source'],x['owner'],x['security_definer'],x['search_path'],x['execute_acl'],
                    ';'.join(f"{k}:{'/'.join(v)}" for k,v in x['writes_tables'].items()),';'.join(x['rpc_calls']),x['cutover_disposition'],';'.join(x['tests'])])

md=['# R1-D writer inventory','',f"Source: production catalog (read-only) + `supabase/functions` static scan.",
    f"DB writers: **{len(writers)}** · Edge writers: **{len(edge)}** · triggers on economic tables: **{len(trg)}**",'',
    '## DB writers','',
    '| ID | signature | owner | secdef | search_path | EXECUTE ACL | writes | callers / attached | disposition |','|---|---|---|---|---|---|---|---|---|']
for x in writers:
    md.append('| {id} | `{sig}` | {o} | {sd} | `{sp}` | `{acl}` | {w} | {c} | {d} |'.format(
        id=x['id'],sig=x['signature'],o=x['owner'],sd='yes' if x['security_definer'] else 'no',
        sp=x['search_path'],acl=x['execute_acl'],w=', '.join(x['writes_tables']) or '-',
        c=', '.join(x['called_by']+x['attached_triggers']) or '-',d=x['cutover_disposition']))
md += ['','## Edge writers','','| ID | source | writes | economic RPCs | disposition |','|---|---|---|---|---|']
for x in edge:
    md.append('| {id} | `{s}` | {w} | {r} | {d} |'.format(id=x['id'],s=x['source'],
        w=', '.join(f"{k} ({'/'.join(v)})" for k,v in x['writes_tables'].items()) or '-',
        r=', '.join(x['rpc_calls']) or '-', d=x['cutover_disposition']))
md += ['','## Triggers on economic tables','','| table | trigger | function |','|---|---|---|']
md += [f"| {t[0]} | {t[1]} | {t[2]} |" for t in trg]
md += ['','## Table ACL (production, before R1-D)','','| table | relacl |','|---|---|']
md += [f"| {r[0]} | `{r[1] or '(default)'}` |" for r in acl]
(ROOT/'writer-inventory.md').write_text('\n'.join(md)+'\n')
print('db_writers',len(writers),'edge_writers',len(edge),'triggers',len(trg))
