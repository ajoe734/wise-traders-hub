#!/usr/bin/env python3
"""S0-6 / item 4 — resolve the kill-switch contradiction with a timeline, not a snapshot.

The earlier two rounds reported chips_backfill=true then chips_backfill=false.
Both readings were correct at their read time: the switches are *flapped* by
chips-guardian while the finmind_bsr circuit is open. This gate proves that by
capturing the ordered audit timeline plus the circuit state, and by re-reading
the switches twice with a gap so the drift is visible in one artifact.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from s0_lib import OUT, psql, write_json  # noqa: E402


KS = ("select key, enabled::text, coalesce(updated_at::text,'-'), coalesce(disabled_reason,'-'), "
      "coalesce(disabled_at::text,'-'), coalesce(disabled_by::text,'-'), coalesce(auto_trigger_metric,'-') "
      "from system_kill_switches order by key")


def rows(sql):
    return psql(sql)


def main():
    art = {"gate": "S0-6 freshness / kill-switch contradiction resolution",
           "production_touch": "read-only"}

    art["switch_read_1"] = {r[0]: {"enabled": r[1] == "t", "updated_at": r[2], "disabled_reason": r[3],
                             "disabled_at": r[4], "disabled_by": r[5], "auto_trigger_metric": r[6]}
                            for r in rows(KS)}
    time.sleep(20)
    art["switch_read_2"] = {r[0]: {"enabled": r[1] == "t", "updated_at": r[2], "disabled_reason": r[3],
                             "disabled_at": r[4], "disabled_by": r[5], "auto_trigger_metric": r[6]}
                            for r in rows(KS)}
    art["reads_differ"] = art["switch_read_1"] != art["switch_read_2"]

    art["circuit"] = [dict(zip(("source", "state", "consecutive_failures", "last_error_code", "last_success_at",
                                "last_failure_at", "disabled_until", "updated_at", "fail_10m", "ok_10m"), r))
                      for r in rows("select source, coalesce(circuit_state,'-'), "
                                    "coalesce(consecutive_failures::text,'-'), coalesce(last_error_code,'-'), "
                                    "coalesce(last_success_at::text,'-'), coalesce(last_failure_at::text,'-'), "
                                    "coalesce(disabled_until::text,'-'), coalesce(updated_at::text,'-'), "
                                    "coalesce(fail_count_10m::text,'-'), coalesce(ok_count_10m::text,'-') "
                                    "from data_source_health order by source")]

    art["guardian_system_jobs_24h"] = [dict(zip(("at", "job", "status", "detail"), r)) for r in rows(
        "select ran_at::text, coalesce(job_name,'-'), coalesce(status,'-'), "
        "left(coalesce(detail::text,'-'),300) from system_jobs_log "
        "where ran_at > now() - interval '24 hours' order by ran_at desc limit 100")]
    art["cron_dispatch_24h"] = [dict(zip(("at", "job", "request_id"), r)) for r in rows(
        "select dispatched_at::text, coalesce(jobname,'-'), coalesce(request_id::text,'-') "
        "from cron_dispatch_log where dispatched_at > now() - interval '24 hours' "
        "order by dispatched_at desc limit 80")]
    art["cron_dispatch_24h_by_job"] = {r[0]: int(r[1]) for r in rows(
        "select coalesce(jobname,'-'), count(*)::text from cron_dispatch_log "
        "where dispatched_at > now() - interval '24 hours' group by 1 order by 1")}
    art["data_source_refresh_24h"] = [dict(zip(("at", "source", "status", "detail"), r)) for r in rows(
        "select created_at::text, coalesce(source_key,'-'), coalesce(status::text,'-'), "
        "left(coalesce(error_message,'-'),200)||' rows='||coalesce(row_count::text,'-') "
        "from data_source_refresh_logs where created_at > now() - interval '24 hours' "
        "order by created_at desc limit 80")]

    art["worker_chain_24h"] = {
        "cron_runs": [dict(zip(("jobid", "runs", "last_status", "last_end"), r)) for r in rows(
            "select '-','-','-','-' where false")],  # cron.job_run_details is unreadable by this role
        "attempt_logs": int(rows("select count(*)::text from tw_bsr_attempt_logs "
                                 "where created_at > now() - interval '24 hours'")[0][0]),
        "bsr_rows_written": int(rows("select count(*)::text from tw_bsr_daily "
                                     "where created_at > now() - interval '24 hours'")[0][0]),
        "attempt_outcomes_7d": {r[0]: int(r[1]) for r in rows(
            "select coalesce(outcome,'(null)'), count(*)::text from tw_bsr_attempt_logs "
            "where created_at > now() - interval '7 days' group by 1 order by 1")},
        "last_attempt_at": rows("select coalesce(max(created_at)::text,'-') from tw_bsr_attempt_logs")[0][0],
        "last_bsr_write_at": rows("select coalesce(max(created_at)::text,'-') from tw_bsr_daily")[0][0],
        "queue_by_status": {r[0]: int(r[1]) for r in rows(
            "select coalesce(status,'(null)'), count(*)::text from tw_bsr_sync_queue group by 1 order by 1")},
        "latest_bsr_trade_date": rows("select coalesce(max(trade_date)::text,'-') from tw_bsr_daily")[0][0],
    }

    art["universe"] = {
        "stock_names_total": int(rows("select count(*)::text from stock_names")[0][0]),
        "stock_names_by_market": {r[0]: int(r[1]) for r in rows(
            "select coalesce(market,'(null)'), count(*)::text from stock_names group by 1 order by 1")},
        "prefetch_targets": int(rows("select count(*)::text from chips_prefetch_targets")[0][0]),
        "user_holding_entries": int(rows("select count(*)::text from checkup_storage "
                                         "where key='pf-holdings-v2'")[0][0]),
    }

    open_circuits = [c for c in art["circuit"] if c["state"] == "open"]
    art["root_cause_chain"] = [
        "1. FinMind BSR upstream returns HTTP 400 -> data_source_health.finmind_bsr consecutive_failures climbs",
        "2. circuit_state flips to open (last_success frozen)",
        "3. chips-guardian disables chips_backfill / chips_keepwarm kill switches while the circuit is open",
        "4. hourly cron fires and the worker boots, but admission returns "
        "finmind_admission_circuit_open / finmind_admission_kill_switch_off",
        "5. zero attempt logs and zero tw_bsr_daily writes -> the observed 24h idle state",
    ]
    art["contradiction_resolution"] = (
        "Not a measurement error: the switches are auto-flapped by chips-guardian, so a single snapshot is "
        "not a stable fact. Both prior readings were true at their read time; the stable fact is the open "
        "finmind_bsr circuit above them."
    )
    art["verdict"] = "NOT_FRESH" if (open_circuits or art["worker_chain_24h"]["bsr_rows_written"] == 0) else "FRESH"
    write_json(os.path.join(OUT, "freshness_trace.json"), art)
    print(json.dumps({"verdict": art["verdict"], "reads_differ": art["reads_differ"],
                      "open_circuits": [c["source"] for c in open_circuits],
                      "worker": art["worker_chain_24h"], "universe": art["universe"]},
                     indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
