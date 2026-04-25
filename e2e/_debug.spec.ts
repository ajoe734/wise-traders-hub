import { test } from '@playwright/test';

test('multi grid debug', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('checkup-demo-mode','1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid .wb-card', { timeout: 15000 });
  await page.waitForTimeout(300);

  const info = await page.evaluate(() => {
    const grids = [...document.querySelectorAll('.holdings-card-grid')] as HTMLElement[];
    return grids.map((g, i) => {
      const cs = getComputedStyle(g);
      const cardCount = g.querySelectorAll('.wb-card').length;
      return {
        idx: i,
        cardCount,
        gridTemplateColumns: cs.gridTemplateColumns,
        inlineStyle: g.getAttribute('style'),
        rect: { left: g.getBoundingClientRect().left, top: g.getBoundingClientRect().top, width: g.getBoundingClientRect().width },
      };
    });
  });
  console.log(JSON.stringify(info, null, 2));
});
