import { test, expect, type Page } from '@playwright/test';

/**
 * Live document.head metadata guard for the public funnel.
 * Asserts the retired promises never reach search snippets / share previews.
 */
const BANNED = ['T+7', '下週出手', '保證', '目標價'];

const ROUTES = [
  '/',
  '/experts',
  '/pricing',
  '/expert/sharkgu',
  '/expert/master-zhou',
  '/expert/master-brian',
  '/expert/bono',
  '/expert/yenkai',
];

async function headMeta(page: Page) {
  return page.evaluate(() => {
    const get = (sel: string) =>
      document.head.querySelector<HTMLMetaElement>(sel)?.content ?? '';
    return {
      title: document.title,
      description: get('meta[name="description"]'),
      ogTitle: get('meta[property="og:title"]'),
      ogDescription: get('meta[property="og:description"]'),
    };
  });
}

for (const route of ROUTES) {
  test(`document.head metadata is clean on ${route}`, async ({ page }) => {
    const resp = await page.goto(route, { waitUntil: 'domcontentloaded' });
    expect(resp?.status(), `${route} status`).toBeLessThan(400);
    await page.waitForTimeout(1200);

    const meta = await headMeta(page);
    const blob = [meta.title, meta.description, meta.ogTitle, meta.ogDescription].join(' | ');
    expect(meta.title.length, `${route} has a title`).toBeGreaterThan(0);
    expect(meta.description.length, `${route} has a description`).toBeGreaterThan(0);
    for (const term of BANNED) {
      expect(blob, `${route} head contains ${term}`).not.toContain(term);
    }
  });
}

test('home description matches the published cadence promise', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const meta = await headMeta(page);
  expect(meta.description).toContain('每週操作復盤');
  expect(meta.ogDescription).toContain('每週操作復盤');
  expect(meta.description).toContain('即時策略訊號');
});
