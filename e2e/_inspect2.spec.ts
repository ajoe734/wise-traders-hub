import { test } from '@playwright/test';
test('css', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('checkup-demo-mode', '1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid', { timeout: 15000 });
  const r = await page.evaluate(() => {
    const grid = document.querySelector('.holdings-card-grid')!;
    const inline = (grid as HTMLElement).style.gridTemplateColumns;
    // Find which rules apply
    const styles = Array.from(document.querySelectorAll('style'))
      .map(s => s.textContent || '')
      .filter(c => c.includes('holdings-card-grid'));
    return {
      inline,
      styleCount: styles.length,
      hasMQ640: styles.some(s => /max-width:\s*640px[^}]*holdings-card-grid[^}]*1fr/.test(s.replace(/\n/g,' '))),
      mediaMatches: window.matchMedia('(max-width: 640px)').matches,
      vw: window.innerWidth,
    };
  });
  console.log('CSS:', JSON.stringify(r, null, 2));
});
