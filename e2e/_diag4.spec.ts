import { test } from '@playwright/test';
test('rules2', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('checkup-demo-mode', '1'); } catch {} });
  await page.goto('/free-checkup', { waitUntil: 'networkidle' });
  await page.waitForSelector('.holdings-card-grid', { timeout: 15000 });
  const client = await page.context().newCDPSession(page);
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  const { root } = await client.send('DOM.getDocument');
  const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.holdings-card-grid' });
  const m = await client.send('CSS.getMatchedStylesForNode', { nodeId });
  const all = m.matchedCSSRules?.filter((r: any) =>
    r.rule.style?.cssText?.includes('grid-template-columns') ||
    r.rule.style?.cssProperties?.some((p: any) => p.name === 'grid-template-columns')
  ).map((r: any) => ({
    media: r.rule.media?.map((mq: any) => mq.text),
    sel: r.rule.selectorList.text,
    css: r.rule.style.cssText,
    src: r.rule.origin,
  }));
  console.log('RULES2:', JSON.stringify(all, null, 2));
  console.log('INLINE:', JSON.stringify(m.inlineStyle?.cssText));
});
