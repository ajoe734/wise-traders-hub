import { test } from '@playwright/test';

test('check gap and cs', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('checkup-demo-mode','1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid .wb-card', { timeout: 15000 });
  await page.waitForTimeout(500);

  const info = await page.evaluate(() => {
    const g = document.querySelector('.holdings-card-grid') as HTMLElement;
    const cs = getComputedStyle(g);
    return {
      gap: cs.gap,
      columnGap: cs.columnGap,
      rowGap: cs.rowGap,
      gridTemplateColumns: cs.gridTemplateColumns,
      gridAutoColumns: cs.gridAutoColumns,
      gridAutoFlow: cs.gridAutoFlow,
      display: cs.display,
      width: cs.width,
    };
  });
  console.log(JSON.stringify(info, null, 2));
});
