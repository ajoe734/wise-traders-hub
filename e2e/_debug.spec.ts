import { test } from '@playwright/test';

test('precise grid debug', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('checkup-demo-mode','1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid .wb-card', { timeout: 15000 });
  await page.waitForTimeout(300);

  const info = await page.evaluate(() => {
    const g = document.querySelector('.holdings-card-grid') as HTMLElement;
    const cs = getComputedStyle(g);
    // Force a recompute with inline override to see what actually wins
    const beforeGTC = cs.gridTemplateColumns;

    // Inline test override
    g.style.gridTemplateColumns = '1fr';
    const afterGTC = getComputedStyle(g).gridTemplateColumns;

    return {
      mediaMatches640: window.matchMedia('(max-width: 640px)').matches,
      mediaMatches1023: window.matchMedia('(max-width: 1023px)').matches,
      mediaMatches1279: window.matchMedia('(max-width: 1279px)').matches,
      innerWidth: window.innerWidth,
      docClientWidth: document.documentElement.clientWidth,
      beforeGTC,
      afterInlineOverride: afterGTC,
      // 還原
      _: (() => { g.style.removeProperty('grid-template-columns'); return null; })(),
      finalGTC: getComputedStyle(g).gridTemplateColumns,
    };
  });
  console.log(JSON.stringify(info, null, 2));
});
