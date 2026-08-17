#!/usr/bin/env python3
"""S0 read-only preflight (production zero-touch).

只做 SELECT / catalog read。輸出 evidence 到 db/r1/c/S0/。
Gates: S0-1 lineage / S0-3 exec env / S0-5 inventory / S0-6 freshness snapshot.
(S0-2 backup capability 與 S0-4 ACL 由各自工具產出。)
"""
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
OUT = os.path.join(ROOT, "db", "r1", "c", "S0")
MIG = os.path.join(ROOT, "supabase", "migrations")
FUNCS = os.path.join(ROOT, "supabase", "functions")

failures = []


def q(sql, retries=5):
    """Read-only psql. The pooler intermittently returns EAUTHQUERY timeouts,
    which are transient connection failures, so retry with backoff."""
    import time
    last = ""
    for attempt in range(retries):
        r = subprocess.run(["psql", "-Atq", "-F", "\x1f", "-c", sql],
                           capture_output=True, text=True)
        if r.returncode == 0:
            return [line.split("\x1f") for line in r.stdout.strip().splitlines() if line != ""]
        last = r.stderr
        if "EAUTHQUERY" in last or "could not connect" in last or "connection to server" in last:
            time.sleep(2 * (attempt + 1))
            continue
        break
    raise SystemExit("psql failed: %s\n%s" % (sql[:120], last))


def sha(s):
    return hashlib.sha256(s.encode()).hexdigest()


def fail(gate, msg):
    failures.append("%s: %s" % (gate, msg))
    print("  FAIL %s: %s" % (gate, msg))


# ---------------------------------------------------------------- S0-1 lineage
KNOWN_PRE_REPO = {
    "20260227131741": "create line_binding_codes",
    "20260227155729": "seed advisor experts",
    "20260308110124": "drop table trade_signals",
    "20260316122524": "add quantity_unit",
    "20260408065758": "create stock_names",
}
DUPLICATE_RECORDS = {
    "20260721135648": "20260721135623",
    "20260722023140": "20260722023118",
    "20260724071600": "20260724071542",
    "20260725213324": "20260725213311",
    "20260729132638": "20260729132621",
}
APPLIED_NOT_RECORDED = {
    "20260812211500": {
        "file": "20260812211500_bsr_claim_token_slot.sql",
        "proof_fn": "claim_bsr_queue_jobs",
        "proof_needle": "token_slot",
    }
}


