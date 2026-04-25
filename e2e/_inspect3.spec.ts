import { test } from '@playwright/test';
test('rules', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('checkup-demo-mode', '1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid', { timeout: 15000 });
  // Use CDP to get matched CSS rules
  const client = await page.context().newCDPSession(page);
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  const { root } = await client.send('DOM.getDocument');
  const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.holdings-card-grid' });
  const matched = await client.send('CSS.getMatchedStylesForNode', { nodeId });
  const interesting = matched.matchedCSSRules?.filter(r =>
    r.rule.style?.cssText?.includes('grid-template-columns')
  ).map(r => ({
    media: r.rule.media?.map(m => m.text),
    sel: r.rule.selectorList.text,
    css: r.rule.style.cssText,
  }));
  console.log('RULES:', JSON.stringify(interesting, null, 2));
});
