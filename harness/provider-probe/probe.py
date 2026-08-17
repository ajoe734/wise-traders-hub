#!/usr/bin/env python3
"""H-1 provider capability probe (read-only, external HTTP only).

Never touches production DB. Never writes anywhere except the artifact dir.

Outputs:
  harness/provider-probe/artifact/provider_probe.json
  harness/provider-probe/artifact/PROVIDER_PROBE.md
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), "artifact")
UA = "legendflow-provider-probe/1.0 (+read-only capability probe)"
TIMEOUT = 40

# (id, url, kind, market, expected_symbol_field, expected_name_field)
ENDPOINTS = [
    ("twse_stock_day_all", "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
     "price_volume", "listed", "Code", "Name"),
    ("twse_bwibbu_all", "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL",
     "fundamentals", "listed", "Code", "Name"),
    ("twse_t86", "https://www.twse.com.tw/rwd/zh/fund/T86?date={date}&selectType=ALL&response=json",
     "institutional", "listed", None, None),
    ("tpex_daily_close", "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
     "price_volume", "otc", "SecuritiesCompanyCode", "CompanyName"),
    ("tpex_3insti", "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading",
     "institutional", "otc", "SecuritiesCompanyCode", "CompanyName"),
]

# 10 representative instruments the users actually hold.
PROBE_SYMBOLS = [
    ("2330", "listed_common", "台積電"),
    ("2317", "listed_common", "鴻海"),
    ("0050", "listed_etf", "元大台灣50"),
    ("00631L", "listed_etf_leveraged", "元大台灣50正2"),
    ("6488", "otc_common", "環球晶"),
    ("5347", "otc_common", "世界"),
    ("6510", "otc_common", "精測"),
    ("053040", "warrant", "權證樣本"),
    ("6515", "listed_common", "穎崴"),
    ("AAPL", "us_equity", "Apple"),
]


def fetch(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read()
            return {
                "ok": True, "http": r.status, "bytes": len(body),
                "latency_ms": int((time.time() - t0) * 1000),
                "sha256": hashlib.sha256(body).hexdigest(),
                "body": body,
            }
    except Exception as e:  # noqa: BLE001 - probe must never raise
        return {"ok": False, "http": None, "bytes": 0,
                "latency_ms": int((time.time() - t0) * 1000),
                "error": f"{type(e).__name__}: {e}", "body": b""}


def parse_rows(body: bytes):
    try:
        doc = json.loads(body.decode("utf-8", "replace"))
    except Exception:  # noqa: BLE001
        return None, None
    if isinstance(doc, list):
        return doc, None
    if isinstance(doc, dict):
        return doc.get("data"), doc.get("fields")
    return None, None


def main() -> int:
    os.makedirs(ART, exist_ok=True)
    run_id = "hminus1-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    started = datetime.now(timezone.utc).isoformat()
    # T86 needs an explicit date: use the most recent weekday.
    from datetime import date, timedelta
    d = date.today()
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    d -= timedelta(days=1)  # T-1: intraday runs have no settled T86 yet
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    t86_date = d.strftime("%Y%m%d")

    endpoints, coverage = [], {}
    for eid, url_tpl, kind, market, code_f, name_f in ENDPOINTS:
        url = url_tpl.format(date=t86_date)
        res = fetch(url)
        rows, fields = parse_rows(res.get("body", b""))
        codes = set()
        if rows and code_f:
            for r in rows:
                if isinstance(r, dict) and r.get(code_f):
                    codes.add(str(r[code_f]).strip())
        elif rows and eid == "twse_t86":
            for r in rows:
                if isinstance(r, list) and r:
                    codes.add(str(r[0]).strip())
        sample = rows[0] if rows else None
        endpoints.append({
            "id": eid, "url": url, "kind": kind, "market": market,
            "http": res.get("http"), "ok": bool(res.get("ok")) and res.get("http") == 200,
            "bytes": res.get("bytes"), "latency_ms": res.get("latency_ms"),
            "sha256": res.get("sha256"), "error": res.get("error"),
            "row_count": len(rows) if rows else 0,
            "distinct_symbols": len(codes),
            "field_names": (list(sample.keys()) if isinstance(sample, dict) else fields),
            "auth_required": False,
        })
        coverage[eid] = codes

    symbols = []
    for sym, cls, name in PROBE_SYMBOLS:
        hits = {eid: (sym in codes) for eid, codes in coverage.items()}
        tw_shape = bool(re.fullmatch(r"[0-9]{4,6}[A-Z]?", sym))
        eligible = cls in ("listed_common", "listed_etf", "listed_etf_leveraged", "otc_common")
        if not tw_shape:
            eligible = False
        symbols.append({
            "symbol": sym, "class": cls, "name": name,
            "master_hit": hits.get("twse_stock_day_all") or hits.get("tpex_daily_close"),
            "price_volume": hits.get("twse_stock_day_all") or hits.get("tpex_daily_close"),
            "institutional": hits.get("twse_t86") or hits.get("tpex_3insti"),
            "fundamentals": hits.get("twse_bwibbu_all"),
            "broker_bsr": False,  # BLOCKER-E1: no verified license-free source
            "eligibility": eligible,
            "verdict": "eligible" if eligible and (hits.get("twse_stock_day_all") or hits.get("tpex_daily_close"))
                       else "unsupported",
        })

    field_map = {
        "tw_market_symbols": {
            "symbol": ["twse_stock_day_all.Code", "tpex_daily_close.SecuritiesCompanyCode"],
            "name": ["twse_stock_day_all.Name", "tpex_daily_close.CompanyName"],
            "market": ["listed<-twse_*", "otc<-tpex_*"],
        },
        "price_volume": {
            "trade_date": ["Date (ROC yyymmdd) -> ISO"],
            "close": ["ClosingPrice", "Close"],
            "volume_shares": ["TradeVolume", "TradingShares"],
        },
        "institutional": {
            "foreign_net": ["T86 外陸資買賣超股數", "tpex_3insti Foreign Investors ... Total Buy/Sell"],
        },
        "broker_bsr": {"status": "BLOCKER-E1: no verified license-free source"},
    }

    out = {
        "run_id": run_id,
        "started_utc": started,
        "ended_utc": datetime.now(timezone.utc).isoformat(),
        "production_touch": "none (external HTTP GET only)",
        "t86_date": t86_date,
        "endpoints": endpoints,
        "symbols": symbols,
        "field_map": field_map,
        "blockers": [{
            "id": "BLOCKER-E1",
            "what": "broker-level BSR (券商分點進出)",
            "evidence": "FinMind returns HTTP 400 'Your level is register' (permanent_auth); "
                        "TWSE broker page is not an open API",
            "impact": "fast lane covers price_volume + institutional only",
        }],
    }
    with open(os.path.join(ART, "provider_probe.json"), "w") as f:
        json.dump({k: v for k, v in out.items()}, f, ensure_ascii=False, indent=2)

    lines = [f"# H-1 Provider capability probe — {run_id}", "",
             f"started={started} ended={out['ended_utc']} production_touch=none", "",
             "## Endpoints", "",
             "| id | kind | market | http | bytes | rows | symbols | latency_ms | auth |",
             "|---|---|---|---|---|---|---|---|---|"]
    for e in endpoints:
        lines.append("| {id} | {kind} | {market} | {http} | {bytes} | {row_count} | {distinct_symbols} | "
                     "{latency_ms} | none |".format(**e))
    lines += ["", "## 10 representative instruments", "",
              "| symbol | class | master | price/volume | institutional | fundamentals | broker BSR | verdict |",
              "|---|---|---|---|---|---|---|---|"]
    for s in symbols:
        b = lambda v: "yes" if v else "no"  # noqa: E731
        lines.append(f"| {s['symbol']} | {s['class']} | {b(s['master_hit'])} | {b(s['price_volume'])} | "
                     f"{b(s['institutional'])} | {b(s['fundamentals'])} | {b(s['broker_bsr'])} | {s['verdict']} |")
    lines += ["", "## Blockers", "",
              "- **BLOCKER-E1** broker-level BSR: no verified license-free source "
              "(FinMind HTTP 400 permanent_auth). Unsupported instruments must return `unsupported`, never queue.",
              ""]
    with open(os.path.join(ART, "PROVIDER_PROBE.md"), "w") as f:
        f.write("\n".join(lines))

    bad = [e["id"] for e in endpoints if not e["ok"]]
    print(f"### H-1 PROBE run_id={run_id} endpoints_ok={len(endpoints)-len(bad)}/{len(endpoints)} "
          f"failed={bad} symbols={len(symbols)}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