def gate_lineage():
    """Validate the lineage capture produced by db/r1/c/S0/lineage.sql.

    supabase_migrations is not readable by the sandbox psql role, so the SQL is
    executed read-only through the database query tool and its single JSON row
    is stored as lineage_query.json. This gate re-derives every assertion from
    that capture plus local repo state and live catalog proofs.
    """
    print("S0-1 migration lineage")
    cap_path = os.path.join(OUT, "lineage_query.json")
    if not os.path.isfile(cap_path):
        fail("S0-1", "missing lineage_query.json (run lineage.sql via the DB query tool first)")
        return {"error": "missing lineage_query.json"}
    cap = json.load(open(cap_path))

    repo = {}
    for f in sorted(os.listdir(MIG)):
        m = re.match(r"^(\d{14})_(.+)\.sql$", f)
        if not m:
            fail("S0-1", "unparsable migration filename %s" % f)
            continue
        repo[m.group(1)] = f

    if cap["repo_total"] != len(repo):
        fail("S0-1", "capture repo_total %s != local repo file count %s" % (cap["repo_total"], len(repo)))
    if cap["unknown_remote"]:
        fail("S0-1", "unknown remote migrations: %s" % cap["unknown_remote"])

    got_known = sorted(cap["known_pre_repo"])
    if got_known != sorted(KNOWN_PRE_REPO):
        fail("S0-1", "known_pre_repo drift: %s" % got_known)
    for v in got_known:
        if v in repo:
            fail("S0-1", "%s classified pre-repo but a repo file exists" % v)

    dup_map = {d["version"]: d["maps_to"] for d in cap["duplicate_records"]}
    if dup_map != DUPLICATE_RECORDS:
        fail("S0-1", "duplicate_records drift: %s" % dup_map)
    for v, target in dup_map.items():
        if target not in repo:
            fail("S0-1", "duplicate record %s maps to %s which has no repo file" % (v, target))

    expected_sum = cap["matched"] + len(cap["known_pre_repo"]) + len(cap["duplicate_records"]) + len(cap["unknown_remote"])
    if expected_sum != cap["remote_total"]:
        fail("S0-1", "classification does not partition remote rows (%s != %s)" % (expected_sum, cap["remote_total"]))

    for v in cap["repo_only"]:
        spec = APPLIED_NOT_RECORDED.get(v)
        if not spec:
            fail("S0-1", "repo migration %s neither recorded nor classified" % v)
            continue
        got = q("select coalesce(bool_or(prosrc like '%%%s%%'),false)::text, coalesce(md5(string_agg(prosrc,'')),'') "
                "from pg_proc where proname = '%s'" % (spec["proof_needle"], spec["proof_fn"]))
        if got[0][0] not in ("t", "true"):
            fail("S0-1", "%s classified applied-not-recorded but %s lacks %s"
                 % (v, spec["proof_fn"], spec["proof_needle"]))
        if got[0][1] != cap["applied_not_recorded_proof"]["claim_bsr_queue_jobs_prosrc_md5"]:
            fail("S0-1", "%s proof body drifted since capture (%s)" % (v, got[0][1]))
    for v in APPLIED_NOT_RECORDED:
        if v not in cap["repo_only"]:
            fail("S0-1", "%s is classified applied-not-recorded but is now recorded remotely" % v)

    # known_pre_repo object proofs, re-run live against the catalog
    proofs = {
        "20260227131741": ("select (to_regclass('public.line_binding_codes') is not null)::text", "true"),
        "20260316122524": ("select count(*)::text from information_schema.columns where table_schema='public' "
                           "and column_name='quantity_unit' and table_name in ('expert_signals','trade_records')", "2"),
        "20260408065758": ("select (to_regclass('public.stock_names') is not null)::text", "true"),
        "20260308110124": ("select (to_regclass('public.trade_signals') is not null)::text", "true"),
    }
    proof_out = {}
    for v, (sql, expect) in proofs.items():
        got = q(sql)[0][0]
        proof_out[v] = {"sql": sql, "expected": expect, "actual": got}
        if got != expect:
            fail("S0-1", "known_pre_repo %s proof mismatch (%s != %s)" % (v, got, expect))

    art = {
        "rule": "key = case when name ~ '^[0-9]{14}_' then split_part(name,'_',1) else version end; "
                "then +-60s tolerance match against repo filename prefix",
        "capture": cap,
        "remote_total": cap["remote_total"],
        "repo_total": len(repo),
        "matched": cap["matched"],
        "known_pre_repo": {v: KNOWN_PRE_REPO[v] for v in got_known},
        "duplicate_records": dup_map,
        "applied_not_recorded": {
            v: dict(APPLIED_NOT_RECORDED[v],
                    file_md5=hashlib.md5(open(os.path.join(MIG, APPLIED_NOT_RECORDED[v]["file"]), "rb").read()).hexdigest())
            for v in cap["repo_only"] if v in APPLIED_NOT_RECORDED},
        "unknown_remote": cap["unknown_remote"],
        "known_pre_repo_proofs": proof_out,
        "remote_version_list_md5": cap["remote_version_list_md5"],
        "repo_version_list_sha256": sha(",".join(sorted(repo))),
    }
    print("  remote=%d repo=%d matched=%d known_pre_repo=%d duplicate=%d applied_not_recorded=%d unknown=%d"
          % (cap["remote_total"], len(repo), cap["matched"], len(got_known), len(dup_map),
             len(art["applied_not_recorded"]), len(cap["unknown_remote"])))
    return art



# ------------------------------------------------------------- S0-3 exec env
def gate_execenv():
    print("S0-3 execution environment")
    long_tx = q("select coalesce(count(*),0)::text from pg_stat_activity "
                "where xact_start < now()-interval '60 seconds' and state <> 'idle' and pid <> pg_backend_pid()")[0][0]
    blocked = q("select count(*)::text from pg_locks where not granted")[0][0]
    if long_tx != "0":
        fail("S0-3", "long transactions = %s" % long_tx)
    if blocked != "0":
        fail("S0-3", "blocked locks = %s" % blocked)
    print("  long_tx=%s blocked_locks=%s" % (long_tx, blocked))
    return {"long_tx": int(long_tx), "blocked_locks": int(blocked)}


