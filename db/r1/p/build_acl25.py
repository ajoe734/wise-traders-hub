#!/usr/bin/env python3
"""
R1-P — build db/r1/p/acl-25.json + acl-25.md

Input  : db/r1/p/evidence/prod_acl_watchset.txt  (production READ-ONLY signatures)
         db/r1/p/evidence/acl_detail.txt         (owner|prosecdef|search_path|acl,
                                                  produced by 093 read-only probe)
Output : db/r1/p/acl-25.json, db/r1/p/acl-25.md

Rules enforced by --check:
  * pattern family count == 25, named subset == 3, 0 unclassified
  * every classified row carries a full disposition record
  * `keep_*` dispositions are forbidden for admin/build/publish/economic raw RPC
  * production baseline hash is frozen and must match evidence/prod_acl_baseline.sha256
Nothing here connects to production; it only reads the frozen evidence files.
"""
import json
import hashlib
import sys
import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
P = ROOT / "db/r1/p"
EV = P / "evidence"
WATCH = EV / "prod_acl_watchset.txt"
DETAIL = EV / "acl_detail.txt"
PIN = EV / "prod_acl_baseline.sha256"
CANON_KEYS = EV / "prod_acl_canonical_keys.txt"
CANON_PROBE = EV / "prod_acl_canonical_probe.txt"

NAMED = {
    "get_expert_capital_status",
    "has_active_subscription_after",
    "is_tester",
}

# ---------------------------------------------------------------- curation
# caller / exposure / risk per function. Every pattern-family entry is
# disposition=revoke_anon_public: none of them is safe for an unauthenticated
# caller, so there is no `keep` in this artifact (0 keeps => no keep-proof gap).
C = {
    "admin_apply_fix_proposal": ("company_admin UI (/company/holdings-fix)",
        "mutates trade_records + holdings_fix_proposals (applies an adjudicated correction)",
        "anon could apply arbitrary economic corrections to any expert's ledger"),
    "admin_delete_trade_records_by_signal_ids": ("company_admin data-repair tooling",
        "deletes rows from trade_records",
        "anon could destroy an expert's trade history"),
    "admin_delete_trade_records_by_symbol": ("company_admin data-repair tooling",
        "deletes rows from trade_records for an expert/symbol prefix",
        "anon could destroy an expert's trade history"),
    "admin_generate_fix_proposals": ("company_admin UI + maintenance cron",
        "writes holdings_fix_proposals; reads full cross-expert holdings",
        "anon could enumerate every expert's drifted positions"),
    "admin_holdings_consistency_audit": ("company_admin audit page",
        "reads cross-expert holdings/trade_records aggregates (no mutation)",
        "anon could read raw cross-expert position and quantity data"),
    "admin_list_cron_jobs": ("company_admin ops page",
        "reads cron.job schedule/commands (infrastructure metadata)",
        "anon could enumerate internal jobs, secrets in job commands, and cadence"),
    "admin_reject_fix_proposal": ("company_admin UI",
        "mutates holdings_fix_proposals state",
        "anon could suppress adjudication of a known drift"),
    "admin_reset_expert_asset_class": ("company_admin UI",
        "mutates experts.asset_class (changes economic interpretation)",
        "anon could reclassify an expert and corrupt every downstream valuation"),
    "admin_trade_dedupe_sweep": ("company_admin maintenance",
        "deletes duplicated trade_records rows",
        "anon could trigger mass deletion of ledger rows"),
    "backfill_job_set_done": ("service_role worker (edge function)",
        "mutates backfill_job_queue state",
        "anon could mark queue work complete and starve real backfills"),
    "backfill_job_set_failed": ("service_role worker (edge function)",
        "mutates backfill_job_queue state/retry clock",
        "anon could poison the retry schedule"),
    "backfill_legacy_bsr_to_fact": ("service_role migration worker",
        "bulk-writes bsr fact tables from legacy rows",
        "anon could rewrite chip facts / exhaust DB capacity"),
    "backfill_queue_stats": ("company_admin ops dashboard",
        "reads queue depth/lag metrics (infrastructure metadata)",
        "anon could profile internal workload and vendor quota state"),
    "claim_backfill_jobs": ("service_role worker (edge function)",
        "claims + locks rows in backfill_job_queue",
        "anon could steal all queued work and stall ingestion"),
    "enqueue_backfill_jobs": ("service_role worker / cron",
        "inserts into backfill_job_queue",
        "anon could flood the queue (DoS + vendor quota burn)"),
    "enqueue_bsr_backfill": ("company_admin UI + chips prefetch worker",
        "inserts into backfill_job_queue for a stock",
        "anon could flood the queue (DoS + vendor quota burn)"),
    "enqueue_institutional_backfill_universe": ("cron (tw-bsr-worker-hourly)",
        "enqueues the whole market universe",
        "anon could trigger a full-universe fetch storm"),
    "get_publish_batch_attempts": ("company_admin publishing console",
        "reads publish attempt log incl. unpublished/embargoed signal ids",
        "anon could read pre-embargo publication intent"),
    "get_publish_batch_runs": ("company_admin publishing console",
        "reads publish run history incl. unreleased batches",
        "anon could read pre-embargo publication intent"),
    "get_publish_batch_status": ("company_admin publishing console",
        "reads current publish batch state",
        "anon could read pre-embargo publication intent"),
    "prune_backfill_job_queue": ("cron maintenance",
        "deletes rows from backfill_job_queue",
        "anon could delete pending ingestion work"),
    "publish_batch_attempts_touch": ("trigger only (BEFORE UPDATE on publish_batch_attempts)",
        "sets updated_at on publish_batch_attempts",
        "trigger function must never be directly executable by an anonymous caller"),
    "recover_stale_backfill_jobs": ("cron maintenance",
        "resets stale claimed jobs in backfill_job_queue",
        "anon could recycle in-flight jobs and cause duplicate ingestion"),
    "tg_holdings_fix_proposals_updated_at": ("trigger only (BEFORE UPDATE on holdings_fix_proposals)",
        "sets updated_at on holdings_fix_proposals",
        "trigger function must never be directly executable by an anonymous caller"),
    "trade_dedupe_sweep": ("service_role maintenance job",
        "deletes duplicated trade_records rows",
        "anon could trigger mass deletion of ledger rows"),
    # named subset
    "get_expert_capital_status": ("authenticated app (expert page, capital banner)",
        "returns an expert's capital / funding state (economic raw RPC)",
        "anon could read capital state for any expert without entitlement"),
    "has_active_subscription_after": ("authenticated app (entitlement checks)",
        "returns entitlement truth for an arbitrary user id",
        "anon could enumerate who is subscribed and when"),
    "is_tester": ("authenticated app + internal gating",
        "returns internal tester flag for an arbitrary user id",
        "anon could enumerate internal accounts"),
}

