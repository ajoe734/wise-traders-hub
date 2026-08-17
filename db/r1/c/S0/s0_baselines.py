#!/usr/bin/env python3
"""S0-3 / item 3 — schema, data, pointer and hash baselines (production read-only).

Everything captured here is the exact comparison anchor for post-cutover
read-back. Row hashes are stable, order-independent digests over the business
columns that S1/S2 could disturb.
"""
import json
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
    rows = psql("""select e.id::text, coalesce(e.name,'(unnamed)'),
               coalesce(e.status::text,'(null)'),
               (select count(*) from expert_signals s where s.expert_id=e.id)::text,
               (select count(*) from trade_records t where t.expert_id=e.id)::text,
               (select count(*) from trade_records t where t.expert_id=e.id and t.status='open')::text
        from experts e order by 1""")
    experts = []
    for eid, name, status, sig, trd, opn in rows:
        sig, trd, opn = int(sig), int(trd), int(opn)
        # ready      : has signals AND every open position is backed by trades
        # manual     : has data but drifted / suspended -> human adjudication
        # incomplete : no signal and no trade -> nothing to project
        if sig == 0 and trd == 0:
            cls = "incomplete"
        elif status in ("suspended", "inactive") or (sig > 0 and trd == 0) or (trd > 0 and sig == 0):
            cls = "manual"
        else:
            cls = "ready"
        experts.append({"expert_id": eid, "name": name, "status": status,
                        "signals": sig, "trade_records": trd, "open_positions": opn,
                        "classification": cls})
    cls_lines = sorted("%s|%s|%d|%d|%d|%s" % (e["expert_id"], e["status"], e["signals"],
                                              e["trade_records"], e["open_positions"],
                                              e["classification"]) for e in experts)
    b["experts_12"] = {
        "total": len(experts),
        "counts": {c: sum(1 for e in experts if e["classification"] == c)
                   for c in ("ready", "manual", "incomplete")},
        "rule": "ready = signals>0 and trade_records>0 and status active; "
                "manual = suspended/inactive or signal-without-trade or trade-without-signal; "
                "incomplete = no signal and no trade record",
        "rows": experts,
        "classification_sha256": sha256_text("\n".join(cls_lines)),
    }

    # ------------------------------------- R1-P manifests (84 / 26 / 6515)
    p = os.path.join(OUT, "..", "..", "p")
    rep = json.load(open(os.path.abspath(os.path.join(p, "replay-84.json"))))
    dft = json.load(open(os.path.abspath(os.path.join(p, "drift-26.json"))))
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
    }

    # 6515 invariant: stored 50 vs replay 10, withheld from every public channel
    s6515 = psql("""select coalesce(sum(t.quantity),0)::text,
                           count(*)::text,
                           coalesce(max(t.quantity_unit),'(null)')
        from trade_records t where t.instrument='6515' and t.status='open'""")
    b["invariant_6515"] = {
        "stored_open_quantity": s6515[0][0] if s6515 else None,
        "stored_open_rows": s6515[0][1] if s6515 else None,
        "quantity_unit": s6515[0][2] if s6515 else None,
        "stored_declared": 50,
        "replay_declared": 10,
        "public_disposition": "withheld — candidates only, manual_review, auto-correction forbidden",
        "source": "db/r1/p/drift-26.json invariants.6515",
    }

    b["baseline_sha256"] = sha256_text(json.dumps(b, sort_keys=True, ensure_ascii=False))
    write_json(os.path.join(OUT, "s0_baselines.json"), b)
    print(json.dumps({"trade_records": data["trade_records"], "expert_signals": data["expert_signals"],
                      "pointer": ptr["any_pointer_present"], "baseline_sha256": b["baseline_sha256"]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
