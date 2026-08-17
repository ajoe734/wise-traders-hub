#!/usr/bin/env python3
"""R1-P Preview evidence integrity verifier (offline, read-only).

Checks the artefacts produced by e2e/r1p-preview-acceptance.spec.ts:

  * 7 controlled cases x 2 viewports x 2 themes = 28, plus 1 unmocked smoke and
    1 ?debug=1 negative case = 30
  * every case has png + dom.html + json, each size > 0, each hashed
  * consoleErrors = 0 and pageErrors = 0 for every case
    (injected transport / environment errors are counted separately and are
     never allowed to be folded into the app console budget)
  * incomplete-family DOM shows BOTH copy lines and no numeric economic
    payload inside an app-owned economic zone ([data-economic-zone]); ready
    DOM shows the real numbers (a legitimate 0 is allowed only for ready)
  * source + built bundle contain 0 debug routes, 0 debug query flags and
    0 runtime backdoors

Writes preview-manifest.json / preview-manifest.md next to the evidence.
Exit code 0 only when every check passes.
"""
import hashlib
import json
import os
import re
import subprocess
from html.parser import HTMLParser
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
EV = os.path.join(ROOT, "db/r1/p/evidence/preview")
OUT_JSON = os.path.join(ROOT, "db/r1/p/evidence/preview-manifest.json")
OUT_MD = os.path.join(ROOT, "db/r1/p/evidence/preview-manifest.md")

CASES = [
    "ready",
    "manual_review_6515",
    "incomplete_fx",
    "incomplete_warrant",
    "incomplete_option_combo",
    "no_projection",
    "api_error",
]
VIEWPORTS = ["desktop", "mobile"]
THEMES = ["light", "dark"]
INCOMPLETE_FAMILY = {
    "manual_review_6515",
    "incomplete_fx",
    "incomplete_warrant",
    "incomplete_option_combo",
    "no_projection",
    "api_error",
    # ?debug=1 against a no_projection scope: it belongs to the withheld family,
    # so it is held to exactly the same fail-closed bar as the scope without
    # the flag. A leak here would mean the debug flag is a state backdoor.
    "debug-flag-negative",
}
REVIEW_BADGE = "資料檢核中"
REVIEW_NOTE = "該區間不納入績效"

failures: list[str] = []
rows: list[dict] = []