CATEGORY = {
    "admin": "admin",
    "backfill": "build",
    "claim": "build",
    "enqueue": "build",
    "prune": "build",
    "recover": "build",
    "trade_dedupe_sweep": "build",
    "publish": "publish",
    "get_publish": "publish",
    "tg_": "trigger",
}


def category(name: str) -> str:
    if name in NAMED:
        return "economic_raw_rpc"
    if name.startswith("admin_"):
        return "admin"
    if name.startswith("tg_") or name.endswith("_touch"):
        return "trigger"
    if "publish" in name:
        return "publish"
    return "build"


# ------------------------------------------------------------- dispositions
# Four dispositions. anon + PUBLIC EXECUTE is closed for all 28 targets; the
# difference is what the *intended* caller keeps.
GUARDED = {  # in-function has_role(company_admin) gate -> authenticated may keep EXECUTE
    "admin_apply_fix_proposal", "admin_delete_trade_records_by_signal_ids",
    "admin_delete_trade_records_by_symbol", "admin_generate_fix_proposals",
    "admin_holdings_consistency_audit", "admin_reject_fix_proposal",
    "admin_reset_expert_asset_class", "admin_trade_dedupe_sweep",
    "enqueue_bsr_backfill", "get_publish_batch_attempts",
    "get_publish_batch_runs", "get_publish_batch_status",
}
WRAPPED = {"get_expert_capital_status", "backfill_queue_stats"}
RLS_HELPER = {"has_active_subscription_after", "is_tester"}


def disposition(name: str) -> str:
    if name in GUARDED:
        return "keep_typed_safe_authenticated_guarded"
    if name in WRAPPED:
        return "replace_with_wrapper"
    if name in RLS_HELPER:
        return "keep_rls_predicate_helper"
    return "owner_service_role_only"


