import { test } from '@playwright/test';
test('diag2', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('checkup-demo-mode', '1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid .wb-card', { timeout: 15000 });
  const r = await page.evaluate(() => {
    const grid = document.querySelector('.holdings-card-grid') as HTMLElement;
    const cs = getComputedStyle(grid);
    const cards = grid.querySelectorAll('.wb-card');
    return {
      gtc: cs.gridTemplateColumns,
      width: grid.getBoundingClientRect().width,
      cardWidths: Array.from(cards).slice(0, 4).map(c => c.getBoundingClientRect().width),
    };
  });
  console.log('DIAG2:', JSON.stringify(r, null, 2));
});
