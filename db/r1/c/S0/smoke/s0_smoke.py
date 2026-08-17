#!/usr/bin/env python3
"""S0-7 — baseline smoke against production (https://legendflow.tw) and the
unpublished Preview URL, per identity.

Read-only from the app's point of view: navigation and rendering only, no form
submits, no mutating clicks. Captures per route: final URL, http status,
h1/title, visible-error probes, console errors, failed network requests, and a
screenshot. The output is the *pre-cutover* baseline that S4 compares against.

Usage: python3 s0_smoke.py <identity> [session_json_path]
  identity: anon | admin | subscriber | plain
"""
import asyncio
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "evidence")

TARGETS = [
    ("prod", "https://legendflow.tw"),
    ("preview", "https://id-preview--0f5bdae6-cb07-4e2a-88dc-334c90cb5b02.lovable.app"),
]

ROUTES = [
    "/", "/experts", "/performance", "/journals", "/pricing", "/checkup", "/auth",
    "/account", "/company/users", "/company/perf-metrics",
]

ERROR_TEXTS = ["Something went wrong", "發生錯誤", "Unexpected Application Error",
               "404", "找不到頁面", "permission denied", "Failed to fetch"]


async def probe(page, url):
    console, failed = [], []
    page.on("console", lambda m: console.append("%s: %s" % (m.type, m.text)) if m.type == "error" else None)
    page.on("requestfailed", lambda r: failed.append("%s %s" % (r.method, r.url.split("?")[0])))
    status = None
    try:
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=45000)
        status = resp.status if resp else None
        await page.wait_for_timeout(3500)
    except Exception as e:
        return {"url": url, "error": str(e)[:200], "status": status}
    body = (await page.inner_text("body"))[:20000]
    h1 = ""
    try:
        h1 = (await page.locator("h1").first.inner_text(timeout=2000)).strip()
    except Exception:
        pass
    return {
        "url": url,
        "final_url": page.url,
        "status": status,
        "title": await page.title(),
        "h1": h1,
        "body_len": len(body),
        "body_sha256": hashlib.sha256(body.encode()).hexdigest(),
        "error_texts_present": sorted({t for t in ERROR_TEXTS if t in body}),
        "console_errors": console[:20],
        "console_error_count": len(console),
        "failed_requests": sorted(set(failed))[:20],
    }


async def main():
    identity = sys.argv[1]
    session_path = sys.argv[2] if len(sys.argv) > 2 else None
    os.makedirs(OUT, exist_ok=True)
    result = {"identity": identity, "captured_at": datetime.now(timezone.utc).isoformat(),
              "production_touch": "read-only browsing (no submits, no mutating clicks)", "targets": {}}

    session = None
    if session_path and os.path.isfile(session_path):
        session = json.load(open(session_path))

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        for label, base in TARGETS:
            ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
            page = await ctx.new_page()
            if session:
                await page.goto(base, wait_until="domcontentloaded", timeout=45000)
                key = session.get("storage_key") or session.get("key")
                val = session.get("session_json") or json.dumps(session.get("session") or session)
                await page.evaluate("([k,v]) => localStorage.setItem(k, v)", [key, val])
            rows = []
            for r in ROUTES:
                res = await probe(page, base.rstrip("/") + r)
                res["route"] = r
                shot = os.path.join(OUT, "%s_%s_%s.png" % (identity, label, r.strip("/").replace("/", "_") or "home"))
                try:
                    await page.screenshot(path=shot)
                    res["screenshot"] = os.path.relpath(shot, HERE)
                except Exception:
                    pass
                rows.append(res)
            signed_in = None
            try:
                signed_in = await page.evaluate(
                    "() => Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token'))")
            except Exception:
                pass
            result["targets"][label] = {"base": base, "signed_in_storage": signed_in, "routes": rows}
            await ctx.close()
        await browser.close()

    path = os.path.join(OUT, "smoke_%s.json" % identity)
    open(path, "w").write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    bad = [(t, r["route"], r.get("status"), r.get("error_texts_present"), r.get("console_error_count"))
           for t, tv in result["targets"].items() for r in tv["routes"]
           if r.get("error") or (r.get("status") or 0) >= 400 or r.get("error_texts_present")
           or r.get("console_error_count")]
    print("identity=%s routes=%d findings=%d -> %s" % (identity, len(ROUTES) * 2, len(bad), path))
    for b in bad:
        print("  ", b)


if __name__ == "__main__":
    asyncio.run(main())
