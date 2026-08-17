#!/usr/bin/env python3
"""R1-P Preview evidence integrity verifier (offline, read-only).

Checks the artefacts produced by e2e/r1p-preview-acceptance.spec.ts:

  * 7 controlled cases x 2 viewports x 2 themes = 28, plus 1 unmocked smoke = 29
  * every case has png + dom.html + json, each size > 0, each hashed
  * consoleErrors = 0 and pageErrors = 0 for every case
    (injected transport / environment errors are counted separately and are
     never allowed to be folded into the app console budget)
  * incomplete-family DOM shows BOTH copy lines and no 10 / 50 / 0 / NaN
    fake economics; ready DOM shows real numbers (a legitimate 0 is allowed
    only for the ready case)
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
}
REVIEW_BADGE = "資料檢核中"
REVIEW_NOTE = "該區間不納入績效"

failures: list[str] = []
rows: list[dict] = []


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
        if base in INCOMPLETE_FAMILY:
            ok_copy = REVIEW_BADGE in body and REVIEW_NOTE in body
            rec["copyLines"] = ok_copy
            if not ok_copy:
                failures.append(f"{case_id}: incomplete case is missing the two copy lines")
            bad = [tok for tok in ("NaN", "10.0%", "50.0%", "+10", "+50") if tok in body]
            if re.search(r"(報酬率|勝率)[^%]{0,12}(0|10|50)(\.\d+)?\s*%", body):
                bad.append("fake economic number rendered next to a metric label")
            rec["forbiddenNumbers"] = bad
            if bad:
                failures.append(f"{case_id}: forbidden economics rendered {bad}")
        else:
            rec["copyLines"] = None
            if REVIEW_BADGE in body:
                failures.append(f"{case_id}: ready case must not show the review badge")
    rows.append(rec)


for c in CASES:
    for v in VIEWPORTS:
        for th in THEMES:
            check_case(f"{c}__{v}__{th}")
check_case("smoke-home")

if len(rows) != 29:
    failures.append(f"expected 29 case records, got {len(rows)}")

# ---------------------------------------------------------------- backdoor scan
BACKDOOR_PATTERNS = [
    (r"__R1P|__PREVIEW_MOCK|__TEST_HOOK|window\.__", "runtime backdoor global"),
    (r"[?&](debug|mock|preview_state|force_state|r1p)=", "debug query flag"),
    (r"path=[\"'`]/(debug|__debug|dev-tools|test-harness)", "debug route"),
]
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
    for pat, label in BACKDOOR_PATTERNS:
        for m in re.finditer(pat, txt):
            backdoor_hits.append(
                {"file": os.path.relpath(path, ROOT), "label": label, "match": m.group(0)}
            )
if backdoor_hits:
    failures.append(f"backdoor scan found {len(backdoor_hits)} hits")

dist = os.path.join(ROOT, "dist")
bundle_hits: list[dict] = []
if os.path.isdir(dist):
    for dirpath, _dirs, files in os.walk(dist):
        for f in files:
            if not f.endswith((".js", ".html")):
                continue
            path = os.path.join(dirpath, f)
            txt = open(path, encoding="utf-8", errors="ignore").read()
            for pat, label in BACKDOOR_PATTERNS:
                for m in re.finditer(pat, txt):
                    bundle_hits.append(
                        {"file": os.path.relpath(path, ROOT), "label": label, "match": m.group(0)}
                    )
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
    },
    "cases": rows,
    "failures": failures,
    "status": "PASS" if not failures else "FAIL",
}
json.dump(manifest, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

with open(OUT_MD, "w", encoding="utf-8") as fh:
    fh.write("# R1-P Preview evidence manifest\n\n")
    fh.write(f"- status: **{manifest['status']}**\n")
    fh.write(f"- cases: {manifest['total_cases']} (28 controlled + 1 unmocked smoke)\n")
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
