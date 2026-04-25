import { test } from '@playwright/test';
test('style', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('checkup-demo-mode', '1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid', { timeout: 15000 });
  const r = await page.evaluate(() => {
    const styles = Array.from(document.querySelectorAll('style'));
    const found = styles.filter(s => s.textContent?.includes('holdings-card-grid'));
    return {
      total: styles.length,
      foundCount: found.length,
      foundTexts: found.map(s => s.textContent?.slice(0, 200)),
    };
  });
  console.log('STYLE:', JSON.stringify(r, null, 2));
});
