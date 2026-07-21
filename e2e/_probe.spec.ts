import { test } from '@playwright/test';
test('probe', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => { try {
    localStorage.setItem('checkup-coach-seen-v1','1');
    localStorage.setItem('holdings-intro-video-seen-v2','1');
    localStorage.setItem('lf.checkup.onboarded','1');
    localStorage.setItem('checkup-onboarding-tour-v1','done');
    sessionStorage.setItem('holdings-intro-video-dismissed-session','1');
  } catch {} });
  await page.goto('http://localhost:8080/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
  await page.locator('.wb-card').first().click();
  await page.locator('[data-testid="holdings-detail-panel"]').first().waitFor();
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const row = document.querySelector('.holdings-detail-identity-row') as HTMLElement;
    const h2 = row?.querySelector('h2') as HTMLElement;
    const d = row?.querySelector('[data-testid="drawer-today-delta"]') as HTMLElement;
    const cs = row && getComputedStyle(row);
    const csH2 = h2 && getComputedStyle(h2);
    const csD = d && getComputedStyle(d);
    return {
      row: row?.getBoundingClientRect(),
      h2: h2?.getBoundingClientRect(),
      delta: d?.getBoundingClientRect(),
      rowStyle: cs && { display: cs.display, flexDirection: cs.flexDirection, flexWrap: cs.flexWrap, alignItems: cs.alignItems, width: cs.width },
      h2Style: csH2 && { flex: csH2.flex, minWidth: csH2.minWidth, whiteSpace: csH2.whiteSpace, width: csH2.width },
      deltaStyle: csD && { flex: csD.flex, width: csD.width },
      h2Text: h2?.textContent?.slice(0,30),
    };
  });
  console.log('PROBE:', JSON.stringify(info, null, 2));
});
