import { test } from '@playwright/test';

test('verify style element', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('checkup-demo-mode','1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid .wb-card', { timeout: 15000 });
  await page.waitForTimeout(500);

  const info = await page.evaluate(() => {
    const styles = [...document.querySelectorAll('style')];
    const targetIdx = styles.findIndex(s => (s.textContent || '').includes('holdings-card-grid'));
    const t = styles[targetIdx];
    if (!t) return { error: 'no style' };
    const sheet = t.sheet;
    const rules: string[] = [];
    if (sheet) {
      try {
        for (const r of [...sheet.cssRules]) {
          rules.push(r.cssText);
        }
      } catch (e: any) {
        rules.push('ERROR: ' + e.message);
      }
    }
    return {
      targetIdx,
      totalStyles: styles.length,
      ruleCount: rules.length,
      // Only rules mentioning holdings-card-grid OR 1fr
      relevant: rules.filter(r => r.includes('holdings-card-grid') || r.includes('1fr')),
    };
  });
  console.log(JSON.stringify(info, null, 2));
});
