#!/usr/bin/env python3
"""H-ACL planner — emits migrate.sql / rollback.sql for the freshness writer RPCs
from the *restored clone's* own catalog. Production is never contacted.

Scope (writer surface reachable by an untrusted caller):
  every VOLATILE function in schema public whose name matches the freshness
  family regex AND that PUBLIC, anon or authenticated can currently EXECUTE.

Keep-list — these stay reachable by `authenticated` because a browser session
calls them directly today; each one carries its own in-body authorisation guard
(or is pinned as a known follow-up):
  public.enqueue_bsr_backfill(text,integer)      drawer backfill button, has_role guard
  public.finmind_pool_set_budget(text,integer)   admin console, has_role guard
  public.finmind_pool_reset()                    admin console, NO in-body guard (FOLLOW-UP)

Everything else becomes service_role-only. Rollback re-issues the exact aclitem
set observed before the migration, so the ACL fingerprint returns bit-for-bit.
"""
import json
import os
import re
import subprocess
import sys

FAMILY = r'(bsr|chip|rollup|queue|backfill|enqueue|claim|prefetch|finmind|converge|materialize|institutional)'

KEEP_AUTHENTICATED = {
    "public.enqueue_bsr_backfill(p_stock_id text, p_days integer)",
    "public.finmind_pool_set_budget(_pool text, _budget integer)",
    "public.finmind_pool_reset()",
}

INVENTORY_SQL = """
SELECT json_agg(x ORDER BY x->>'sig')::text FROM (
  SELECT json_build_object(
    'sig', 'public.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    'name', p.proname,
    'args', pg_get_function_identity_arguments(p.oid),
    'owner', o.rolname,
    'secdef', p.prosecdef,
    'volatility', p.provolatile::text,
    'search_path', coalesce(array_to_string(p.proconfig, ','), ''),
    'def_sha256', encode(sha256(convert_to(pg_get_functiondef(p.oid), 'UTF8')), 'hex'),
    'acl', coalesce(p.proacl::text, '(default)'),
    'pub', has_function_privilege('public', p.oid, 'EXECUTE'),
    'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
    'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) AS x
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_roles o ON o.oid = p.proowner
  WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.provolatile = 'v'
    AND p.proname ~ '%s'
    AND (has_function_privilege('public', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
) s
""" % FAMILY


def psql(conn, sql):
    r = subprocess.run(["psql", conn, "-AtqX", "-c", sql], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("psql failed: " + r.stderr.strip())
    return r.stdout.strip()


def acl_statements(sig, acl):
    """Turn an aclitem[] literal into the GRANT statements that recreate it."""
    out = []
    if acl == "(default)":
        return out
    for item in re.findall(r'([^,{}]+)', acl.strip("{}")):
        grantee, rest = item.split("=", 1)
        privs = rest.split("/")[0]
        if "X" not in privs:
            continue
        who = "PUBLIC" if grantee == "" else '"%s"' % grantee
        out.append("GRANT EXECUTE ON FUNCTION %s TO %s;" % (sig, who))
    return out


def main():
    conn, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    raw = psql(conn, INVENTORY_SQL) or "[]"
    inv = json.loads(raw)
    json.dump(inv, open(os.path.join(outdir, "acl_inventory.json"), "w"), indent=1, sort_keys=True)

    migrate, rollback, hardened, kept = [], [], [], []
    migrate.append("-- H-ACL: lock the freshness writer RPC surface to service_role.")
    rollback.append("-- H-ACL rollback: restore the exact pre-migration EXECUTE ACL.")
    for f in inv:
        sig = f["sig"]
        rollback.append("REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role;" % sig)
        rollback.extend(acl_statements(sig, f["acl"]))
        if sig in KEEP_AUTHENTICATED:
            kept.append(sig)
            migrate.append("REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon;" % sig)
            migrate.append("GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role;" % sig)
            continue
        hardened.append(sig)
        migrate.append("REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated;" % sig)
        migrate.append("GRANT EXECUTE ON FUNCTION %s TO service_role;" % sig)

    open(os.path.join(outdir, "h_acl_migrate.sql"), "w").write("\n".join(migrate) + "\n")
    open(os.path.join(outdir, "h_acl_rollback.sql"), "w").write("\n".join(rollback) + "\n")
    json.dump({"in_scope": len(inv), "hardened": hardened, "kept_authenticated": kept},
              open(os.path.join(outdir, "acl_plan.json"), "w"), indent=1)
    print("in_scope=%d hardened=%d kept=%d" % (len(inv), len(hardened), len(kept)))


if __name__ == "__main__":
    main()
