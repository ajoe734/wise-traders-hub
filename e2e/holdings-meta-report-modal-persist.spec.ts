// HoldingMetaReportModal — 儲存後關閉並 reopen，欄位必須從 currentMeta 帶回：
//   1. 首次開啟：industries 輸入預設值來自 STOCK_META（可為預設產業或空）。
//   2. 填入獨特字串 → 按「儲存」→ modal 關閉 → holding_meta_overrides upsert 觸發。
//   3. reopen 同一張 wb-card 的 modal → industries 欄位必須是剛剛儲存的值（由 override → getMultiMeta → currentMeta 灌回）。
//
// 對應 project：desktop-holdings-meta-report-modal-persist
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const PROJECT_REF = 'yqacmrgdjlenbijclngi';
const SUPABASE_HOST = `https://${PROJECT_REF}.supabase.co`;

async function setupDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
      // /holding-checkup-demo entry 只在 preview host 下才寫這旗標；
      // 測試在 localhost 執行也應強制 demo mode 才有 wb-card 可點。
      window.sessionStorage.setItem('lf_force_demo', '1');
    } catch {}
  });
}

async function openModal(page: Page) {
  const firstCard = page.locator('.wb-card').first();
  await firstCard.waitFor({ state: 'attached', timeout: 15_000 });
  await firstCard.scrollIntoViewIfNeeded();
  const reportBtn = page.locator('button[title="回報分類錯誤"]').first();
  await reportBtn.waitFor({ state: 'attached', timeout: 15_000 });
  await reportBtn.scrollIntoViewIfNeeded();
  await expect(reportBtn).toBeVisible({ timeout: 10_000 });
  await reportBtn.click({ force: true });
  const dialog = page.getByRole('dialog', { name: '回報分類錯誤' });
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  return dialog;
}

test.describe('HoldingMetaReportModal — 儲存 → 關閉 → reopen 欄位保留', () => {
  test('儲存後 reopen：industries 欄位帶回剛寫入 holding_meta_overrides 的值', async ({ page }) => {
    // === Arrange：mock 一個假的登入使用者 + holding_meta_overrides in-memory store ===
    await setupDemo(page);
    await seedSession(page, { id: 'test-user-id', email: 'e2e@legendflow.local' });

    const store = new Map<string, any>(); // code → row
    const restLog: Array<{ method: string; body: any; returned: number }> = [];

    await installRoutes(page, {
      rest: {
        holding_meta_overrides: ({ method, body }) => {
          if (method === 'GET') {
            const rows = Array.from(store.values());
            restLog.push({ method, body: null, returned: rows.length });
            return rows;
          }
          if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
            const rows = Array.isArray(body) ? body : [body];
            for (const r of rows) {
              if (!r?.code) continue;
              const prev = store.get(String(r.code)) || {};
              store.set(String(r.code), { ...prev, ...r });
            }
            const out = Array.from(store.values());
            restLog.push({ method, body: rows, returned: out.length });
            return out;
          }
          return [];
        },
      },
      // check_checkup_quota 之類的 RPC 沒 mock 就回 [] 即可
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('[browser err]', msg.text());
    });

    // installRoutes 已裝一個廣義 /auth/v1/** → 回 {}；
    // 但 supabase.auth.getUser() 會打 /auth/v1/user 期望拿到 user 物件，
    // 這裡加上更後面 register 的路由，讓它優先命中。
    await page.route(`${SUPABASE_HOST}/auth/v1/user*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-user-id',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'e2e@legendflow.local',
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: {},
          created_at: new Date().toISOString(),
        }),
      }),
    );

    await gotoWithRetry(page, '/holding-checkup', { waitUntil: 'domcontentloaded' });
    await page.locator('.wb-card').first().waitFor({ state: 'visible', timeout: 15_000 });

    // === Act 1：開 modal、記錄 code 與初始值 ===
    const dialog1 = await openModal(page);
    // industries 是第一個 <input placeholder="例：...">
    const industriesInput1 = dialog1.locator('input[placeholder^="例："]').first();
    await expect(industriesInput1).toBeVisible();
    const initialIndustries = (await industriesInput1.inputValue()) ?? '';

    // dialog 標題含「回報分類 — 名稱（CODE）」→ 取回 code 用來對 store key
    const titleText = (await dialog1.locator(':scope > div').first()
      .locator('div').first().textContent()) ?? '';
    const codeMatch = titleText.match(/（(.+?)）/);
    expect(codeMatch, `title 應包含 code：${titleText}`).not.toBeNull();
    const code = codeMatch![1];

    // 填一個不可能出現在 STOCK_META 的獨特字串
    const uniqueIndustry = `E2E產業_${Date.now()}`;
    await industriesInput1.fill(uniqueIndustry);
    await expect(industriesInput1).toHaveValue(uniqueIndustry);

    // 點「儲存」，等 upsert POST 完成 + dialog 消失
    const [upsertReq] = await Promise.all([
      page.waitForRequest(
        (req) =>
          req.url().includes('/rest/v1/holding_meta_overrides') &&
          (req.method() === 'POST' || req.method() === 'PATCH'),
        { timeout: 10_000 },
      ),
      dialog1.getByRole('button', { name: '儲存' }).click(),
    ]);
    // 確認送出的 payload 是我們塞的字串（industries 陣列）
    const upsertBody = upsertReq.postDataJSON();
    const upsertRow = Array.isArray(upsertBody) ? upsertBody[0] : upsertBody;
    expect(upsertRow?.code).toBe(code);
    expect(upsertRow?.industries).toEqual([uniqueIndustry]);

    await expect(dialog1).toHaveCount(0, { timeout: 5_000 });

    // 儲存後：wb-card 內的產業 chip 應該立刻反映新值（override → filteredSortedList → HoldingCard）
    await expect(page.locator('.wb-card').getByText(uniqueIndustry).first()).toBeVisible({
      timeout: 10_000,
    });

    // 直接對 client 打一次 GET，確認 mock/DB 端已寫入
    const dbRow = await page.evaluate(async ({ host, code }) => {
      const key = 'sb-yqacmrgdjlenbijclngi-auth-token';
      const raw = localStorage.getItem(key);
      const token = raw ? JSON.parse(raw).access_token : '';
      const res = await fetch(`${host}/rest/v1/holding_meta_overrides?code=eq.${code}&select=*`, {
        headers: { apikey: 'anon', authorization: `Bearer ${token}` },
      });
      return res.json();
    }, { host: SUPABASE_HOST, code });
    expect(Array.isArray(dbRow) && dbRow.length, `mock DB 應含 override row`).toBeTruthy();
    expect(dbRow[0]?.industries).toEqual([uniqueIndustry]);

    // === Act 2：reopen 同張卡片的 modal ===
    const dialog2 = await openModal(page);
    const titleText2 = (await dialog2.locator(':scope > div').first()
      .locator('div').first().textContent()) ?? '';
    const codeMatch2 = titleText2.match(/（(.+?)）/);
    expect(codeMatch2?.[1], `reopen 應該打開同一張 code=${code} 的 modal`).toBe(code);
    const industriesInput2 = dialog2.locator('input[placeholder^="例："]').first();
    await expect(industriesInput2).toBeVisible();





    // === Assert：欄位應顯示剛剛儲存的獨特值（不是原始值、不是空）===
    await expect(industriesInput2).toHaveValue(uniqueIndustry);
    expect(uniqueIndustry).not.toBe(initialIndustries);
  });
});