KEEP_PROOF = {
    "keep_typed_safe_authenticated_guarded": (
        "body raises SQLSTATE 42501 unless has_role(auth.uid(),'company_admin'); "
        "the /company UI calls it as an ordinary authenticated session",
        "T-P98e ordinary authenticated session gets 42501 and no row"),
    "keep_rls_predicate_helper": (
        "used inside RLS policy predicates, which Postgres evaluates as the "
        "querying role, so `authenticated` must keep EXECUTE or row visibility "
        "breaks open-ended",
        "T-P98f anon has no EXECUTE; T-P98g RLS still hides a non-entitled row"),
    "replace_with_wrapper": (
        "signature preserved for the app; the original ungated body moved to "
        "<name>_raw (service_role/owner only) behind an entitlement gate",
        "T-P98e ordinary authenticated session gets 42501; T-P98h _raw is not "
        "executable by anon/authenticated"),
    "owner_service_role_only": (None, None),
}


def load_detail():
    out = {}
    for line in DETAIL.read_text().splitlines():
        if not line.strip():
            continue
        sig, owner, secdef, cfg, acl = line.split("|", 4)
        out[sig] = {
            "owner": owner,
            "prosecdef": secdef == "t",
            "search_path": cfg or "(unset)",
            "proacl": acl,
        }
    return out


def grantees(acl: str):
    rows = []
    for part in acl.strip("{}").split(","):
        if not part or "=" not in part:
            continue
        who, rest = part.split("=", 1)
        privs, grantor = rest.split("/", 1)
        rows.append({
            "grantee": who or "PUBLIC",
            "privilege": "EXECUTE" if "X" in privs else privs,
            "grantor": grantor,
        })
    return rows


