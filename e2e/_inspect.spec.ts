import { test } from '@playwright/test';
test('dump', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('checkup-demo-mode', '1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid .wb-card', { timeout: 15000 });
  const data = await page.evaluate(() => {
    const grid = document.querySelector('.holdings-card-grid');
    const cards = grid?.querySelectorAll('.wb-card') || [];
    const cs = grid ? getComputedStyle(grid) : null;
    return {
      gridCols: cs?.gridTemplateColumns,
      gridWidth: grid?.getBoundingClientRect().width,
      viewport: window.innerWidth,
      cardCount: cards.length,
      first3: Array.from(cards).slice(0, 3).map(c => ({
        cls: c.className,
        w: c.getBoundingClientRect().width,
        parent: c.parentElement?.className,
      })),
    };
  });
  console.log('INSPECT:', JSON.stringify(data, null, 2));
});
