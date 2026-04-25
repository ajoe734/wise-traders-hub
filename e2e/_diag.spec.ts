import { test } from '@playwright/test';
test('diag', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('checkup-demo-mode', '1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid', { timeout: 15000 });
  const r = await page.evaluate(() => {
    const grid = document.querySelector('.holdings-card-grid') as HTMLElement;
    return {
      inlineGTC: grid.style.gridTemplateColumns,
      inlineCSSText: grid.getAttribute('style'),
      hasImportantInline: grid.style.getPropertyPriority('grid-template-columns'),
    };
  });
  console.log('DIAG:', JSON.stringify(r, null, 2));
});