class _ZoneText(HTMLParser):
    """Collects the text of every element carrying data-economic-zone."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.stack: list[bool] = []
        self.chunks: list[str] = []
        self.zones = 0

    def handle_starttag(self, tag, attrs):
        opened = any(k == "data-economic-zone" for k, _ in attrs)
        if opened:
            self.zones += 1
            self.depth += 1
        self.stack.append(opened)

    def handle_endtag(self, tag):
        while self.stack:
            opened = self.stack.pop()
            if opened:
                self.depth -= 1
            break

    def handle_data(self, data):
        if self.depth > 0:
            self.chunks.append(data)


def economic_zone_text(dom: str) -> tuple[str, int]:
    p = _ZoneText()
    try:
        p.feed(dom)
    except Exception:  # malformed markup must never mask a leak
        return dom, -1
    return " ".join(p.chunks), p.zones


# Numeric economic payloads that may never appear in a not-ready zone.
# Every token is boundary-anchored so unrelated digits (ids, dates) do not
# create false positives, and bare 10/50/0 only count as a leak when they are
# rendered as money / percent / quantity.
FORBIDDEN_TOKENS = [
    (r"\bNaN\b", "NaN"),
    (r"\b1,234,567\b", "1,234,567"),
    (r"\b234,567\b", "234,567"),
    (r"[-+]?\b23\.46\s*%", "+23.46%"),
    (r"[-+]?\b61\.5\s*%", "61.5%"),
    (r"\b1,000,000\b", "1,000,000"),
    (r"[$\uFF04]\s?[-+]?[0-9]", "currency figure"),
    (r"[-+]?\b[0-9]+(\.[0-9]+)?\s*%", "percentage figure"),
    (r"\b(?:10|50|0)\b\s*(?:\u5f35|\u80a1|\u5143)", "6515 quantity candidate"),
]


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def check_case(case_id: str, expect_dom: bool = True) -> None:
    rec: dict = {"case_id": case_id, "files": {}}
    for ext in (("png", "dom.html", "json") if expect_dom else ("png", "json")):
        p = os.path.join(EV, f"{case_id}.{ext}")
        if not os.path.exists(p):
            failures.append(f"{case_id}: missing {ext}")
            continue
        size = os.path.getsize(p)
        if size <= 0:
            failures.append(f"{case_id}: empty {ext}")
        rec["files"][ext] = {"size": size, "sha256": sha256(p)}

    jp = os.path.join(EV, f"{case_id}.json")
    if not os.path.exists(jp):
        rows.append(rec)
        return
    meta = json.load(open(jp, encoding="utf-8"))
    console = meta.get("consoleErrors", [])
    perrs = meta.get("pageErrors", [])
    rec.update(
        {
            "viewport": meta.get("viewport"),
            "theme": meta.get("theme"),
            "consoleErrors": len(console),
            "pageErrors": len(perrs),
            "injectedTransportErrors": len(meta.get("injectedTransportErrors", [])),
            "environmentErrors": len(meta.get("environmentErrors", [])),
            "mocked": meta.get("mocked", True),
        }
    )
    if console:
        failures.append(f"{case_id}: consoleErrors={console}")
    if perrs:
        failures.append(f"{case_id}: pageErrors={perrs}")

    dp = os.path.join(EV, f"{case_id}.dom.html")
    if os.path.exists(dp):
        dom = open(dp, encoding="utf-8").read()
        body = re.sub(r"<[^>]+>", " ", dom)
        base = case_id.split("__")[0]
        zone_text, zone_count = economic_zone_text(dom)
        rec["economicZones"] = zone_count
        if base in INCOMPLETE_FAMILY:
            ok_copy = REVIEW_BADGE in body and REVIEW_NOTE in body
            rec["copyLines"] = ok_copy
            if not ok_copy:
                failures.append(f"{case_id}: incomplete case is missing the two copy lines")
            if zone_count <= 0:
                failures.append(f"{case_id}: no [data-economic-zone] found — cannot prove gating")
            bad = [label for pat, label in FORBIDDEN_TOKENS if re.search(pat, zone_text)]
            # the fixture payload must not leak anywhere on the page either
            for pat, label in FORBIDDEN_TOKENS[:6]:
                if re.search(pat, body) and label not in bad:
                    bad.append(f"{label} (page)")
            rec["forbiddenNumbers"] = bad
            if bad:
                failures.append(f"{case_id}: forbidden economics rendered {bad}")
        else:
            rec["copyLines"] = None
            rec["forbiddenNumbers"] = []
            if REVIEW_BADGE in body:
                failures.append(f"{case_id}: ready case must not show the review badge")
            if base != "smoke-home" and "1,234,567" not in zone_text:
                failures.append(f"{case_id}: ready case must render the real projection payload")
    rows.append(rec)


for c in CASES:
    for v in VIEWPORTS:
        for th in THEMES:
            check_case(f"{c}__{v}__{th}")
check_case("smoke-home")
# the only ?debug= flag in the app must not unlock a withheld scope
check_case("debug-flag-negative")

if len(rows) != 30:
    failures.append(f"expected 30 case records, got {len(rows)}")

# ---------------------------------------------------------------- backdoor scan
# Project-owned surfaces only. Vendor/runtime globals (React DevTools, Vite
# HMR, TanStack Query, Radix, Recharts) are excluded by an explicit key
# allowlist — the generic `window.__` prefix itself is NEVER whitelisted, so a
# project-owned `window.__anything` still fails.
VENDOR_GLOBAL_KEYS = {
    "__REACT_DEVTOOLS_GLOBAL_HOOK__", "__REACT_ERROR_OVERLAY_GLOBAL_HOOK__",
    "__vite__", "__vite_plugin_react_preamble_installed__", "__vitePreload",
    "__VITE_IS_MODERN__", "__viteBrowserExternal", "__REACT_QUERY_DEVTOOLS__",
    "__TANSTACK_QUERY_DEVTOOLS__", "__REDUX_DEVTOOLS_EXTENSION__",
    "__RADIX__", "__NEXT_DATA__", "__SUPABASE__", "__name", "__defProp",
}
GLOBAL_RE = re.compile(r"window\.(__[A-Za-z0-9_$]+)")

# Project-owned globals are classified one by one in global-key-inventory.json
# (key -> gate -> can_force_economic_state). An unlisted project-owned global,
# or one that can influence the public economic contract, is a hard failure.
INVENTORY_PATH = os.path.join(ROOT, "db/r1/p/evidence/global-key-inventory.json")
_inv = json.load(open(INVENTORY_PATH, encoding="utf-8"))
CLASSIFIED_GLOBALS = {g["key"]: g for g in _inv["globals"]}
ECONOMIC_CAPABLE = [k for k, g in CLASSIFIED_GLOBALS.items() if g.get("can_force_economic_state")]
CLASSIFIED_FLAGS = {f["flag"] for f in _inv["query_flags"]}
BACKDOOR_PATTERNS = [
    (r"[?&](debug|mock|preview_state|force_state|r1p|__state)=", "debug query flag"),
    (r"path=[\"'`]/(debug|__debug|dev-tools|test-harness|preview-mock)", "debug route"),
    (r"\b(PREVIEW_MOCK|TEST_HOOK|FORCE_PROJECTION_STATE)\b", "test hook identifier"),
]


def scan_backdoors(text: str, rel: str) -> list[dict]:
    hits: list[dict] = []
    for pat, label in BACKDOOR_PATTERNS:
        for m in re.finditer(pat, text):
            if label == "debug query flag" and m.group(0) in CLASSIFIED_FLAGS:
                continue
            hits.append({"file": rel, "label": label, "match": m.group(0)})
    for m in GLOBAL_RE.finditer(text):
        key = m.group(1)
        if key in VENDOR_GLOBAL_KEYS:
            continue
        entry = CLASSIFIED_GLOBALS.get(key)
        if entry is None:
            hits.append(
                {"file": rel, "label": "unclassified project-owned runtime global", "match": m.group(0)}
            )
        elif entry.get("can_force_economic_state"):
            hits.append(
                {"file": rel, "label": "economic-contract backdoor", "match": m.group(0)}
            )
    return hits


scan_targets: list[str] = []
for base in ("src", "index.html"):
    p = os.path.join(ROOT, base)
    if os.path.isfile(p):
        scan_targets.append(p)
    else:
        for dirpath, _dirs, files in os.walk(p):
            for f in files:
                if f.endswith((".ts", ".tsx", ".js", ".jsx", ".html")):
                    scan_targets.append(os.path.join(dirpath, f))
backdoor_hits: list[dict] = []
for path in scan_targets:
    txt = open(path, encoding="utf-8", errors="ignore").read()
    backdoor_hits += scan_backdoors(txt, os.path.relpath(path, ROOT))
if backdoor_hits:
    failures.append(f"backdoor scan found {len(backdoor_hits)} hits")
if ECONOMIC_CAPABLE:
    failures.append(f"inventory declares economic-capable globals: {ECONOMIC_CAPABLE}")

dist = os.path.join(ROOT, "dist")
bundle_hits: list[dict] = []
if os.path.isdir(dist):
    for dirpath, _dirs, files in os.walk(dist):
        for f in files:
            if not f.endswith((".js", ".html")):
                continue
            path = os.path.join(dirpath, f)
            txt = open(path, encoding="utf-8", errors="ignore").read()
            bundle_hits += scan_backdoors(txt, os.path.relpath(path, ROOT))
    if bundle_hits:
        failures.append(f"production bundle scan found {len(bundle_hits)} hits")
    bundle_scanned = True
else:
    bundle_scanned = False

# spec file must be test-only (never imported by src)
spec_imported = subprocess.run(
    ["grep", "-rl", "r1p-preview-acceptance", os.path.join(ROOT, "src")],
    capture_output=True,
    text=True,
).stdout.strip()
if spec_imported:
    failures.append(f"preview spec referenced from src: {spec_imported}")

manifest = {
    "generated_by": "db/r1/p/evidence/preview_verify.py",
    "controlled_cases": 28,
    "negative_cases": 1,
    "unmocked_smoke": 1,
    "total_cases": len(rows),
    "coverage_matrix": {
        "cases": CASES,
        "viewports": VIEWPORTS,
        "themes": THEMES,
        "combinations": len(CASES) * len(VIEWPORTS) * len(THEMES),
    },
    "console_errors_total": sum(r.get("consoleErrors", 0) for r in rows),
    "page_errors_total": sum(r.get("pageErrors", 0) for r in rows),
    "backdoor_scan": {
        "source_files_scanned": len(scan_targets),
        "source_hits": backdoor_hits,
        "bundle_scanned": bundle_scanned,
        "bundle_hits": bundle_hits,
        "spec_referenced_from_src": bool(spec_imported),
        "classified_project_globals": sorted(CLASSIFIED_GLOBALS),
        "classified_query_flags": sorted(CLASSIFIED_FLAGS),
        "vendor_globals_excluded": sorted(VENDOR_GLOBAL_KEYS),
    },
    "cases": rows,
    "failures": failures,
    "status": "PASS" if not failures else "FAIL",
}
json.dump(manifest, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

with open(OUT_MD, "w", encoding="utf-8") as fh:
    fh.write("# R1-P Preview evidence manifest\n\n")
    fh.write(f"- status: **{manifest['status']}**\n")
    fh.write(f"- cases: {manifest['total_cases']} (28 controlled + 1 unmocked smoke + 1 ?debug=1 negative)\n")
    fh.write(f"- console errors: {manifest['console_errors_total']}, page errors: {manifest['page_errors_total']}\n")
    fh.write(
        f"- backdoor scan: {len(backdoor_hits)} source hits over {len(scan_targets)} files, "
        f"bundle scanned={bundle_scanned}, bundle hits={len(bundle_hits)}\n\n"
    )
    fh.write("| case | viewport | theme | png | dom | json | console | pageErr | copy lines |\n")
    fh.write("|---|---|---|---|---|---|---|---|---|\n")
    for r in rows:
        f = r.get("files", {})
        fh.write(
            "| {c} | {v} | {t} | {p} | {d} | {j} | {ce} | {pe} | {cl} |\n".format(
                c=r["case_id"],
                v=r.get("viewport", "-"),
                t=r.get("theme", "-"),
                p=f.get("png", {}).get("size", 0),
                d=f.get("dom.html", {}).get("size", 0),
                j=f.get("json", {}).get("size", 0),
                ce=r.get("consoleErrors", "-"),
                pe=r.get("pageErrors", "-"),
                cl=r.get("copyLines", "-"),
            )
        )
    if failures:
        fh.write("\n## Failures\n\n" + "\n".join(f"- {x}" for x in failures) + "\n")

print(json.dumps({"status": manifest["status"], "cases": len(rows), "failures": failures}, ensure_ascii=False, indent=2))
sys.exit(0 if not failures else 1)
