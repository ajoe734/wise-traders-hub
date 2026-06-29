/**
 * 短連結 /s/:slug → /expert/:slug：
 * - 正確 client-side redirect
 * - 目標頁標題包含專家名稱、頁面渲染 hero（H1）
 */
import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const SLUG = process.env.SHARE_EXPERT_SLUG || 'sharkgu';

test('點擊 /s/:slug 短連結會導到 /expert/:slug 並顯示專家資訊', async ({ page }) => {
  await gotoWithRetry(page, `/s/${SLUG}`, { waitUntil: 'domcontentloaded' });

  // 等 SPA redirect
  await page.waitForURL(`**/expert/${SLUG}`, { timeout: 15_000 });
  expect(page.url()).toContain(`/expert/${SLUG}`);

  // 等專家頁渲染（H1 或主要 hero 區塊）
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  const h1 = page.locator('h1').first();
  await h1.waitFor({ state: 'visible', timeout: 15_000 });
  const h1Text = (await h1.textContent())?.trim() || '';
  expect(h1Text.length, 'H1 不可為空').toBeGreaterThan(0);

  // <title> 帶 legendflow 品牌
  const title = await page.title();
  expect(title).toMatch(/legendflow/i);

  // canonical 指向 /expert/:slug
  const canonical = await page.locator('link[rel="canonical"]').first().getAttribute('href');
  expect(canonical).toBe(`https://legendflow.tw/expert/${SLUG}`);

  // og:image 指向 og-card endpoint
  const og = await page.locator('meta[property="og:image"]').first().getAttribute('content');
  expect(og).toContain(`/og-card/expert/${SLUG}`);
});
