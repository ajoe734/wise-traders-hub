/**
 * og-card edge function：
 *  - GET /og-card/expert/{validSlug}   → SVG 200，含專家名稱
 *  - GET /og-card/expert/{unknownSlug} → SVG 200，回 fallback 品牌卡（含 legendflow wordmark，不含 unknown slug 文字）
 *  - 直接用瀏覽器 page.goto 載入 og-card URL，<svg> 能正確渲染
 */
import { test, expect } from '@playwright/test';

const SB =
  process.env.VITE_SUPABASE_URL ||
  'https://yqacmrgdjlenbijclngi.supabase.co';
const VALID = process.env.SHARE_EXPERT_SLUG || 'sharkgu';
const UNKNOWN = `nonexistent-slug-${Date.now()}`;

test('og-card 有效 slug 回 SVG 並包含 legendflow 品牌', async ({ request }) => {
  const res = await request.get(`${SB}/functions/v1/og-card/expert/${VALID}`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/svg');
  const body = await res.text();
  expect(body).toContain('<svg');
  expect(body).toMatch(/legendflow/i);
});

test('og-card 未知 slug 回預設品牌卡（不破預覽）', async ({ request }) => {
  const res = await request.get(`${SB}/functions/v1/og-card/expert/${UNKNOWN}`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/svg');
  const body = await res.text();
  // fallback 卡固定含 legendflow wordmark
  expect(body).toMatch(/legendflow/i);
  // 不該把 unknown slug 文字 echo 進去
  expect(body).not.toContain(UNKNOWN);
});

test('瀏覽器載入 og-card URL 能正確渲染 SVG', async ({ page }) => {
  const res = await page.goto(`${SB}/functions/v1/og-card/expert/${VALID}`, {
    waitUntil: 'domcontentloaded',
  });
  expect(res?.status()).toBe(200);
  // Chromium 把 SVG 包成 <svg> root 文件
  const svg = page.locator('svg').first();
  await expect(svg).toBeVisible({ timeout: 5_000 });
  const viewBox = await svg.getAttribute('viewBox');
  expect(viewBox).toBe('0 0 1200 630');
});
