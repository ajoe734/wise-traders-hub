#!/usr/bin/env python3
"""Shared read-only helpers for the S0 preflight gates.

Two production read paths, both read-only:
  * psql (sandbox restricted role) — public schema catalog/tables only.
  * `lovable supabase query` (gateway read-only role) — can additionally read
    supabase_migrations and cron, which the psql role cannot.
No statement issued from this module mutates production.
"""
import hashlib
import json
import os
import subprocess
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
OUT = os.path.join(ROOT, "db", "r1", "c", "S0")

TRANSIENT = ("EAUTHQUERY", "could not connect", "connection to server", "timeout", "deadline")


def sha256_text(s):
    return hashlib.sha256(s.encode()).hexdigest()


def sha256_file(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def psql(sql, retries=5, sep="\x1f"):
    last = ""
    for attempt in range(retries):
        r = subprocess.run(["psql", "-Atq", "-F", sep, "-c", sql], capture_output=True, text=True)
        if r.returncode == 0:
            return [ln.split(sep) for ln in r.stdout.strip().splitlines() if ln != ""]
        last = r.stderr
        if any(t in last for t in TRANSIENT):
            time.sleep(2 * (attempt + 1))
            continue
        break
    raise SystemExit("psql failed: %s\n%s" % (sql[:160], last))


def psql_json(sql, retries=5):
    """Run a query and return a list of scalars/rows via json_agg, so values
    containing newlines (function bodies, view definitions) survive intact."""
    wrapped = "select coalesce(json_agg(t.v)::text,'[]') from (%s) t(v)" % sql
    r = psql(wrapped, retries=retries)
    return json.loads(r[0][0]) if r else []


def cli_q(sql, retries=4):
    """Read-only SQL through the Lovable gateway (production environment)."""
    last = ""
    for attempt in range(retries):
        r = subprocess.run(["lovable", "supabase", "query", "--json", "--timeout", "120s", sql],
                           capture_output=True, text=True)
        if r.returncode == 0:
            try:
                return json.loads(r.stdout)["rows"]
            except Exception as e:  # pragma: no cover
                last = "unparsable output: %s / %s" % (e, r.stdout[:200])
        else:
            last = (r.stderr or r.stdout)[:400]
        if any(t in last for t in TRANSIENT):
            time.sleep(2 * (attempt + 1))
            continue
        break
    raise SystemExit("lovable supabase query failed: %s\n%s" % (sql[:160], last))


def analytics(sql, retries=3):
    last = ""
    for attempt in range(retries):
        r = subprocess.run(["lovable", "supabase", "analytics", "--json", "--environment", "production",
                            "--timeout", "120s", sql], capture_output=True, text=True)
        if r.returncode == 0:
            try:
                return json.loads(r.stdout).get("rows", [])
            except Exception as e:  # pragma: no cover
                last = "unparsable output: %s" % e
        else:
            last = (r.stderr or r.stdout)[:400]
        time.sleep(2 * (attempt + 1))
    raise SystemExit("lovable supabase analytics failed: %s\n%s" % (sql[:160], last))


def write_json(path, data):
    body = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    open(path, "w").write(body)
    return sha256_text(body)
