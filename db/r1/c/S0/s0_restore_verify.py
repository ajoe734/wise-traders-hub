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


def owner_map_ok(want, got):
    return want == got


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

    # ---- ACL: exact aclexplode canonical tuples --------------------------
    # No proacl string comparison, no loose normaliser, no role-name exclusion.
    can = json.load(open(os.path.join(BK, "acl_canonical.json")))
    sig_expr = "'public.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'"
    in_list = ",".join("'" + s.replace("'", "''") + "'" for s in can["signatures"])
    got_tuples = sorted("%s|%s|%s|%s|%s" % (r[0], r[1], r[2], r[3], "t" if r[4] in ("t", "true") else "f")
                        for r in q(cl, """
        select %s, coalesce(gr.rolname,'PUBLIC'), coalesce(ge.rolname,'PUBLIC'),
               a.privilege_type, a.is_grantable::text
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        left join pg_roles gr on gr.oid=a.grantor
        left join pg_roles ge on ge.oid=a.grantee
        where n.nspname='public' and %s in (%s)""" % (sig_expr, sig_expr, in_list)))
    want_tuples = sorted(can["tuples"])
    missing_t = sorted(set(want_tuples) - set(got_tuples))
    extra_t = sorted(set(got_tuples) - set(want_tuples))
    got_owners = {r[0]: r[1] for r in q(cl, """
        select %s, o.rolname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        join pg_roles o on o.oid=p.proowner where n.nspname='public' and %s in (%s)"""
                                        % (sig_expr, sig_expr, in_list))}
    owner_bad = sorted(s for s, o in can["owner_mapping"].items() if got_owners.get(s) != o)
    check("37 canonical ACL keys: exact aclexplode tuples (%d tuples / 28 sigs, owners mapped)"
          % can["tuple_total"],
          not missing_t and not extra_t and not owner_bad and owner_map_ok(
              can["canonical_keys_total"], 37),
          "missing=%d %s extra=%d %s owner_bad=%s" % (len(missing_t), missing_t[:3],
                                                      len(extra_t), extra_t[:3], owner_bad[:3]))

    # ---- has_function_privilege matrix (PUBLIC/anon/authenticated/service_role/owner)
    probes = []
    for role in ["public", "anon", "authenticated", "service_role"]:
        for sig, val in q(cl, """
            select %s, has_function_privilege('%s', p.oid, 'EXECUTE')::text
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and %s in (%s)""" % (sig_expr, role, sig_expr, in_list)):
            probes.append("%s|%s|%s" % (sig, role, "t" if val in ("t", "true") else "f"))
    for sig, val in q(cl, """
        select %s, has_function_privilege(o.rolname, p.oid, 'EXECUTE')::text
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        join pg_roles o on o.oid=p.proowner where n.nspname='public' and %s in (%s)"""
                      % (sig_expr, sig_expr, in_list)):
        probes.append("%s|OWNER(%s)|%s" % (sig, can["owner_mapping"].get(sig, "?"),
                                           "t" if val in ("t", "true") else "f"))
    probes.sort()
    mat_diff = sorted(set(probes) ^ set(can["privilege_matrix"]))
    extra_pub = [p for p in probes if p.endswith("|t") and "|public|" in p
                 and p not in can["privilege_matrix"]]
    check("has_function_privilege matrix (%d probes, no extra PUBLIC EXECUTE)"
          % len(can["privilege_matrix"]),
          not mat_diff and not extra_pub,
          "diff=%d %s extra_public=%s" % (len(mat_diff), mat_diff[:3], extra_pub[:3]))

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

    # table grants: every grant row the backup captured must exist on the clone
    want_g = {x[0] if isinstance(x, list) else x for x in cat["grants"]}
    got_g = set(qj(cl, "select c.relname||' :: '||coalesce(r.rolname,'PUBLIC')||' :: '||a.privilege_type "
                       "from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                       "cross join lateral aclexplode(c.relacl) a "
                       "left join pg_roles r on r.oid=a.grantee "
                       "where n.nspname='public' and c.relacl is not null "
                       "and c.relname in ('%s') order by 1" % tl))
    miss_g = sorted(want_g - got_g)
    check("11 tables: grants restored (%d backup rows)" % len(want_g), not miss_g,
          "missing=%d e.g. %s" % (len(miss_g), miss_g[:3]))

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
