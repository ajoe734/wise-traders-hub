#!/usr/bin/env python3
"""Compare a restored clone's public-schema census with the production
baseline fingerprint captured in S0 (db/r1/c/S0/backup/catalog_fingerprint.json).

Production is never contacted: the expected values come from the backup
artifact only. Exit 0 when every count matches, 1 otherwise.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FP = os.path.join(HERE, "..", "S0", "backup", "catalog_fingerprint.json")

QUERIES = {
    # catalog_fingerprint.json counts ordinary tables (relkind='r') for
    # public_relations; views are checked separately against the bundle.
    "public_relations": ("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                         "where n.nspname='public' and c.relkind='r'"),
    "public_functions": ("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                         "where n.nspname='public'"),
    "public_policies": "select count(*) from pg_policies where schemaname='public'",
    "public_triggers": ("select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid "
                        "join pg_namespace n on n.oid=c.relnamespace "
                        "where n.nspname='public' and not t.tgisinternal"),
}


def main():
    cl = sys.argv[1]
    want = json.load(open(FP))
    got, bad = {}, []
    for key, sql in QUERIES.items():
        r = subprocess.run(["psql", cl, "-AtqX", "-c", sql], capture_output=True, text=True)
        if r.returncode != 0:
            print("census query failed: %s" % r.stderr.strip())
            return 1
        got[key] = r.stdout.strip()
        if str(want[key]) != got[key]:
            bad.append("%s want=%s got=%s" % (key, want[key], got[key]))
    # views: every view emitted by the backup bundle must exist in the clone
    bundle = open(os.path.join(HERE, "..", "S0", "backup", "restore", "010_tables.sql")).read()
    want_views = sorted(l.split("public.")[1].split(" ")[0]
                        for l in bundle.splitlines() if l.startswith("CREATE OR REPLACE VIEW"))
    r = subprocess.run(["psql", cl, "-AtqX", "-c",
                        "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                        "where n.nspname='public' and c.relkind='v' order by 1"],
                       capture_output=True, text=True)
    got_views = sorted(x for x in r.stdout.split())
    got["public_views"] = str(len(got_views))
    if got_views != want_views:
        bad.append("public_views want=%d got=%d missing=%s" % (
            len(want_views), len(got_views), sorted(set(want_views) - set(got_views))))
    if bad:
        print("; ".join(bad))
        return 1
    print("census matches baseline: " + json.dumps(got, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
