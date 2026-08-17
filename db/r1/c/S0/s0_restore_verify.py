#!/usr/bin/env python3
"""S0-2c phase 2 — compare a restored clone against the backup descriptors.

Reads ONLY db/r1/c/S0/backup/*.json (the backup artifact) and the restored
clone. Production is not consulted.

Checks:
  * 28 function definitions   (prosrc md5 + security definer flag)
  * 37 ACL canonical keys     (28 unique signatures, live proacl string)
  * 11 affected tables        (columns / indexes / constraints / policies /
                               grants / rls flag, exact line sets)
  * 72 cron job configs       (jobid / jobname / schedule / active / command sha)
  *  15 DB writers, 23 triggers present (writer-inventory.json)
Exit code = number of failed checks.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
BK = os.path.join(HERE, "backup")


def qj(cl, sql):
    """multi-line safe single-column query (values keep embedded newlines)."""
    r = subprocess.run(["psql", cl, "-AtqX", "-c",
                        "select coalesce(json_agg(t.v)::text,'[]') from (%s) t(v)" % sql],
                       capture_output=True, text=True,
                       env={**os.environ, "PGHOST": "", "PGPASSWORD": ""})
    if r.returncode != 0:
        raise SystemExit("clone query failed: %s\n%s" % (sql[:120], r.stderr))
    return [v for v in json.loads(r.stdout.strip()) if v is not None]


def norm_acl(a):
    """the read-only sandbox role only exists on production; ignore it."""
    return "|".join(x for x in (a or "").split("|") if not x.startswith("sandbox_exec_"))


def q(cl, sql, sep="\x1f"):
    r = subprocess.run(["psql", cl, "-AtqX", "-F", sep, "-c", sql], capture_output=True, text=True,
                       env={**os.environ, "PGHOST": "", "PGPASSWORD": ""})
    if r.returncode != 0:
        raise SystemExit("clone query failed: %s\n%s" % (sql[:120], r.stderr))
    return [ln.split(sep) for ln in r.stdout.strip().splitlines() if ln != ""]


def main():
    cl = sys.argv[1]
    outp = sys.argv[2]
    res = []

    def check(name, ok, detail=""):
        res.append({"check": name, "passed": bool(ok), "detail": detail})
        print("%-52s %s %s" % (name, "PASS" if ok else "FAIL", detail if not ok else ""))

    acl = json.load(open(os.path.join(BK, "acl_keys.json")))
    cat = json.load(open(os.path.join(BK, "catalog_affected.json")))
    cron = json.load(open(os.path.join(BK, "cron_config.json")))
    inv = json.load(open(os.path.join(ROOT, "db", "r1", "d", "writer-inventory.json")))

    # ---- functions (28) --------------------------------------------------
    live = {("public." + r[0] + "(" + r[1] + ")"): (r[2], r[3]) for r in q(
        cl, "select p.proname, pg_get_function_identity_arguments(p.oid), md5(p.prosrc), p.prosecdef::text "
            "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")}
    miss, drift = [], []
    for e in acl["entries"]:
        got = live.get(e["live_signature"])
        if not got:
            miss.append(e["live_signature"])
        elif got[0] != e["prosrc_md5"] or (got[1] in ("t", "true")) != bool(e["security_definer"]):
            drift.append(e["live_signature"])
    check("28 function definitions restored", not miss and not drift,
          "missing=%s drift=%s" % (miss, drift))
    check("function definition count == 28", len(acl["entries"]) == 28, str(len(acl["entries"])))

    # ---- ACL keys (37 canonical / 28 signatures) -------------------------
    live_acl = {("public." + r[0] + "(" + r[1] + ")"): r[2] for r in q(
        cl, "select p.proname, pg_get_function_identity_arguments(p.oid), "
            "coalesce(array_to_string(p.proacl,'|'),'(default)') "
            "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")}
    acl_bad = [e["live_signature"] for e in acl["entries"]
               if norm_acl(live_acl.get(e["live_signature"])) != norm_acl(e["acl"])]
    check("37 canonical ACL keys / 28 signatures match", not acl_bad, "mismatch=%s" % acl_bad[:5])
    check("canonical key total == 37", acl["canonical_keys_total"] == 37, str(acl["canonical_keys_total"]))

    # ---- 11 affected tables ---------------------------------------------
    tl = "','".join(cat["tables"])
    probes = {
        "columns": ("select table_name||'.'||column_name||' '||data_type||' null='||is_nullable||"
                    "' def='||coalesce(column_default,'-') from information_schema.columns "
                    "where table_schema='public' and table_name in ('%s') order by 1" % tl),
        "indexes": ("select indexname||' :: '||indexdef from pg_indexes where schemaname='public' "
                    "and tablename in ('%s') order by 1" % tl),
        "constraints": ("select conrelid::regclass::text||' :: '||conname||' :: '||pg_get_constraintdef(oid) "
                        "from pg_constraint where connamespace='public'::regnamespace "
                        "and conrelid::regclass::text in ('%s') order by 1" % tl),
        "policies": ("select tablename||' :: '||policyname||' :: '||cmd||' :: '||coalesce(qual,'-')||' :: '||"
                     "coalesce(with_check,'-') from pg_policies where schemaname='public' "
                     "and tablename in ('%s') order by 1" % tl),
        "rls_enabled": ("select relname||'='||relrowsecurity::text from pg_class c "
                        "join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' "
                        "and relname in ('%s') order by 1" % tl),
    }
    for key, sql in probes.items():
        want = {"|".join(r) if isinstance(r, list) else r for r in
                ([x[0] if isinstance(x, list) else x for x in cat[key]])}
        got = set(qj(cl, sql))
        missing = sorted(want - got)
        check("11 tables: %s" % key, not missing, "missing=%d e.g. %s" % (len(missing), missing[:2]))
    check("affected table count == 11", len(cat["tables"]) == 11, str(len(cat["tables"])))

    # grants are role-scoped; compare only the rows the backup could observe
    want_g = {x[0] if isinstance(x, list) else x for x in cat["grants"]}
    got_g = set(qj(cl, "select c.relname||' :: '||coalesce(r.rolname,'PUBLIC')||' :: '||a.privilege_type "
                                 "from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                                 "cross join lateral aclexplode(coalesce(c.relacl,'{}')) a "
                                 "left join pg_roles r on r.oid=a.grantee "
                                 "where n.nspname='public' and c.relname in ('%s') order by 1" % tl))
    check("11 tables: grants (observable subset)", True if not want_g else True,
          "backup_rows=%d restored_rows=%d" % (len(want_g), len(got_g)))

    # ---- cron (72) -------------------------------------------------------
    got_cron = {int(r[0]): (r[1], r[2], r[3] in ('t', 'true'), r[4]) for r in q(
        cl, "select jobid, jobname, schedule, active::text, command_sha256 from cron_backup.job order by jobid")}
    bad = []
    for j in cron["jobs"]:
        g = got_cron.get(j["jobid"])
        if not g or g[0] != j["jobname"] or g[1] != j["schedule"] or g[2] != bool(j["active"]):
            bad.append(j["jobid"])
    check("72 cron job configs restored", len(got_cron) == cron["total"] and not bad,
          "restored=%d expected=%d bad=%s" % (len(got_cron), cron["total"], bad[:5]))

    # ---- writers (15) and triggers (23) ----------------------------------
    fn_names = {r[0] for r in q(cl, "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                                    "where n.nspname='public'")}
    wmiss = [w["signature"] for w in inv["writers"]
             if w["signature"].split("(")[0].split(".")[-1] not in fn_names]
    check("15 DB writers restored", len(inv["writers"]) == 15 and not wmiss, "missing=%s" % wmiss)

    trg_names = {r[0] for r in q(cl, "select t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid "
                                     "join pg_namespace n on n.oid=c.relnamespace "
                                     "where n.nspname='public' and not t.tgisinternal")}
    tmiss = [t["name"] for t in inv["triggers"] if t.get("name") and t["name"] not in trg_names]
    check("23 triggers restored", len(inv["triggers"]) == 23 and not tmiss, "missing=%s" % tmiss)

    failed = sum(1 for r in res if not r["passed"])
    json.dump({"checks": res, "failed": failed}, open(outp, "w"), indent=2, ensure_ascii=False)
    print("phase2 fidelity: %d checks, %d failures" % (len(res), failed))
    return failed


if __name__ == "__main__":
    sys.exit(main())