# ------------------------------------------------------------ S0-5 inventory
def gate_inventory():
    print("S0-5 writer inventory re-roll-call")
    inv = json.load(open(os.path.join(ROOT, "db", "r1", "d", "writer-inventory.json")))
    res = {"db_writers": [], "triggers": [], "edge_writers": []}

    live_fns = {r[0]: r[1] for r in q(
        "select p.oid::regprocedure::text, md5(p.prosrc) from pg_proc p "
        "join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")}
    norm = {}
    for sig, h in live_fns.items():
        norm[re.sub(r"\s+", " ", sig).strip()] = h
    for w in inv["writers"]:
        sig = w["signature"]
        name = sig.split("(")[0]
        short = name.split(".")[-1]
        cands = [s for s in norm if s.split("(")[0].split(".")[-1] == short]
        ok = bool(cands)
        res["db_writers"].append({"id": w["id"], "signature": sig, "present": ok,
                                  "live_signatures": cands,
                                  "prosrc_md5": [norm[c] for c in cands]})
        if not ok:
            fail("S0-5", "db writer missing: %s" % sig)

    live_trg = {r[0]: r[1] for r in q(
        "select t.tgname, c.relname from pg_trigger t join pg_class c on c.oid=t.tgrelid "
        "join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal")}
    for t in inv["triggers"]:
        nm = t["trigger"] if isinstance(t, dict) else t
        present = nm in live_trg
        res["triggers"].append({"trigger": nm, "table": live_trg.get(nm), "present": present})
        if not present:
            fail("S0-5", "trigger missing: %s" % nm)

    for e in inv["edge_writers"]:
        src = e.get("source", "")
        d = src.split("/")[2] if src.startswith("supabase/functions/") else None
        present = bool(d) and os.path.isdir(os.path.join(FUNCS, d))
        entry = os.path.join(ROOT, src)
        digest = hashlib.sha256(open(entry, "rb").read()).hexdigest() if os.path.isfile(entry) else None
        res["edge_writers"].append({"id": e["id"], "source": src, "present": present, "sha256": digest})
        if not present:
            fail("S0-5", "edge writer source missing: %s" % src)

    counts = {"db_writers": len(res["db_writers"]), "triggers": len(res["triggers"]),
              "edge_writers": len(res["edge_writers"])}
    for k, v in inv["counts"].items():
        if counts.get(k) != v:
            fail("S0-5", "count drift %s: %s != baseline %s" % (k, counts.get(k), v))
    print("  db_writers=%(db_writers)d triggers=%(triggers)d edge_writers=%(edge_writers)d" % counts)
    res["counts"] = counts
    res["baseline_counts"] = inv["counts"]
    return res


# ------------------------------------------------------- S0-6 freshness snapshot
def gate_freshness():
    print("S0-6 freshness baseline snapshot")
    snap = {}
    snap["tw_bsr_daily_latest"] = q(
        "select coalesce(max(trade_date)::text,'-'), count(*)::text from tw_bsr_daily")[0]
    snap["tw_bsr_daily_last24h_rows"] = q(
        "select count(*)::text from tw_bsr_daily where created_at > now()-interval '24 hours'")[0][0]
    snap["attempt_logs_last24h"] = q(
        "select count(*)::text from tw_bsr_attempt_logs where created_at > now()-interval '24 hours'")[0][0]
    snap["coverage_latest"] = q(
        "select coalesce(max(trade_date)::text,'-'), count(*)::text from bsr_coverage_daily "
        "where trade_date = (select max(trade_date) from bsr_coverage_daily)")[0]
    snap["queue"] = dict((r[0], int(r[1])) for r in q(
        "select status, count(*)::text from tw_bsr_sync_queue group by status"))
    snap["queue_unique_symbols"] = int(q("select count(distinct stock_id)::text from tw_bsr_sync_queue")[0][0])
    snap["kill_switches"] = dict((r[0], r[1]) for r in q("select key, enabled::text from system_kill_switches"))
    snap["stock_names"] = dict((r[0], int(r[1])) for r in q(
        "select coalesce(market,'(null)'), count(*)::text from stock_names group by 1"))
    snap["prefetch_targets"] = dict((r[0], int(r[1])) for r in q(
        "select coalesce(source,'(null)'), count(*)::text from chips_prefetch_targets group by 1"))
    # schema cron is not readable by the sandbox psql role; the capture is taken
    # read-only through the DB query tool and stored as cron_capture.json.
    cron_path = os.path.join(OUT, "cron_capture.json")
    if os.path.isfile(cron_path):
        cron = json.load(open(cron_path))
        snap["cron_106_107"] = cron["jobs"]
        snap["cron_runs_24h"] = cron["runs_24h"]
        snap["cron_active_jobs_total"] = cron["active_jobs_total"]
        for j in cron["jobs"]:
            if not j["active"]:
                fail("S0-6", "cron job %s (%s) inactive" % (j["jobid"], j["jobname"]))
    else:
        fail("S0-6", "missing cron_capture.json")
    snap["checkup_storage_holdings"] = int(q(
        "select count(*)::text from checkup_storage where key='pf-holdings-v2'")[0][0])
    print("  bsr_daily_24h=%s attempt_logs_24h=%s queue=%s"
          % (snap["tw_bsr_daily_last24h_rows"], snap["attempt_logs_last24h"], snap["queue"]))
    return snap


def main():
    os.makedirs(OUT, exist_ok=True)
    started = datetime.now(timezone.utc).isoformat()
    artifacts = {
        "lineage.json": gate_lineage(),
        "execenv.json": gate_execenv(),
        "inventory.json": gate_inventory(),
        "freshness_baseline.json": gate_freshness(),
    }
    hashes = {}
    for name, data in artifacts.items():
        body = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True)
        open(os.path.join(OUT, name), "w").write(body + "\n")
        hashes[name] = sha(body)
    summary = {
        "stage": "S0",
        "mode": "read-only (SELECT / catalog only)",
        "started_utc": started,
        "finished_utc": datetime.now(timezone.utc).isoformat(),
        "artifact_sha256": hashes,
        "failures": failures,
        "total_failures": len(failures),
    }
    open(os.path.join(OUT, "s0_summary.json"), "w").write(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print("S0 TOTAL FAILURES=%d" % len(failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
