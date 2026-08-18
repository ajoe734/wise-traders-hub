"""
PV-E2E — real-browser assertions against the REAL app build talking to a REAL
GoTrue + REAL PostgREST on a disposable clone. No service_role, no direct table
reads substituted for UI: every number asserted here was rendered by the app.

Usage: pve_e2e.py <appBase> <gatewayBase> <outdir> <psqlUri>
Exit 0 only when every assertion passes; prints `CHECK PASS|FAIL <id> <text>`.
"""
import asyncio, hashlib, json, os, subprocess, sys
from pathlib import Path
from playwright.async_api import async_playwright

APP, GW, OUT, PSQL_URI = sys.argv[1], sys.argv[2], Path(sys.argv[3]), sys.argv[4]
OUT.mkdir(parents=True, exist_ok=True)
SHOTS = OUT / "screenshots"; SHOTS.mkdir(exist_ok=True)

RESULTS = []
def chk(cid, ok, text, extra=""):
    RESULTS.append((cid, bool(ok), text))
    print(f"CHECK {'PASS' if ok else 'FAIL'} {cid} {text} {extra}".rstrip())

UNAVAILABLE = "資料暫時無法取得"
USERS = {
    "alpha":  ("pve-alpha@pve.local", "PveAlpha!2026"),
    "beta":   ("pve-beta@pve.local", "PveBeta!2026"),
    "admin":  ("pve-admin@pve.local", "PveAdmin!2026"),
    "member": ("pve-member@pve.local", "PveMember!2026"),
}

def psql(sql):
    return subprocess.run(["psql", PSQL_URI, "-qXAt", "-v", "ON_ERROR_STOP=1", "-c", sql],
                          capture_output=True, text=True, check=True).stdout.strip()

async def collect(page, errors):
    page.on("console", lambda m: errors.append(f"{m.type}:{m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror:{e}"))

async def login(page, who):
    email, pw = USERS[who]
    await page.goto(f"{APP}/auth/login", wait_until="domcontentloaded")
    await page.wait_for_timeout(400)
    await page.fill("input[type=email]", email)
    await page.fill("input[type=password]", pw)
    await page.get_by_role("button", name="登入").first.click()
    await page.wait_for_timeout(2500)

async def logout(page):
    await page.evaluate("() => { window.localStorage.clear(); window.sessionStorage.clear(); }")
    await page.goto(f"{APP}/", wait_until="domcontentloaded")
    await page.wait_for_timeout(300)

async def perf_rows(page, slug):
    await page.goto(f"{APP}/admin/{slug}/performance", wait_until="domcontentloaded")
    await page.wait_for_timeout(3500)
    return await page.evaluate("""() => {
      const trs = Array.from(document.querySelectorAll('table tbody tr'));
      return trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()));
    }""")

async def signals_text(page, slug):
    """Open /admin/<slug>/signals and return list-text + every expanded row's
    text. Only one row can be expanded at a time (single expandedId), so each
    「展開」 button is clicked in turn and its rendered content accumulated."""
    await page.goto(f"{APP}/admin/{slug}/signals", wait_until="domcontentloaded")
    await page.wait_for_timeout(3500)
    chunks = [await page.inner_text("body")]
    for _ in range(40):
        btns = page.get_by_role("button", name="展開")
        n = await btns.count()
        if n == 0:
            break
        clicked = False
        for i in range(n):
            b = btns.nth(i)
            try:
                await b.scroll_into_view_if_needed(timeout=2000)
                await b.click(timeout=3000)
            except Exception:
                continue
            await page.wait_for_timeout(500)
            chunks.append(await page.inner_text("body"))
            clicked = True
            try:
                await page.get_by_role("button", name="收起").first.click(timeout=3000)
                await page.wait_for_timeout(250)
            except Exception:
                pass
        if not clicked:
            break
        break
    return "\n".join(chunks)


