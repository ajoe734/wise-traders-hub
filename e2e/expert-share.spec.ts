import { test, expect } from '@playwright/test';

/**
 * 專家頁分享流程：
 * 1. 公開 /expert/:slug 帶 og-card 圖與 canonical
 * 2. 短連結 /s/:slug 重導到 /expert/:slug
 * 3. share-og expert 端點 og:image 指向 og-card
 * 4. og-card edge function 回 SVG
 */

const SLUG = 'sharkgu';
const SB = process.env.VITE_SUPABASE_URL || 'https://yqacmrgdjlenbijclngi.supabase.co';

test('公開專家頁帶 og:image 指向 og-card', async ({ page }) => {
  await page.goto(`http://localhost:8080/expert/${SLUG}`, { waitUntil: 'networkidle' });
  const ogImage = await page.locator('meta[property="og:image"]').first().getAttribute('content');
  expect(ogImage).toContain('/og-card/expert/');
  const canonical = await page.locator('link[rel="canonical"]').first().getAttribute('href');
  expect(canonical).toBe(`https://legendflow.tw/expert/${SLUG}`);
});

test('短連結 /s/:slug 重導到 /expert/:slug', async ({ page }) => {
  await page.goto(`http://localhost:8080/s/${SLUG}`);
  await page.waitForURL(`**/expert/${SLUG}`);
  expect(page.url()).toContain(`/expert/${SLUG}`);
});

test('og-card edge function 回 SVG', async ({ request }) => {
  const res = await request.get(`${SB}/functions/v1/og-card/expert/${SLUG}`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/svg');
  const body = await res.text();
  expect(body).toContain('legendflow');
});

test('share-og expert HTML 帶 legendflow 品牌 og:image', async ({ request }) => {
  const res = await request.get(`${SB}/functions/v1/share-og/expert/${SLUG}`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toMatch(/og:image"\s+content="[^"]*\/og-card\/expert\//);
});
