import { test } from '@playwright/test';
test('force', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('checkup-demo-mode', '1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid', { timeout: 15000 });
  const r = await page.evaluate(() => {
    const g = document.querySelector('.holdings-card-grid') as HTMLElement;
    g.style.setProperty('grid-template-columns', '1fr', 'important');
    // Force layout
    void g.offsetHeight;
    return {
      gtc: getComputedStyle(g).gridTemplateColumns,
      width: g.getBoundingClientRect().width,
    };
  });
  console.log('FORCE:', JSON.stringify(r));
});
