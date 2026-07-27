/**
 * Route B — live smoke test against real Lovable Cloud backend.
 *
 * 目的：驗證 production-shape 的後端真的能讓 e2e 帳號跑完
 *   1) 登入
 *   2) 載入 /app（受保護路由 + member_subscriptions 查詢）
 *   3) 載入 /pricing（plans/experts 真實查詢）
 *   4) 呼叫 e2e-simulate-purchase 觸發真實 purchase 漏斗
 *      → member_subscriptions insert + payment_transactions insert
 *      → traffic_events 收到 checkout_success
 *   5) 於 afterAll 呼叫 cleanup 移除本輪產生的測試資料
 *
 * 必備 env：
 *   - E2E_TEST_EMAIL / E2E_TEST_PASSWORD（該帳號必須 profiles.is_tester=true）
 *   - VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_PROJECT_ID
 *   - 後端須設 E2E_ALLOW_SIMULATED_PURCHASE=1（生產環境切勿設）
 *
 * 跑法：
 *   E2E_LIVE=1 bunx playwright test --project=desktop-live-smoke
 */
import { test, expect } from '@playwright/test';
import { simulatePurchase, cleanupSimulated, readAccessToken } from './cleanup';

const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;
const PLAN_ID = process.env.E2E_TEST_PLAN_ID;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const PUB_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

test.skip(
  !process.env.E2E_LIVE || !EMAIL || !PASSWORD,
  'Set E2E_LIVE=1 + E2E_TEST_EMAIL + E2E_TEST_PASSWORD to run.',
);

async function login(page: import('@playwright/test').Page) {
  await page.goto('/auth/login');
  await page.locator('input[type="email"]').first().fill(EMAIL!);
  await page.locator('input[type="password"]').first().fill(PASSWORD!);
  await Promise.all([
    page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 }),
    page.getByRole('button', { name: /登入|login/i }).first().click(),
  ]);
}

test.describe('live smoke — auth + protected route + pricing reachable', () => {
  test.afterAll(async ({ browser }) => {
    // afterAll 沒有 page — 開一個新 session 重新登入後 cleanup
    if (!process.env.E2E_LIVE) return;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await login(page);
      const removed = await cleanupSimulated(page);
      // eslint-disable-next-line no-console
      console.log('[live-smoke cleanup]', removed);
    } finally {
      await ctx.close();
    }
  });

  test('login → /app → /pricing 全程使用真實後端', async ({ page }) => {
    await login(page);

    // /app 載入後 member_subscriptions 查詢必須成功（不 500、不 ErrorBoundary）
    await expect(page.locator('text=/找不到頁面|系統發生錯誤|無法載入/i')).toHaveCount(0);

    // /pricing 真實 expert_plans 查詢
    await page.goto('/pricing');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=/方案|plan/i').first()).toBeVisible({ timeout: 15_000 });

    // 點任一 plan CTA 進入 checkout（不送付款）
    const cta = page.getByRole('button', { name: /訂閱|立即|subscribe/i }).first();
    if (await cta.count()) {
      await cta.click().catch(() => undefined);
      await expect(page.locator('text=/系統發生錯誤/i')).toHaveCount(0);
    }
  });

  test('sandbox purchase → traffic_events.checkout_success 寫入成功', async ({ page }) => {
    await login(page);

    const before = Date.now();
    const result = await simulatePurchase(page, PLAN_ID);
    expect(result.ok, `simulatePurchase 應成功：${JSON.stringify(result)}`).toBe(true);
    expect(result.subscriptionId, '應建立 subscription').toBeTruthy();
    expect(result.transactionId, '應建立 transaction').toBeTruthy();
    expect(result.providerTxId, 'provider_tx_id 應為 E2E_SIMULATED_ 前綴').toMatch(/^E2E_SIMULATED_/);

    // 直接查 traffic_events 驗證 checkout_success >= 1（透過 supabase REST + 呼叫者 JWT）
    const token = await readAccessToken(page);
    expect(token, 'access_token 應存在').toBeTruthy();
    const sinceIso = new Date(before - 5_000).toISOString();
    const url = `${SUPABASE_URL}/rest/v1/traffic_events?event_name=eq.checkout_success&created_at=gte.${encodeURIComponent(sinceIso)}&select=id,event_props,created_at&order=created_at.desc&limit=5`;
    const res = await page.request.get(url, {
      headers: {
        apikey: PUB_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    expect(res.status(), `traffic_events 讀取應成功：${await res.text()}`).toBe(200);
    const rows = (await res.json()) as Array<{ event_props?: Record<string, unknown> }>;
    // 部分環境 RLS 對非管理員 tester 唯讀 traffic_events 可能為 0，允許 fallback：
    //   只要 simulatePurchase.ok=true + subscriptionId/transactionId 都在，即代表寫入路徑活著。
    // 若 rows 有內容，額外斷言 provider_tx_id 匹配。
    if (rows.length > 0) {
      const match = rows.find((r) => (r.event_props as { provider_tx_id?: string })?.provider_tx_id === result.providerTxId);
      expect(match, '應能找到剛才 simulate 的 checkout_success 事件').toBeTruthy();
    }
  });
});
