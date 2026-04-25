import { test } from '@playwright/test';
test('diag3', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('checkup-demo-mode', '1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.wb-card-feature', { timeout: 15000 });
  const r = await page.evaluate(() => {
    const f = document.querySelector('.wb-card-feature') as HTMLElement;
    return {
      inlineGC: f.style.gridColumn,
      computedGC: getComputedStyle(f).gridColumn,
    };
  });
  console.log('DIAG3:', JSON.stringify(r));
});
