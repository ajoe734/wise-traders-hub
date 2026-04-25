import { test } from '@playwright/test';

test('dump grid info', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('checkup-demo-mode','1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid .wb-card', { timeout: 15000 });
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => {
    const g = document.querySelector('.holdings-card-grid')!;
    const cs = getComputedStyle(g);
    const cards = [...g.querySelectorAll('.wb-card')].slice(0,8).map(c => ({
      cls: (c as HTMLElement).className,
      gridColumn: getComputedStyle(c).gridColumn,
      inlineGC: (c as HTMLElement).style.gridColumn,
      width: c.getBoundingClientRect().width.toFixed(1),
      left: c.getBoundingClientRect().left.toFixed(1),
    }));
    // 找出所有 <style> 標籤裡有 holdings-card-grid 的規則
    const styleTexts: string[] = [];
    document.querySelectorAll('style').forEach((s, i) => {
      const t = s.textContent || '';
      if (t.includes('holdings-card-grid')) {
        styleTexts.push(`STYLE[${i}] (len=${t.length}):\n${t.slice(0, 1500)}`);
      }
    });
    return {
      gridTemplateColumns: cs.gridTemplateColumns,
      inlineStyle: g.getAttribute('style'),
      width: g.getBoundingClientRect().width.toFixed(1),
      viewport: window.innerWidth,
      cards,
      styleTexts,
    };
  });
  console.log('=== GRID INFO ===');
  console.log(JSON.stringify(info, null, 2));
});
