#!/usr/bin/env python3
"""S0-5b / item 5 — exact Edge function inventory (production read-only).

For each edge writer in db/r1/d/writer-inventory.json:
  * exact function name and repo source path
  * repo bundle hash (sha256 over every file in the function directory)
  * shared import list + hash of each imported supabase/functions/_shared file
  * production deployment: function_id, active version, deployment_id and the
    log-derived first/last seen timestamps for that version
Any function whose production version cannot be observed is reported as a
BLOCKER instead of being silently counted green.
"""
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from s0_lib import ROOT, OUT, analytics, psql, write_json  # noqa: E402

FUNCS = os.path.join(ROOT, "supabase", "functions")
SHARED = os.path.join(FUNCS, "_shared")


def dir_hash(d):
    h = hashlib.sha256()
    files = []
    for root, _dirs, names in os.walk(d):
        for n in sorted(names):
            p = os.path.join(root, n)
            files.append(os.path.relpath(p, d))
    for rel in sorted(files):
        h.update(rel.encode())
        h.update(open(os.path.join(d, rel), "rb").read())
    return h.hexdigest(), sorted(files)


def shared_imports(d):
    out = set()
    for root, _dirs, names in os.walk(d):
        for n in names:
            if not n.endswith((".ts", ".tsx", ".js")):
                continue
            src = open(os.path.join(root, n), encoding="utf-8", errors="replace").read()
            for m in re.finditer(r"from\s+[\"']([^\"']*_shared/[^\"']+)[\"']", src):
                out.add(os.path.basename(m.group(1)))
    return sorted(out)


def main():
    inv = json.load(open(os.path.join(ROOT, "db", "r1", "d", "writer-inventory.json")))

    # production: per-function version over a 7 day log window
    win = "where t.timestamp > timestamp_sub(current_timestamp(), interval 7 day)"
    rows = analytics("""
      select regexp_extract(t.event_message, r'/functions/v1/([A-Za-z0-9_-]+)') as fn,
             m.function_id as function_id,
             max(m.version) as version,
             max(m.deployment_id) as deployment_id,
             max(t.timestamp) as last_seen_us,
             min(t.timestamp) as first_seen_us,
             count(*) as calls
        from function_edge_logs t cross join unnest(t.metadata) m
       %s
       group by fn, function_id
       order by calls desc
       limit 500
    """ % win)
    name_to_prod = {}
    for r in rows:
        fn = r.get("fn")
        if not fn:
            continue
        cur = name_to_prod.get(fn)
        if cur is None or (r.get("last_seen_us") or 0) > (cur.get("last_seen_us") or 0):
            name_to_prod[fn] = {"function_id": r.get("function_id"), "version": r.get("version"),
                                "deployment_id": r.get("deployment_id"), "last_ts_us": r.get("last_seen_us"),
                                "first_seen_us": r.get("first_seen_us"), "calls_in_window": r.get("calls")}

    # db-side boot events give deployment ids per function name (independent source)
    boots = {r[0]: {"deployment_id": r[1], "last_boot": r[2], "deployment_first_boot": r[3],
                    "boots": int(r[4]), "distinct_deployments": int(r[5])} for r in psql(
        "with latest as (select distinct on (fn) fn, deployment_id::text as dep, boot_at "
        "from edge_boot_events order by fn, boot_at desc) "
        "select l.fn, l.dep, (select max(boot_at)::text from edge_boot_events e where e.fn=l.fn), "
        "(select min(boot_at)::text from edge_boot_events e where e.fn=l.fn and e.deployment_id::text=l.dep), "
        "(select count(*)::text from edge_boot_events e where e.fn=l.fn), "
        "(select count(distinct deployment_id)::text from edge_boot_events e where e.fn=l.fn) from latest l")}

    entries, blockers = [], []
    for e in inv["edge_writers"]:
        src = e.get("source", "")
        name = src.split("/")[2] if src.startswith("supabase/functions/") else None
        d = os.path.join(FUNCS, name) if name else None
        present = bool(d) and os.path.isdir(d)
        bundle, files = dir_hash(d) if present else (None, [])
        imports = shared_imports(d) if present else []
        imp_hashes = {}
        for i in imports:
            p = os.path.join(SHARED, i)
            imp_hashes[i] = hashlib.sha256(open(p, "rb").read()).hexdigest() if os.path.isfile(p) else "MISSING"
        prod = name_to_prod.get(name)
        entry = {
            "id": e["id"], "name": name, "source": src, "repo_present": present,
            "repo_bundle_sha256": bundle, "repo_files": files,
            "shared_imports": imports, "shared_import_sha256": imp_hashes,
            "prod_function_id": (prod or {}).get("function_id"),
            "prod_version": (prod or {}).get("version"),
            "prod_deployment_id": (prod or {}).get("deployment_id") or boots.get(name, {}).get("deployment_id"),
            "prod_last_invocation_utc_us": (prod or {}).get("last_ts_us"),
            "prod_calls_7d": (prod or {}).get("calls_in_window"),
            "prod_version_first_seen_us": (prod or {}).get("first_seen_us"),
            "prod_last_boot": boots.get(name, {}).get("last_boot"),
            "prod_deployment_first_boot": boots.get(name, {}).get("deployment_first_boot"),
            "prod_boot_count": boots.get(name, {}).get("boots"),
            "prod_distinct_deployments": boots.get(name, {}).get("distinct_deployments"),
            "deployed_at_estimate_source": "min(boot_at) of the current deployment_id in public.edge_boot_events "
                                           "(lower bound: a deploy is only observed once the function first boots)",
            "deployed_at_authoritative": None,
        }
        cls = []
        if not present:
            cls.append("repo_source_missing")
        if not entry["prod_version"]:
            # function_edge_logs retention on this tier is ~1h, so a numeric version
            # is only observable for functions invoked inside that window.
            cls.append("version_unknown_log_retention")
        if not entry["prod_deployment_id"]:
            cls.append("prod_deployment_unknown")
        cls.append("deployed_at_not_authoritative")  # no tool exposes the platform deploy timestamp
        entry["classification"] = cls
        if "repo_source_missing" in cls or "prod_deployment_unknown" in cls:
            blockers.append({"id": e["id"], "name": name, "why": cls})
        entries.append(entry)

    art = {
        "gate": "S0-5b edge deployment inventory",
        "production_touch": "read-only (log analytics + catalog)",
        "note": "version/deployment_id are observed from production edge logs; the managed platform exposes "
                "no authoritative deployed_at or deployed bundle hash to this agent, so bundle equality "
                "between repo and production cannot be proven here.",
        "total": len(entries), "entries": entries,
        "blockers": blockers,
        "blocker_count": len(blockers),
        "deployed_at_available": False,
        "log_retention_limitation": "function_edge_logs retains roughly one hour on this instance tier; "
                                    "numeric versions are therefore only observable for recently invoked "
                                    "functions. Deployment identity for every function comes from the "
                                    "app-instrumented public.edge_boot_events table instead.",
        "prod_bundle_hash_available": False,
    }
    write_json(os.path.join(OUT, "edge_inventory.json"), art)
    print("edge writers=%d  version_known=%d  blockers=%d"
          % (len(entries), sum(1 for e in entries if e["prod_version"]), len(blockers)))
    for b in blockers:
        print("  BLOCKER %s %s %s" % (b["id"], b["name"], b["why"]))
    return 1 if blockers else 0


if __name__ == "__main__":
    sys.exit(main())
