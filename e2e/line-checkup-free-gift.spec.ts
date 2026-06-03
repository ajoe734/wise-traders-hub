/**
 * LINE 註冊禮：第一次免費 → 第二次付費 完整流程 E2E。
 * 三個 scenario：首次免費 / 已用完 / last_used_at fallback。
 */
import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const LINE_USER = { id: 'line-user-uuid', email: 'line_U123@line.local' };

function quotaPayload(used: number, last_used_at: string | null) {
  return {
    tier: 'line_free',
    period: 'lifetime',
    limit: 1,
    used,
    remaining: Math.max(1 - used, 0),
    resets_at: 'infinity',
    last_used_at,
  };
}

async function gotoCheckupWithQuota(page, quota: any) {
  await seedSession(page, LINE_USER);
  await installRoutes(page, {
    rest: {
      check_checkup_quota: () => quota,
      profiles: () => [{ user_id: LINE_USER.id, line_user_id: 'U123', display_name: 'Tester', is_line_friend: true, is_tester: false }],
      checkup_storage: () => [],
    },
    functions: {},
  });
  await page.goto('/checkup');
  await page.waitForLoadState('networkidle');
}

test.describe('LINE 註冊禮 quota flow', () => {
  test('Scenario A: 首次免費 → 顯示「還可使用 1 次」', async ({ page }) => {
    await gotoCheckupWithQuota(page, quotaPayload(0, null));
    // 點到收盤分析 tab
    await page.getByRole('button', { name: /收盤分析|每.日.收.盤|Daily/ }).first().click().catch(() => {});
    const body = page.locator('body');
    await expect(body).toContainText('LINE 註冊禮：第一次免費；第二次起需付費');
    await expect(body).toContainText(/還可使用 1 次|還剩 1 次/);
    await expect(body).not.toContainText(/使用日 \d{4}\/\d{2}\/\d{2}/);
  });

  test('Scenario B: 已用完 + 有 last_used_at → 顯示 Asia/Taipei 使用日 + 付費 CTA', async ({ page }) => {
    await gotoCheckupWithQuota(page, quotaPayload(1, '2026-06-03T05:30:00Z'));
    const body = page.locator('body');
    await expect(body).toContainText(/LINE 註冊禮.*已用完|已用完.*LINE 註冊禮/);
    await expect(body).toContainText('使用日 2026/06/03');
    // CTA 連到 pricing
    const cta = page.locator('a[href="/pricing#checkup"]').first();
    await expect(cta).toBeVisible();
  });

  test('Scenario C: 已用完 + null last_used_at → fallback「使用日 尚未紀錄」', async ({ page }) => {
    await gotoCheckupWithQuota(page, quotaPayload(1, null));
    const body = page.locator('body');
    await expect(body).toContainText('已用完');
    await expect(body).toContainText('使用日 尚未紀錄');
    await expect(body).not.toContainText(/使用日 \d{4}\/\d{2}\/\d{2}/);
  });

  test('Scenario D: 跨日時區驗證（UTC 16:30 → 隔日台北 00:30）', async ({ page }) => {
    await gotoCheckupWithQuota(page, quotaPayload(1, '2026-06-03T16:30:00Z'));
    await expect(page.locator('body')).toContainText('使用日 2026/06/04');
  });
});