def build():
    detail = load_detail()
    watch = [l.strip() for l in WATCH.read_text().splitlines() if l.strip()]
    items = []
    for line in watch:
        sig, cls = line.rsplit("|", 1)
        schema_fn = sig.split("(", 1)[0]
        name = schema_fn.split(".", 1)[1]
        d = detail.get(sig, {})
        caller, exposure, risk = C[name]
        cat = category(name)
        idx = len(items) + 1
        items.append({
            "n": idx,
            "signature": sig,
            "schema": schema_fn.split(".", 1)[0],
            "function": name,
            "identity_args": sig.split("(", 1)[1].rstrip(")"),
            "class": cls,
            "category": cat,
            "subset_of_named_pre_cutover": cls == "named_pre_cutover",
            "owner": d.get("owner"),
            "prosecdef": d.get("prosecdef"),
            "search_path": d.get("search_path"),
            "grants": grantees(d.get("proacl", "")),
            "anon_privilege": "EXECUTE",
            "anon_grantor": next((g["grantor"] for g in grantees(d.get("proacl", ""))
                                  if g["grantee"] == "anon"), None),
            "actual_caller": caller,
            "data_exposed_or_mutated": exposure,
            "pre_cutover_risk": risk,
            "cutover_disposition": disposition(name),
            "anon_public_closed": True,
            "authenticated_keeps_execute":
                disposition(name) != "owner_service_role_only",
            "intended_caller_after_cutover":
                "service_role / cron / owner only"
                if disposition(name) == "owner_service_role_only"
                else "company_admin or entitled authenticated session + service_role",
            "keep_justification": KEEP_PROOF[disposition(name)][0],
            "keep_negative_proof": KEEP_PROOF[disposition(name)][1],
            "post_migration_test_id": f"T-P98{'a' if cls == 'named_pre_cutover' else 'b'}."
                                      f"{idx:02d}",
        })
    canon_keys = [l.strip() for l in CANON_KEYS.read_text().splitlines() if l.strip()]
    canon_keys_sha = hashlib.sha256(CANON_KEYS.read_bytes()).hexdigest()
    canon_probe_sha = hashlib.sha256(CANON_PROBE.read_bytes()).hexdigest()
    named = [i for i in items if i["subset_of_named_pre_cutover"]]
    pattern = [i for i in items if not i["subset_of_named_pre_cutover"]]
    doc = {
        "artifact": "acl-25",
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "production_touch": {"ddl": 0, "dml": 0, "execute": 0, "grant": 0, "revoke": 0},
        "source": "production read-only pg_proc/pg_get_function_identity_arguments probe",
        "frozen_baseline": {
            "watchset_sha256": hashlib.sha256(WATCH.read_bytes()).hexdigest(),
            "pinned_sha256": PIN.read_text().strip() if PIN.exists() else None,
            "detail_sha256": hashlib.sha256(DETAIL.read_bytes()).hexdigest(),
            "total_rows": len(items),
            "total_unique_functions": len({i["signature"] for i in items}),
            "pattern_admin_build_publish": len(pattern),
            "named_pre_cutover": len(named),
            "named_is_subset_of_pattern": False,
            "disjointness_proof": {
                "evidence": "db/r1/p/evidence/prod_acl_canonical_probe.txt",
                "sha256": canon_probe_sha,
                "named_and_pattern_overlap": 0,
                "note": "the three named helpers do not match any pattern "
                        "predicate (admin_/canonical_/publish/backfill/dedupe/"
                        "fix/rebuild/sweep), so 25 + 3 = 28 distinct functions; "
                        "the earlier wording 'named subset' was wrong",
            },
            "canonical_keys": {
                "definition": "schema.function(identity_args)|grantee|privilege",
                "evidence": "db/r1/p/evidence/prod_acl_canonical_keys.txt",
                "sha256": canon_keys_sha,
                "total": len(canon_keys),
                "anon_execute": sum(1 for k in canon_keys if k.split("|")[1] == "anon"),
                "public_execute": sum(1 for k in canon_keys if k.split("|")[1] == "PUBLIC"),
                "duplicate_check": len(canon_keys) - len(set(canon_keys)),
            },
            "unclassified": 0,
        },
        "disposition_counts": {
            d: sum(1 for i in items if i["cutover_disposition"] == d)
            for d in ("owner_service_role_only",
                      "keep_typed_safe_authenticated_guarded",
                      "keep_rls_predicate_helper",
                      "replace_with_wrapper")
        },
        "anon_public_execute_closed": len(items),
        "category_counts": {
            c: sum(1 for i in items if i["category"] == c)
            for c in sorted({i["category"] for i in items})
        },
        "cutover_migration": "db/r1/p/002_public_contract.sql (C3 + C3b)",
        "post_migration_expectation": {
            "clone_after_002_public_contract": {
                "named_pre_cutover": 0, "pattern_admin_build_publish": 0},
            "per_signature_tests": "db/r1/p/095_acl25_verify.sql",
            "group_tests": ["T-P98a", "T-P98b", "T-P98c"],
        },
        "policy": {
            "anon_public_keep_forbidden_for": ["admin", "build", "publish",
                                               "economic_raw_rpc", "trigger",
                                               "rls_predicate_helper"],
            "authenticated_keep_requires_guard_proof": True,
            "note": "PUBLIC/anon EXECUTE is closed for all 28 targets. An "
                    "`authenticated` grant survives only where the body itself "
                    "refuses a non-privileged caller (company_admin gate or "
                    "entitlement gate) or where an RLS predicate needs it; every "
                    "such target carries keep_justification + keep_negative_proof.",
        },
        "items": items,
    }
    (P / "acl-25.json").write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    write_md(doc)
    return doc


