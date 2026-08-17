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
from s0_lib import OUT, cli_q, psql, sha256_text, write_json  # noqa: E402


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

    b["baseline_sha256"] = sha256_text(json.dumps(b, sort_keys=True, ensure_ascii=False))
    write_json(os.path.join(OUT, "s0_baselines.json"), b)
    print(json.dumps({"trade_records": data["trade_records"], "expert_signals": data["expert_signals"],
                      "pointer": ptr["any_pointer_present"], "baseline_sha256": b["baseline_sha256"]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
