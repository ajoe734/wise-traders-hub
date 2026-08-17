#!/usr/bin/env python3
"""S0-2b — stage-specific backup artifact (production read-only).

PITR / managed backup tier is not readable through any tool available to this
agent (see S0-2a in S0_STATUS.md), so before any S1 DDL the stage must carry
its own restorable description of everything the cutover touches:

  * function definitions for every ACL-relevant function (pg_get_functiondef)
  * the 37 canonical ACL keys with live proacl
  * tables / columns / indexes / constraints / policies / grants for the
    affected relations
  * cron configuration (all jobs, command hashed)
  * catalog fingerprint used as the restore-rehearsal comparison anchor

Edge deployment inventory is produced by s0_edge_inventory.py and referenced
from the manifest. Every file is sha256'd into MANIFEST.json.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from s0_lib import ROOT, OUT, cli_q, psql, sha256_file, sha256_text, write_json  # noqa: E402

BK = os.path.join(OUT, "backup")
KEYS = os.path.join(ROOT, "db", "r1", "p", "evidence", "prod_acl_canonical_keys.txt")


def q1(sql):
    return cli_q(sql)


def main():
    os.makedirs(BK, exist_ok=True)
    files = {}

    # ---------------------------------------------------------------- ACL keys
    keys = [ln.split("|")[0] for ln in open(KEYS).read().splitlines() if ln.strip()]
    uniq_sigs = sorted(set(keys))
    acl_rows = q1("""
      select p.oid::regprocedure::text as sig, n.nspname, p.proname,
             pg_get_function_identity_arguments(p.oid) as args,
             coalesce(array_to_string(p.proacl,'|'),'(default)') as acl,
             p.prosecdef, md5(p.prosrc) as src_md5
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public'
       order by 1
    """)
    live = {("public." + r["proname"] + "(" + (r["args"] or "") + ")"): r for r in acl_rows}
    acl = {"canonical_keys_total": len(keys), "unique_signatures": len(uniq_sigs), "entries": []}
    missing = []
    for sig in uniq_sigs:
        r = live.get(sig)
        if not r:
            base = sig.split("(")[0].split(".")[-1]
            cands = [k for k in live if k.split("(")[0].split(".")[-1] == base]
            r = live[cands[0]] if len(cands) == 1 else None
        if not r:
            missing.append(sig)
            continue
        acl["entries"].append({"signature": sig, "live_signature": "public.%s(%s)" % (r["proname"], r["args"]),
                               "acl": r["acl"], "security_definer": r["prosecdef"], "prosrc_md5": r["src_md5"]})
    acl["missing"] = missing
    files["acl_keys.json"] = write_json(os.path.join(BK, "acl_keys.json"), acl)

    # -------------------------------------------------------- function definitions
    defs = []
    for e in acl["entries"]:
        nm = e["live_signature"]
        args = nm[nm.index("(") + 1:-1].replace("'", "''")
        base = nm.split("(")[0].split(".")[-1]
        rows = q1("""
          select pg_get_functiondef(p.oid) as def
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='%s'
             and pg_get_function_identity_arguments(p.oid)='%s'
        """ % (base, args))
        if rows:
            defs.append(rows[0]["def"])
    body = "-- S0-2b backup: %d function definitions (production read-only)\n" % len(defs) + "\n\n".join(defs) + "\n"
    open(os.path.join(BK, "functions.sql"), "w").write(body)
    files["functions.sql"] = sha256_text(body)

    # -------------------------------------------------------------- affected tables
    inv = json.load(open(os.path.join(ROOT, "db", "r1", "d", "writer-inventory.json")))
    tables = set()
    for t in inv["triggers"]:
        nm = t["table"] if isinstance(t, dict) and t.get("table") else None
        if nm:
            tables.add(nm)
    tables |= {"trade_records", "expert_signals", "expert_signal_legs", "user_performances",
               "user_summaries", "experts", "current_prices", "signal_trade_applications",
               "holdings_fix_proposals", "member_subscriptions"}
    tlist = "','".join(sorted(tables))
    cat = {
        "tables": sorted(tables),
        "columns": psql("select table_name||'.'||column_name||' '||data_type||' null='||is_nullable||"
                        "' def='||coalesce(column_default,'-') from information_schema.columns "
                        "where table_schema='public' and table_name in ('%s') order by 1" % tlist),
        "indexes": psql("select indexname||' :: '||indexdef from pg_indexes where schemaname='public' "
                        "and tablename in ('%s') order by 1" % tlist),
        "constraints": psql("select conrelid::regclass::text||' :: '||conname||' :: '||pg_get_constraintdef(oid) "
                            "from pg_constraint where connamespace='public'::regnamespace "
                            "and conrelid::regclass::text in ('%s') order by 1" % tlist),
        "policies": psql("select tablename||' :: '||policyname||' :: '||cmd||' :: '||coalesce(qual,'-')||' :: '||"
                         "coalesce(with_check,'-') from pg_policies where schemaname='public' "
                         "and tablename in ('%s') order by 1" % tlist),
        "grants": psql("select table_name||' :: '||grantee||' :: '||privilege_type "
                       "from information_schema.role_table_grants where table_schema='public' "
                       "and table_name in ('%s') order by 1" % tlist),
        "rls_enabled": psql("select relname||'='||relrowsecurity::text from pg_class c "
                            "join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' "
                            "and relname in ('%s') order by 1" % tlist),
    }
    files["catalog_affected.json"] = write_json(os.path.join(BK, "catalog_affected.json"), cat)

    # -------------------------------------------------------------------- cron
    cron = q1("select jobid, jobname, schedule, active, username, md5(command) as command_md5, "
              "length(command) as command_len from cron.job order by jobid")
    files["cron_config.json"] = write_json(os.path.join(BK, "cron_config.json"),
                                           {"jobs": cron, "total": len(cron),
                                            "active": sum(1 for j in cron if j["active"])})

    # ----------------------------------------------------- catalog fingerprint anchor
    fp = {
        "public_relations": psql("select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                                 "where n.nspname='public' and c.relkind='r'")[0][0],
        "public_functions": psql("select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                                 "where n.nspname='public'")[0][0],
        "public_triggers": psql("select count(*)::text from pg_trigger t join pg_class c on c.oid=t.tgrelid "
                                "join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' "
                                "and not t.tgisinternal")[0][0],
        "public_policies": psql("select count(*)::text from pg_policies where schemaname='public'")[0][0],
    }
    fp["fingerprint_sha256"] = sha256_text(json.dumps(fp, sort_keys=True))
    files["catalog_fingerprint.json"] = write_json(os.path.join(BK, "catalog_fingerprint.json"), fp)

    # edge inventory produced separately; include its hash when present
    edge = os.path.join(OUT, "edge_inventory.json")
    if os.path.isfile(edge):
        files["../edge_inventory.json"] = sha256_file(edge)

    manifest = {
        "artifact": "S0-2b stage-specific backup artifact",
        "production_touch": "read-only (SELECT / catalog only)",
        "reason": "managed backup tier / PITR state is not readable by any available tool (S0-2a BLOCKER)",
        "files_sha256": files,
        "counts": {"acl_canonical_keys": acl["canonical_keys_total"],
                   "acl_unique_signatures": acl["unique_signatures"],
                   "function_definitions": len(defs),
                   "affected_tables": len(cat["tables"]),
                   "cron_jobs": len(cron)},
    }
    manifest["manifest_sha256"] = sha256_text(json.dumps(manifest, sort_keys=True))
    write_json(os.path.join(BK, "MANIFEST.json"), manifest)
    print(json.dumps(manifest["counts"], indent=2))
    print("missing signatures: %s" % (missing or "none"))
    return 0 if not missing and len(defs) == acl["unique_signatures"] else 1


if __name__ == "__main__":
    sys.exit(main())