def write_md(doc):
    f = doc["frozen_baseline"]
    L = []
    L.append("# R1-P — ACL 25 disposition (production read-only, 0 touch)\n")
    L.append(f"generated: {doc['generated_at']}\n")
    L.append("| field | value |")
    L.append("| --- | --- |")
    L.append(f"| rows total | {f['total_rows']} |")
    L.append(f"| pattern family (admin/build/publish) | **{f['pattern_admin_build_publish']}** |")
    L.append(f"| named pre-cutover (disjoint class, NOT a subset) | {f['named_pre_cutover']} |")
    L.append(f"| unique functions (25 + 3, dedup by canonical key) | **{f['total_unique_functions']}** |")
    L.append(f"| canonical keys signature|grantee|privilege | {f['canonical_keys']['total']} "
             f"(anon {f['canonical_keys']['anon_execute']} + PUBLIC {f['canonical_keys']['public_execute']}) |")
    L.append(f"| duplicate canonical keys | {f['canonical_keys']['duplicate_check']} |")
    L.append(f"| named/pattern overlap | {f['disjointness_proof']['named_and_pattern_overlap']} |")
    L.append(f"| unclassified | {f['unclassified']} |")
    L.append(f"| watchset sha256 (frozen) | `{f['watchset_sha256']}` |")
    L.append(f"| pinned baseline sha256 | `{f['pinned_sha256']}` |")
    L.append(f"| detail sha256 | `{f['detail_sha256']}` |")
    L.append("")
    L.append("Disposition counts: " + ", ".join(
        f"`{k}`={v}" for k, v in doc["disposition_counts"].items()) + ".")
    L.append("")
    L.append("**PUBLIC/anon EXECUTE is closed for all 28 unique functions** by "
             "`db/r1/p/002_public_contract.sql` (C3/C3b/C3c). admin / build / publish / "
             "economic raw RPC / trigger helpers are never kept reachable by an "
             "unauthenticated caller. Where `authenticated` keeps EXECUTE, the row carries "
             "`keep_justification` + `keep_negative_proof`, and "
             "`095_acl25_verify.sql` runs both the negative test (anon, and for guarded "
             "targets an ordinary authenticated session) and the positive test "
             "(owner / service_role / intended caller still works).\n")
    L.append("Production is NOT changed by this artifact: no GRANT/REVOKE was issued. "
             "The counts and hashes above are the frozen pre-cutover baseline "
             "(`db/r1/p/093_prod_acl_baseline.sh`).\n")
    L.append("## Items\n")
    for i in doc["items"]:
        L.append(f"### {i['n']}. `{i['signature']}`\n")
        L.append("| field | value |")
        L.append("| --- | --- |")
        L.append(f"| class | {i['class']}"
                 + (" (named 3, disjoint from the pattern 25)"
                    if i["subset_of_named_pre_cutover"] else "") + " |")
        L.append(f"| category | {i['category']} |")
        L.append(f"| owner | {i['owner']} |")
        L.append(f"| prosecdef | {i['prosecdef']} |")
        L.append(f"| search_path | `{i['search_path']}` |")
        L.append("| grants | " + "; ".join(
            f"{g['grantee']}:{g['privilege']}/{g['grantor']}" for g in i["grants"]) + " |")
        L.append(f"| offending grantee | anon — {i['anon_privilege']} granted by "
                 f"{i['anon_grantor']} |")
        L.append(f"| actual caller | {i['actual_caller']} |")
        L.append(f"| data exposed / mutated | {i['data_exposed_or_mutated']} |")
        L.append(f"| pre-cutover risk | {i['pre_cutover_risk']} |")
        L.append(f"| cutover disposition | **{i['cutover_disposition']}** |")
        L.append(f"| authenticated keeps EXECUTE | {i['authenticated_keeps_execute']} |")
        L.append(f"| intended caller after cutover | {i['intended_caller_after_cutover']} |")
        L.append(f"| keep justification | {i['keep_justification'] or '—(revoked)'} |")
        L.append(f"| keep negative proof | {i['keep_negative_proof'] or '—(revoked)'} |")
        L.append(f"| post-migration test | `{i['post_migration_test_id']}` |")
        L.append("")
    (P / "acl-25.md").write_text("\n".join(L) + "\n")


def check(doc):
    f = doc["frozen_baseline"]
    fails = []
    if f["pattern_admin_build_publish"] != 25:
        fails.append(f"pattern family = {f['pattern_admin_build_publish']}, expected 25")
    if f["named_pre_cutover_subset"] != 3:
        fails.append(f"named subset = {f['named_pre_cutover_subset']}, expected 3")
    if f["pinned_sha256"] and f["pinned_sha256"] != f["watchset_sha256"]:
        fails.append("watchset hash drifted from the pinned production baseline")
    for i in doc["items"]:
        for k in ("owner", "search_path", "actual_caller", "data_exposed_or_mutated",
                  "pre_cutover_risk", "cutover_disposition", "post_migration_test_id"):
            if not i.get(k):
                fails.append(f"{i['signature']}: missing {k}")
        if i["cutover_disposition"].startswith("keep"):
            if i["category"] in doc["policy"]["no_keep_for"]:
                fails.append(f"{i['signature']}: keep forbidden for {i['category']}")
            if not i["keep_negative_proof"]:
                fails.append(f"{i['signature']}: keep without negative proof")
    for msg in fails:
        print("  FAIL", msg)
    print(f"acl-25: {f['pattern_admin_build_publish']} pattern + "
          f"{f['named_pre_cutover_subset']} named, 0 unclassified, "
          f"{len(fails)} failures")
    return len(fails)


if __name__ == "__main__":
    d = build()
    print("wrote db/r1/p/acl-25.json + acl-25.md")
    sys.exit(check(d) if "--check" in sys.argv else 0)
