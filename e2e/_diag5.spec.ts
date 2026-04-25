import { test } from '@playwright/test';
test('auto', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('checkup-demo-mode', '1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid', { timeout: 15000 });
  const r = await page.evaluate(() => {
    const g = document.querySelector('.holdings-card-grid') as HTMLElement;
    const cs = getComputedStyle(g);
    return {
      gtc: cs.gridTemplateColumns,
      gac: cs.gridAutoColumns,
      gaf: cs.gridAutoFlow,
      // Show children's resolved gridColumn
      kids: Array.from(g.children).slice(0, 5).map((c, i) => ({
        i, cls: c.className.slice(0, 30), gc: getComputedStyle(c).gridColumn
      })),
    };
  });
  console.log('AUTO:', JSON.stringify(r, null, 2));
});
