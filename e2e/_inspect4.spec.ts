import { test } from '@playwright/test';
test('comp', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('checkup-demo-mode', '1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid', { timeout: 15000 });
  const r = await page.evaluate(() => {
    const grid = document.querySelector('.holdings-card-grid') as HTMLElement;
    const cs = getComputedStyle(grid);
    return {
      gtc: cs.gridTemplateColumns,
      display: cs.display,
      width: grid.getBoundingClientRect().width,
      flowRoot: cs.gridAutoFlow,
      child0gc: getComputedStyle(grid.children[0]).gridColumn,
      child1gc: getComputedStyle(grid.children[1]).gridColumn,
    };
  });
  console.log('COMP:', JSON.stringify(r, null, 2));
});
