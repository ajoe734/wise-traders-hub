import { test } from '@playwright/test';
test('count', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('checkup-demo-mode', '1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid', { timeout: 15000 });
  const r = await page.evaluate(() => {
    const all = document.querySelectorAll('.holdings-card-grid');
    return {
      count: all.length,
      rects: Array.from(all).map(g => ({
        w: g.getBoundingClientRect().width,
        gtc: getComputedStyle(g as HTMLElement).gridTemplateColumns,
        kids: g.children.length,
      })),
    };
  });
  console.log('COUNT:', JSON.stringify(r, null, 2));
});
