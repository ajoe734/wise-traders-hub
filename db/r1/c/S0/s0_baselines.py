#!/usr/bin/env python3
"""S0-3 / item 3 — schema, data, pointer and hash baselines (production read-only).

Everything captured here is the exact comparison anchor for post-cutover
read-back. Row hashes are stable, order-independent digests over the business
columns that S1/S2 could disturb.
"""
import json
import collections
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from s0_lib import OUT, cli_q, psql, sha256_file, sha256_text, write_json  # noqa: E402


def scalar(sql):
    r = psql(sql)
    return r[0][0] if r else None


def main():
    b = {}

    # ---------------------------------------------------------------- schema
    b["schema"] = {
        "migrations_applied": cli_q("select count(*) as n from supabase_migrations.schema_migrations")[0]["n"],
        "migrations_head": cli_q("select version from supabase_migrations.schema_migrations "
                                 "order by version desc limit 1")[0]["version"],
        "search_path_public_tables": int(scalar(
            "select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace "
            "where n.nspname='public' and c.relkind='r'")),
        "public_functions": int(scalar(
            "select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname='public'")),
        "public_policies": int(scalar("select count(*)::text from pg_policies where schemaname='public'")),
        "public_triggers": int(scalar(
            "select count(*)::text from pg_trigger t join pg_class c on c.oid=t.tgrelid "
            "join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal")),
        "app_ledger_schema_exists": scalar(
            "select exists(select 1 from information_schema.schemata where schema_name='app_ledger')::text") == "t",
    }
    b["schema"]["columns_sha256"] = sha256_text("\n".join(
        "|".join(r) for r in psql(
            "select table_name,column_name,data_type,is_nullable,coalesce(column_default,'-') "
            "from information_schema.columns where table_schema='public' order by 1,2")))
    b["schema"]["policies_sha256"] = sha256_text("\n".join(
        "|".join(r) for r in psql(
            "select tablename,policyname,cmd,coalesce(qual,'-'),coalesce(with_check,'-') "
            "from pg_policies where schemaname='public' order by 1,2,3")))
    b["schema"]["triggers_sha256"] = sha256_text("\n".join(
        "|".join(r) for r in psql(
            "select c.relname,t.tgname,pg_get_triggerdef(t.oid) from pg_trigger t "
            "join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace "
            "where n.nspname='public' and not t.tgisinternal order by 1,2")))

    # ------------------------------------------------------------------ data
    data = {}
    data["trade_records"] = {
        "rows": int(scalar("select count(*)::text from trade_records")),
        "experts": int(scalar("select count(distinct expert_id)::text from trade_records")),
        "open": int(scalar("select count(*)::text from trade_records where status='open'")),
        "closed": int(scalar("select count(*)::text from trade_records where status<>'open'")),
        "sha256": scalar("select coalesce(md5(string_agg(x,'|' order by x)),'empty') from ("
                         "select id::text||':'||coalesce(quantity::text,'')||':'||coalesce(quantity_unit,'')||':'"
                         "||coalesce(entry_price::text,'')||':'||coalesce(exit_price::text,'')||':'"
                         "||coalesce(status::text,'')||':'||coalesce(market,'')||':'||coalesce(instrument,'') as x "
                         "from trade_records) s"),
    }
    data["expert_signals"] = {
        "rows": int(scalar("select count(*)::text from expert_signals")),
        "published": int(scalar("select count(*)::text from expert_signals where published_at is not null")),
        "by_status": {r[0]: int(r[1]) for r in psql("select coalesce(status::text,'(null)'), count(*)::text from expert_signals group by 1 order by 1")},
        "sha256": scalar("select coalesce(md5(string_agg(x,'|' order by x)),'empty') from ("
                         "select id::text||':'||coalesce(instrument,'')||':'||coalesce(action::text,'')||':'"
                         "||coalesce(quantity::text,'')||':'||coalesce(status::text,'')||':'||coalesce(published_at::text,'') as x "
                         "from expert_signals) s"),
    }
    for t in ("experts", "user_performances", "user_summaries", "signal_trade_applications",
              "holdings_fix_proposals", "current_prices", "tw_bsr_daily", "stock_names",
              "chips_prefetch_targets", "notifications", "member_subscriptions"):
        exists = scalar("select to_regclass('public.%s') is not null" % t) == "t"
        data[t] = {"rows": int(scalar("select count(*)::text from %s" % t)) if exists else None,
                   "exists": exists}
    data["checkup_storage_holdings"] = {
        "rows": int(scalar("select count(*)::text from checkup_storage where key='pf-holdings-v2'")),
        "users": int(scalar("select count(distinct user_id)::text from checkup_storage where key='pf-holdings-v2'")),
    }
    data["stock_names_by_market"] = {r[0]: int(r[1]) for r in psql(
        "select coalesce(market,'(null)'), count(*)::text from stock_names group by 1 order by 1")}
    b["data"] = data

    # --------------------------------------------------------------- pointer
    ptr = {}
    for rel in ("public_projection_active", "public_projection_pointer", "projection_pointer"):
        ptr[rel] = scalar("select to_regclass('public.%s') is not null" % rel) == "t"
    ptr["any_pointer_present"] = any(ptr.values())
    ptr["expected_state_pre_cutover"] = "absent — projection pointer is created by S3, not S0"
    b["pointer"] = ptr

    # ----------------------------------------------------------------- kill switches
    b["kill_switches"] = {r[0]: r[1] for r in psql(
        "select key, enabled::text||'@'||coalesce(updated_at::text,'-') from system_kill_switches order by key")}

    # ------------------------------------------------------- 12 experts (S3)
    # Classification is projection-safety based. Presence of signals/trades or
    # active status is inventory evidence only; it can never make an expert
    # ready without complete replay/unit/market/derivative/FX proof.
    p = os.path.join(OUT, "..", "..", "p")
    rep_path = os.path.abspath(os.path.join(p, "replay-84.json"))
    dft_path = os.path.abspath(os.path.join(p, "drift-26.json"))
    rep = json.load(open(rep_path))
    dft = json.load(open(dft_path))
    manifest_by_expert = collections.defaultdict(list)
    for k in rep["keys"]:
        manifest_by_expert[k["expert"]].append(k)
    rows = psql("""select e.id::text, coalesce(e.name,'(unnamed)'),
               coalesce(e.status::text,'(null)'),
               (select count(*) from expert_signals s where s.expert_id=e.id)::text,
               (select count(*) from trade_records t where t.expert_id=e.id)::text,
               (select count(*) from trade_records t where t.expert_id=e.id and t.status='open')::text
        from experts e order by 1""")
    experts = []
    for eid, name, status, sig, trd, opn in rows:
        sig, trd, opn = int(sig), int(trd), int(opn)
        handle = "E-" + __import__("hashlib").md5(eid.encode()).hexdigest()[:8]
        keys = manifest_by_expert.get(handle, [])
        drift = sum(bool(k["in_drift26"]) for k in keys)
        unsafe = [k for k in keys if k["review_status"] != "auto_supported"
                  or k["public_disposition"] != "as_reported_publishable"
                  or not all(k["supported"].values())]
        reason_counts = collections.Counter(x for k in keys for x in k["reason_codes"])
        if sig == 0 and trd == 0:
            cls = "incomplete"
            reason = "no economic source rows; no replay proof to project"
        elif not keys:
            cls = "incomplete"
            reason = "economic rows exist but no key in pinned 84-key replay manifest"
        elif unsafe:
            cls = "manual_review"
            reason = ("projection proof incomplete: %d/%d keys unsafe, %d drift26; reasons=%s" %
                      (len(unsafe), len(keys), drift,
                       ",".join("%s:%d" % x for x in sorted(reason_counts.items()))))
        else:
            cls = "ready"
            reason = "all replay keys have complete ledger/unit/market/derivative/FX proof"
        experts.append({"expert_id": eid, "name": name, "status": status,
                        "signals": sig, "trade_records": trd, "open_positions": opn,
                        "manifest_expert": handle, "replay_keys": len(keys),
                        "drift26_keys": drift, "classification": cls, "reason": reason})
    cls_lines = sorted("%s|%s|%d|%d|%d|%s" % (e["expert_id"], e["status"], e["signals"],
                                              e["trade_records"], e["open_positions"],
                                              e["classification"]) for e in experts)
    b["experts_12"] = {
        "total": len(experts),
        "counts": {c: sum(1 for e in experts if e["classification"] == c)
                    for c in ("ready", "manual_review", "incomplete")},
        "rule": "ready only when every pinned replay key has complete ledger/unit/market/derivative/FX proof; "
                "manual_review when any replay key is drifted, withheld, manual, or unsupported; "
                "incomplete when no economic source rows or no replay proof exists",
        "classification_source": "production read-only experts/signals/trades joined to expert handle "
                                 "E-left(md5(expert_id),8), then db/r1/p/replay-84.json supported/review/disposition",
        "rows": experts,
        "classification_sha256": sha256_text("\n".join(cls_lines)),
    }

    # ------------------------------------- R1-P manifests (84 / 26 / 6515)
    rep_keys = sorted(k["key"] if isinstance(k, dict) else k for k in rep["keys"])
    dft_keys = sorted(k["key"] if isinstance(k, dict) else k for k in dft["keys"])
    b["manifests"] = {
        "replay_84": {
            "total_keys": rep["total_keys"],
            "keys_sha256": sha256_text("\n".join(rep_keys)),
            "file_sha256": sha256_file(os.path.abspath(os.path.join(p, "replay-84.json"))),
            "class_counts": rep["class_counts"],
        },
        "drift_26": {
            "total_keys": dft["total_keys"],
            "keys_sha256": sha256_text("\n".join(dft_keys)),
            "file_sha256": sha256_file(os.path.abspath(os.path.join(p, "drift-26.json"))),
            "class_counts": dft["class_counts"],
        },
        "basis_definition": {
            "key_basis": "KEY = (expert, instrument, market) — 84 keys",
            "pair_basis": "PAIR = (expert, instrument) — 76 pairs",
            "conversion": "8 pairs are market-ambiguous and split into 2 keys each: 76 + 8 = 84. "
                          "R0's market_ambiguous=8 is the PAIR-basis count of the same population; "
                          "on the key basis it is 16.",
            "source": rep["ambiguity"]["r0_pair_basis_note"],
        },
        "live_source_hash": {
            "replay_file_sha256": sha256_file(rep_path),
            "drift_file_sha256": sha256_file(dft_path),
            "source_query_sha256": sha256_file(os.path.abspath(os.path.join(p, "manifest_replay.sql"))),
            "84_key_basis_drift_members": sum(bool(k["in_drift26"]) for k in rep["keys"]),
        },
    }

    # 6515 invariant: stored 50 vs replay 10, withheld from every public channel
    s6515 = psql("""select coalesce(sum(t.quantity) filter(where t.status='open'),0)::text,
                            count(*) filter(where t.status='open')::text,
                            coalesce(sum(t.quantity) filter(where t.status='closed'),0)::text,
                            count(*) filter(where t.status='closed')::text,
                            coalesce(max(t.quantity_unit),'(null)')
        from trade_records t where t.instrument ilike '%6515%'""")
    sig6515 = cli_q("""select s.id::text as signal_id, s.action::text as action,
        s.quantity, s.quantity_unit, s.status::text as status, s.executed_at, s.published_at
        from public.expert_signals s where s.instrument ilike '%6515%'
        order by coalesce(s.executed_at,s.published_at,s.created_at),s.created_at""")
    tr6515 = cli_q("""select t.id::text as trade_record_id,t.signal_id::text,t.instrument,t.market,
        t.quantity,t.quantity_unit,t.status::text as status,t.entry_price,t.exit_price,t.entry_date,t.exit_date
        from public.trade_records t where t.instrument ilike '%6515%'
        or exists(select 1 from public.expert_signals s where s.id=t.signal_id and s.instrument ilike '%6515%')
        order by t.created_at""")
    manifest6515 = next(k for k in rep["keys"] if k["instrument"] == "6515 穎崴")
    b["invariant_6515"] = {
        "stored_open_quantity": s6515[0][0] if s6515 else None,
        "stored_open_rows": s6515[0][1] if s6515 else None,
        "stored_closed_quantity": s6515[0][2] if s6515 else None,
        "stored_closed_rows": s6515[0][3] if s6515 else None,
        "quantity_unit": s6515[0][4] if s6515 else None,
        "signals": sig6515,
        "trade_records_direct_or_joined": tr6515,
        "signal_count": len(sig6515),
        "trade_record_count": len(tr6515),
        "stored_declared": 50,
        "replay_declared": 10,
        "manifest_key": manifest6515["key"],
        "manifest_expert": manifest6515["expert"],
        "in_drift26": manifest6515["in_drift26"],
        "public_disposition": "withheld — candidates only, manual_review, auto-correction forbidden",
        "truth_note": "50 is quantity in each of two rows (one open, one closed), never a row count; "
                      "stored 50 and replay 10 remain non-authoritative candidates",
        "source": "production read-only direct instrument + signal_id join; db/r1/p/drift-26.json invariants.6515",
    }

    b["baseline_sha256"] = sha256_text(json.dumps(b, sort_keys=True, ensure_ascii=False))
    write_json(os.path.join(OUT, "s0_baselines.json"), b)
    print(json.dumps({"trade_records": data["trade_records"], "expert_signals": data["expert_signals"],
                      "pointer": ptr["any_pointer_present"], "baseline_sha256": b["baseline_sha256"]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