def cell(rows, symbol):
    for r in rows:
        if symbol in (r[0] if r else ""):
            return r
    return None

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        errors = []
        await collect(page, errors)

        # ---------------------------------------------------------- anon
        await page.goto(f"{APP}/admin/pve-alpha/performance", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        body = await page.inner_text("body")
        chk("E1", "績效總覽" not in body or "登入" in body,
            "anon 無法看到 /admin/pve-alpha/performance 的績效內容")
        chk("E2", "SOXL" not in body, "anon 不會洩漏任何持倉標的")
        await page.screenshot(path=str(SHOTS / "e1_anon.png"))

        # ---------------------------------------------------------- member
        await login(page, "member")
        await page.goto(f"{APP}/admin/pve-alpha/performance", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")
        chk("E3", ("權限不足" in body or "找不到此專家" in body) and "SOXL" not in body,
            "一般登入者被 /admin/pve-alpha 後台拒絕")
        await page.screenshot(path=str(SHOTS / "e3_member.png"))
        await logout(page)

        # ---------------------------------------------------------- teacher B → A 後台
        await login(page, "beta")
        await page.goto(f"{APP}/admin/pve-alpha/performance", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")
        chk("E4", ("權限不足" in body or "找不到此專家" in body) and "SOXL" not in body,
            "老師 B 不能進入老師 A 的後台")
        rows_b = await perf_rows(page, "pve-beta")
        r2330 = cell(rows_b, "2330")
        chk("E5", r2330 is not None and "2,000 股" in r2330[1], "老師 B 自己的後台顯示 2330 真值數量",
            str(r2330))
        chk("E6", r2330 is not None and r2330[3].replace(",", "").startswith("1085"), "老師 B 2330 現價為真值", str(r2330))
        await page.screenshot(path=str(SHOTS / "e5_beta_own.png"))
        await logout(page)

        # ---------------------------------------------------------- teacher A (owner)
        await login(page, "alpha")
        rows_a = await perf_rows(page, "pve-alpha")
        await page.screenshot(path=str(SHOTS / "e7_alpha_perf.png"))
        (OUT / "rows_alpha_owner.json").write_text(json.dumps(rows_a, ensure_ascii=False, indent=1))
        soxl, qcom, orcl, spx = (cell(rows_a, s) for s in ("SOXL", "QCOM", "ORCL", "SPACEX"))
        chk("E7", soxl and "300 股" in soxl[1] and "22.5" in soxl[2] and "25.1" in soxl[3],
            "owner 看到 SOXL 真實數量/進場價/現價", str(soxl))
        chk("E8", soxl and "11.56" in soxl[5], "SOXL 報酬率為真值 +11.56%", str(soxl))
        chk("E9", qcom and "100 股" in qcom[1] and "168.2" in qcom[3] and "12.13" in qcom[5],
            "owner 看到 QCOM 真值", str(qcom))
        chk("E10", orcl and "50 股" in orcl[1] and "9.62" in orcl[5], "owner 看到 ORCL 真值", str(orcl))
        chk("E11", spx and "0 股" in spx[1] and UNAVAILABLE not in spx[1],
            "true zero 只顯示「0 股」，不得被遮蔽", str(spx))
        page_text = await page.inner_text("body")
        chk("E12", UNAVAILABLE not in page_text, "view ready 時整頁沒有遮蔽字串")
        chk("E13", "持有中" in page_text and "檢核中" not in page_text, "狀態顯示「持有中」")

        # 已實現分頁（兩個不同 period）
        await page.get_by_role("tab", name="已實現損益").click()
        await page.wait_for_timeout(2000)
        realized_seen = [await page.inner_text("body")]
        periods = 1
        for label in ("近一年", "近三月", "近一月", "近一週"):
            try:
                await page.get_by_role("button", name=label).first.click(timeout=3000)
                await page.wait_for_timeout(1500)
                realized_seen.append(await page.inner_text("body"))
                periods += 1
            except Exception:
                pass
        realized_all = "\n".join(realized_seen)
        (OUT / "realized_tab.txt").write_text(realized_all)
        chk("E14", "AMD" in realized_all, "已實現分頁顯示 AMD（已了結部位）")
        chk("E15", periods >= 3, f"已實現分頁切換 {periods} 個 period 未崩潰")
        await page.screenshot(path=str(SHOTS / "e14_realized.png"))

        # ---------------------------------------------------------- 週記後台（作者/週次/內文）
        sig_owner = await signals_text(page, "pve-alpha")
        (OUT / "signals_owner.txt").write_text(sig_owner)
        await page.screenshot(path=str(SHOTS / "e16_signals_owner.png"))
        chk("E16", "PVE Alpha 老師" in sig_owner or "pve-alpha" in sig_owner,
            "週記後台顯示正確作者")
        chk("E17", "PVE-W1-ALPHA-BODY" in sig_owner and "PVE-W2-ALPHA-BODY" in sig_owner,
            "兩週老師內文都出現")
        chk("E18", "PVE-W1-EDGE-2359-BODY" in sig_owner and "PVE-W2-EDGE-0000-BODY" in sig_owner,
            "跨週 / timezone boundary 兩筆都出現")
        chk("E19", "PVE-W1-BETA-BODY" not in sig_owner and "PVE-W2-BETA-BODY" not in sig_owner,
            "老師 A 的後台不含老師 B 的內文")
        chk("E20", "2026/08/03" in sig_owner or "08/03" in sig_owner, "週次/日期有渲染")
        owner_hash = hashlib.sha256(
            "".join(sorted(l for l in sig_owner.splitlines() if "PVE-W" in l)).encode()
        ).hexdigest()

        # ---------------------------------------------------------- save → reload → logout → login
        token = await page.evaluate("""() => {
          for (const k of Object.keys(localStorage)) {
            if (k.includes('auth-token')) { try { return JSON.parse(localStorage[k]).access_token; } catch(e){} }
          }
          return null;
        }""")
        chk("E21", bool(token), "取得 owner 的真 JWT（GoTrue 簽發）")
        new_body = "PVE-W2-ALPHA-BODY-EDITED 第二週補充：加碼條件已達成。"
        patched = await page.evaluate("""async ([gw, tok, body]) => {
          const r = await fetch(gw + '/rest/v1/expert_signals?id=eq.aaaa1004-0000-4000-c000-000000000004', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', apikey: tok,
                       authorization: 'Bearer ' + tok, prefer: 'return=representation' },
            body: JSON.stringify({ reason_detail: body }),
          });
          return { status: r.status, text: (await r.text()).slice(0, 400) };
        }""", [GW, token, new_body])
        chk("E22", patched["status"] in (200, 204) and "EDITED" in patched["text"],
            "owner 用自己的 JWT 走 RLS 寫入成功（非 service_role）", json.dumps(patched, ensure_ascii=False))

        after_save = await signals_text(page, "pve-alpha")
        chk("E23", "PVE-W2-ALPHA-BODY-EDITED" in after_save, "save → reload 後新內容出現")
        hash_after_save = hashlib.sha256(
            "".join(sorted(l for l in after_save.splitlines() if "PVE-W" in l)).encode()
        ).hexdigest()

        await logout(page)
        await login(page, "alpha")
        after_relogin = await signals_text(page, "pve-alpha")
        hash_relogin = hashlib.sha256(
            "".join(sorted(l for l in after_relogin.splitlines() if "PVE-W" in l)).encode()
        ).hexdigest()
        chk("E24", hash_relogin == hash_after_save,
            "logout → login 後週記內容 hash 不變", f"{hash_after_save[:12]}/{hash_relogin[:12]}")
        (OUT / "content_hashes.txt").write_text(
            f"pre_save={owner_hash}\npost_save={hash_after_save}\npost_relogin={hash_relogin}\n")

        # ---------------------------------------------------------- 老師 B 的後台不含 A 的內文
        await logout(page); await login(page, "beta")
        sig_beta = await signals_text(page, "pve-beta")
        chk("E25", "PVE-W1-BETA-BODY" in sig_beta and "PVE-W1-ALPHA-BODY" not in sig_beta,
            "老師 B 後台只有自己的內文")
        await logout(page)

        # ---------------------------------------------------------- company_admin
        await login(page, "admin")
        rows_adm = await perf_rows(page, "pve-alpha")
        (OUT / "rows_alpha_admin.json").write_text(json.dumps(rows_adm, ensure_ascii=False, indent=1))
        chk("E26", rows_adm == rows_a, "company_admin 看到與 owner 完全相同的數字",
            f"{len(rows_adm)} vs {len(rows_a)} rows")
        sig_adm = await signals_text(page, "pve-alpha")
        chk("E27", "PVE-W1-ALPHA-BODY" in sig_adm and "PVE-W2-ALPHA-BODY-EDITED" in sig_adm,
            "company_admin 看得到正確作者與兩週內文")
        await page.screenshot(path=str(SHOTS / "e27_admin_signals.png"))
        await logout(page)

        # ---------------------------------------------------------- fail-closed: missing relation
        psql("DROP VIEW public.public_expert_state_active")
        await login(page, "alpha")
        rows_missing = await perf_rows(page, "pve-alpha")
        missing_text = await page.inner_text("body")
        await page.screenshot(path=str(SHOTS / "e28_missing_relation.png"))
        (OUT / "rows_alpha_missing_relation.json").write_text(json.dumps(rows_missing, ensure_ascii=False, indent=1))
        chk("E28", all(UNAVAILABLE in r[1] for r in rows_missing if len(r) > 1),
            "relation 缺席時每一列數量都顯示「資料暫時無法取得」", str(rows_missing[:1]))
        chk("E29", "檢核中" in missing_text, "relation 缺席時狀態顯示「檢核中」")
        chk("E30", "25.1" not in missing_text and "168.2" not in missing_text and "300 股" not in missing_text,
            "fail-closed 時不洩漏任何真值")
        chk("E31", "PVE" not in missing_text or "SOXL" in missing_text,
            "fail-closed 只遮數字，不影響標的識別")

        # ---------------------------------------------------------- restore + incomplete state
        subprocess.run(["psql", PSQL_URI, "-qX", "-v", "ON_ERROR_STOP=1",
                        "-f", "db/r1/c/PV/001_projection_view.sql"], check=True, capture_output=True)
        psql("UPDATE public.trade_records SET entry_price = NULL WHERE id = 'aaaa0003-0000-4000-a000-000000000003'")
        rows_inc = await perf_rows(page, "pve-alpha")
        inc_text = await page.inner_text("body")
        await page.screenshot(path=str(SHOTS / "e32_incomplete.png"))
        chk("E32", all(UNAVAILABLE in r[1] for r in rows_inc if len(r) > 1),
            "state=incomplete 時同樣遮蔽（fail-closed）")
        chk("E33", "檢核中" in inc_text and "25.1" not in inc_text,
            "incomplete 顯示檢核中且不洩漏真值")
        psql("UPDATE public.trade_records SET entry_price = 130.00 WHERE id = 'aaaa0003-0000-4000-a000-000000000003'")
        rows_back = await perf_rows(page, "pve-alpha")
        chk("E34", cell(rows_back, "SOXL") and "300 股" in cell(rows_back, "SOXL")[1],
            "state 回到 ready 後真值自動恢復")

        # ------------------------------------------------- /signals 欄位與存取隔離
        # 目前 session = alpha（owner）
        sig_fields = await signals_text(page, "pve-alpha")
        (OUT / "signals_owner_fields.txt").write_text(sig_fields)
        await page.screenshot(path=str(SHOTS / "e36_signals_fields.png"))
        chk("E36", "SOXL" in sig_fields and "QCOM" in sig_fields and "ORCL" in sig_fields,
            "/signals 列表標的正確（SOXL/QCOM/ORCL）")
        chk("E37", ("22.5" in sig_fields) and ("300" in sig_fields),
            "/signals 列表價位與數量為真值（22.5 / 300）")
        chk("E38", any(k in sig_fields for k in ("買進", "買", "buy")) and
                   any(k in sig_fields for k in ("加碼", "add")),
            "/signals 列表方向正確（買進 / 加碼）")
        chk("E39", "半導體週期" in sig_fields and "PVE-W1-ALPHA-LEARN" in sig_fields,
            "/signals 展開後 teaching_topic 與學習重點欄位正確")
        chk("E40", "PVE-W1-ALPHA-SUMMARY" in sig_fields and "PVE-W2-ALPHA-BODY-EDITED" in sig_fields,
            "/signals 展開後摘要與操作理由欄位正確")
        await logout(page)

        await page.goto(f"{APP}/admin/pve-alpha/signals", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        sig_anon = await page.inner_text("body")
        chk("E41", "PVE-W1-ALPHA-BODY" not in sig_anon and "PVE-W1-ALPHA-SUMMARY" not in sig_anon,
            "anon 在 /admin/pve-alpha/signals 看不到任何老師內文")

        await login(page, "member")
        await page.goto(f"{APP}/admin/pve-alpha/signals", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        sig_mem = await page.inner_text("body")
        chk("E42", "PVE-W1-ALPHA-BODY" not in sig_mem and
                   ("權限不足" in sig_mem or "找不到此專家" in sig_mem or "登入" in sig_mem),
            "一般會員被 /admin/pve-alpha/signals 拒絕")
        await logout(page)

        await login(page, "beta")
        await page.goto(f"{APP}/admin/pve-alpha/signals", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        sig_cross = await page.inner_text("body")
        await page.screenshot(path=str(SHOTS / "e43_cross_teacher_signals.png"))
        chk("E43", "PVE-W1-ALPHA-BODY" not in sig_cross and "PVE-W2-ALPHA-BODY-EDITED" not in sig_cross,
            "老師 B 在老師 A 的 /signals 後台看不到 A 的內文")
        await logout(page)
        await login(page, "alpha")


        # ---------------------------------------------------------- console errors
        app_errors = [e for e in errors if "realtime" not in e.lower() and "websocket" not in e.lower()]
        (OUT / "console_errors.txt").write_text("\n".join(errors))
        chk("E35", len(app_errors) == 0, "0 app console error（realtime 傳輸噪音已分類排除）",
            "; ".join(app_errors[:3]))

        await browser.close()

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    print(f"### E2E SUMMARY checks={len(RESULTS)} passed={passed} failed={len(RESULTS)-passed}")
    (OUT / "e2e_summary.json").write_text(json.dumps(
        {"checks": len(RESULTS), "passed": passed, "failed": len(RESULTS) - passed,
         "results": [{"id": c, "pass": ok, "text": t} for c, ok, t in RESULTS]},
        ensure_ascii=False, indent=1))
    sys.exit(0 if passed == len(RESULTS) else 1)

asyncio.run(main())
