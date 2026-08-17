#!/usr/bin/env python3
"""S0-2b.acl — canonical ACL tuple baseline (production read-only).

The previous ACL baseline stored the raw ``proacl`` *string* and the verifier
compared it with a loose normaliser. That is not a proof: array ordering,
default ACLs and role-name noise can hide a real grant difference.

This generator stores exploded, sorted, canonical tuples instead:

    schema.function(identity_args)|grantor|grantee(PUBLIC for oid 0)|privilege|is_grantable

produced from ``aclexplode(coalesce(proacl, acldefault('f', proowner)))`` so a
function that never had an explicit ACL is still represented by its implicit
default ACL rather than by the string ``(default)``.

Artifacts written to db/r1/c/S0/backup/:
  acl_canonical.json  tuples for the 28 watchset signatures + the 37 canonical
                      keys + an owner mapping + the role inventory + the
                      has_function_privilege expectation matrix.

Production access: SELECT on pg_proc / pg_roles / pg_namespace only.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from s0_lib import OUT, psql, sha256_text, write_json  # noqa: E402

BK = os.path.join(OUT, "backup")

# roles the privilege matrix is probed against; PUBLIC is probed as the
# pseudo-role "public" accepted by has_function_privilege.
MATRIX_ROLES = ["public", "anon", "authenticated", "service_role"]


def watchset_signatures():
    """The 28 signatures frozen by db/r1/p/acl-25.json (the R1-P watchset)."""
    p = os.path.join(OUT, "..", "..", "p", "acl-25.json")
    items = json.load(open(os.path.abspath(p)))["items"]
    return [i["signature"] for i in items]


def main():
    os.makedirs(BK, exist_ok=True)
    sigs = watchset_signatures()
    assert len(sigs) == 28, len(sigs)
    in_list = ",".join("'" + s.replace("'", "''") + "'" for s in sigs)

    sig_expr = ("'public.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'")

    # ---- exploded canonical tuples --------------------------------------
    rows = psql("""
        select %s as sig,
               coalesce(gr.rolname,'PUBLIC') as grantor,
               coalesce(ge.rolname,'PUBLIC') as grantee,
               a.privilege_type,
               a.is_grantable::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        left join pg_roles gr on gr.oid = a.grantor
        left join pg_roles ge on ge.oid = a.grantee
        where n.nspname = 'public' and %s in (%s)
        order by 1,2,3,4
    """ % (sig_expr, sig_expr, in_list))

    tuples = sorted("%s|%s|%s|%s|%s" % (r[0], r[1], r[2], r[3], "t" if r[4] in ("t", "true") else "f")
                    for r in rows)

    # ---- owner mapping ---------------------------------------------------
    owners = {r[0]: r[1] for r in psql("""
        select %s, o.rolname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        join pg_roles o on o.oid = p.proowner
        where n.nspname='public' and %s in (%s) order by 1
    """ % (sig_expr, sig_expr, in_list))}

    # ---- 37 canonical keys (definition frozen by acl-25.json) ------------
    canonical = sorted(set(
        "%s|%s|%s" % (r[0], r[2], r[3]) for r in rows
        if r[2] in ("anon", "PUBLIC") and r[3] == "EXECUTE"))

    # ---- has_function_privilege expectation matrix -----------------------
    probes = []
    for role in MATRIX_ROLES:
        rs = psql("""
            select %s, has_function_privilege(%s, p.oid, 'EXECUTE')::text
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and %s in (%s) order by 1
        """ % (sig_expr, "'" + role + "'", sig_expr, in_list))
        for sig, val in rs:
            probes.append("%s|%s|%s" % (sig, role, "t" if val in ("t", "true") else "f"))
    for sig, val in psql("""
        select %s, has_function_privilege(o.rolname, p.oid, 'EXECUTE')::text
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        join pg_roles o on o.oid=p.proowner
        where n.nspname='public' and %s in (%s) order by 1
    """ % (sig_expr, sig_expr, in_list)):
        probes.append("%s|OWNER(%s)|%s" % (sig, owners[sig], "t" if val in ("t", "true") else "f"))
    probes.sort()

    # ---- role inventory: which grantees/grantors exist on production -----
    role_names = sorted({t.split("|")[1] for t in tuples} | {t.split("|")[2] for t in tuples}
                        | set(owners.values()))
    prod_roles = {r[0]: r[1] for r in psql(
        "select rolname, rolsuper::text from pg_roles where rolname in (%s) order by 1"
        % ",".join("'" + r + "'" for r in role_names if r != "PUBLIC"))}

    doc = {
        "artifact": "S0-2b.acl canonical ACL tuple baseline",
        "production_touch": "read-only (catalog SELECT only)",
        "tuple_definition": "schema.function(identity_args)|grantor|grantee(PUBLIC=oid 0)|privilege_type|is_grantable",
        "source_expression": "aclexplode(coalesce(proacl, acldefault('f', proowner)))",
        "signatures": sorted(sigs),
        "signature_total": len(sigs),
        "tuples": tuples,
        "tuple_total": len(tuples),
        "tuples_sha256": sha256_text("\n".join(tuples)),
        "owner_mapping": owners,
        "owner_mapping_sha256": sha256_text(json.dumps(owners, sort_keys=True)),
        "canonical_keys": canonical,
        "canonical_keys_total": len(canonical),
        "canonical_key_definition": "schema.function(identity_args)|grantee|privilege (anon/PUBLIC EXECUTE only)",
        "canonical_anon_execute": sum(1 for k in canonical if "|anon|" in k),
        "canonical_public_execute": sum(1 for k in canonical if "|PUBLIC|" in k),
        "privilege_matrix": probes,
        "privilege_matrix_sha256": sha256_text("\n".join(probes)),
        "roles_on_production": prod_roles,
        "role_exclusions": {
            "excluded_role_names": [],
            "rationale": "no role is excluded. sandbox_exec_* roles are REAL production roles "
                         "(they hold EXECUTE on the watchset), so the restore bundle recreates them "
                         "by name and reproduces their tuples verbatim instead of normalising them away. "
                         "PUBLIC / anon / authenticated / service_role / ledger_owner / company_admin "
                         "are never excluded.",
            "sandbox_exec_roles_present_on_production": sorted(
                r for r in prod_roles if r.startswith("sandbox_exec_")),
        },
    }
    h = write_json(os.path.join(BK, "acl_canonical.json"), doc)
    print(json.dumps({"tuples": len(tuples), "signatures": len(sigs),
                      "canonical_keys": len(canonical),
                      "anon_execute": doc["canonical_anon_execute"],
                      "public_execute": doc["canonical_public_execute"],
                      "matrix_probes": len(probes),
                      "roles": list(prod_roles),
                      "file_sha256": h}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
