import { test } from '@playwright/test';

test('full sheet scan', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('checkup-demo-mode','1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid .wb-card', { timeout: 15000 });
  await page.waitForTimeout(500);

  const info = await page.evaluate(() => {
    const out: { stylesheetIdx: number; href: string | null; rule: string }[] = [];
    [...document.styleSheets].forEach((sheet, sIdx) => {
      try {
        const walk = (rules: CSSRuleList | CSSRule[], context: string = '') => {
          [...rules].forEach((r: any) => {
            if (r.cssText && (r.cssText.includes('holdings-card-grid') || r.cssText.includes('grid-template-columns'))) {
              if (r.cssRules) {
                walk(r.cssRules, context + (r.conditionText ? `@${r.conditionText} ` : ''));
              } else if (r.cssText.includes('holdings-card-grid')) {
                out.push({ stylesheetIdx: sIdx, href: sheet.href, rule: context + r.cssText });
              }
            }
          });
        };
        walk(sheet.cssRules);
      } catch (e: any) {
        out.push({ stylesheetIdx: sIdx, href: sheet.href, rule: 'ACCESS_ERROR: ' + e.message });
      }
    });
    return out;
  });
  console.log(JSON.stringify(info, null, 2));
});
