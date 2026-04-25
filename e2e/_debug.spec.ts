import { test } from '@playwright/test';

test('dump matched rules', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('checkup-demo-mode','1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid .wb-card', { timeout: 15000 });
  await page.waitForTimeout(300);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.holdings-card-grid' });
  const matched = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });

  const rules = (matched.matchedCSSRules || []).map((r: any) => ({
    selector: r.rule.selectorList.text,
    media: r.rule.media?.map((m: any) => m.text),
    cssText: r.rule.style.cssText,
  }));
  console.log('=== MATCHED RULES for .holdings-card-grid ===');
  console.log(JSON.stringify(rules, null, 2));

  // Print any rule mentioning grid-template-columns
  console.log('\n=== ALL stylesheets containing 1fr ===');
  const sheets = await cdp.send('CSS.getAllStyleSheets' as any).catch(() => null);
  // fallback: dump full <style> contents
  const allStyles = await page.evaluate(() => {
    const out: { idx: number; len: number; has1fr: boolean; snippet: string }[] = [];
    document.querySelectorAll('style').forEach((s, i) => {
      const t = s.textContent || '';
      if (t.includes('holdings-card-grid')) {
        out.push({ idx: i, len: t.length, has1fr: t.includes('1fr !important'), snippet: t });
      }
    });
    return out;
  });
  for (const s of allStyles) {
    console.log(`\n--- STYLE[${s.idx}] len=${s.len} has1fr=${s.has1fr} ---`);
    console.log(s.snippet);
  }
});
