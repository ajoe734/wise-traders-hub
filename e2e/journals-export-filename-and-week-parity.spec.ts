/**
 * Regression: filename & week-header parity for the weekly journal export.
 *
 * Asserts:
 *   1. Every exported mentor file is named after that mentor's `slug`
 *      (single → `legendflow-journal-<slug>-...md`; multi → `<slug>.md`
 *      entries inside the zip, one per mentor, no cross-mixing).
 *   2. The `- 週別：...` header inside every generated Markdown file
 *      matches the exact week-range string shown to the user on the
 *      export screen (`{startLabel} ~ {endLabel}`) — so the download
 *      never drifts from what the operator saw before clicking Export.
 */
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

const HARNESS_URL = '/e2e/journals-export-harness';
const SUFFIX = 'published';
const MENTOR_A_SLUG = 'master-zhou';
const MENTOR_B_SLUG = 'wendy-us';


async function readWeekDisplay(page: import('@playwright/test').Page) {
  const txt = (await page.getByTestId('je-week-display').textContent()) ?? '';
  const w = txt.trim();
  expect(w).toMatch(/^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/);
  return w;
}

async function readSlugMap(page: import('@playwright/test').Page) {
  const raw = (await page.getByTestId('je-slug-map').textContent()) ?? '{}';
  const map = JSON.parse(raw) as Record<string, string>;
  expect(Object.keys(map).length).toBeGreaterThan(0);
  return map;
}

test.describe('Journals export — filename + week header parity', () => {
  test('single: filename embeds the mentor slug and MD week matches on-screen label', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByTestId('je-status')).toHaveText('idle');

    const weekDisplay = await readWeekDisplay(page);
    const slugMap = await readSlugMap(page);
    const expectedSlug = slugMap['expert-a'];
    expect(expectedSlug).toBeTruthy();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('je-export-single').click(),
    ]);

    const filename = download.suggestedFilename();
    // filename shape: legendflow-journal-<slug>-YYYY-MM-DD_to_YYYY-MM-DD_<suffix>.md
    const m = filename.match(
      /^legendflow-journal-(.+?)-(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})_([a-z]+)\.md$/,
    );
    expect(m, `filename should match slug pattern: ${filename}`).not.toBeNull();
    const [, slugInName, startInName, endInName, suffixInName] = m!;
    expect(slugInName).toBe(expectedSlug);
    expect(suffixInName).toBe(SUFFIX);
    expect(`${startInName} ~ ${endInName}`).toBe(weekDisplay);

    // Read MD content and assert week header parity with UI
    const fs = await import('node:fs/promises');
    const path = await download.path();
    expect(path).toBeTruthy();
    const md = await fs.readFile(path!, 'utf8');

    expect(md).toContain(`- 週別：${weekDisplay}`);
    expect(md).toContain(`- Slug：\`${expectedSlug}\``);
    // week header must appear exactly once (no drift / duplicate)
    const weekHits = md.match(/- 週別：/g) ?? [];
    expect(weekHits.length).toBe(1);
  });

  test('multi: zip entries are named <slug>.md per mentor and each MD week matches on-screen label', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByTestId('je-status')).toHaveText('idle');

    const weekDisplay = await readWeekDisplay(page);
    // The multi-export button only exports 老周 + Wendy; other harness mentors are not included.
    const expectedSlugs = [MENTOR_A_SLUG, MENTOR_B_SLUG].sort();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('je-export-multi').click(),
    ]);

    const filename = download.suggestedFilename();
    const zipMatch = filename.match(
      /^legendflow-journals-(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})_([a-z]+)\.zip$/,
    );
    expect(zipMatch, `zip filename should follow pattern: ${filename}`).not.toBeNull();
    const [, startInName, endInName, suffixInName] = zipMatch!;
    expect(suffixInName).toBe(SUFFIX);
    expect(`${startInName} ~ ${endInName}`).toBe(weekDisplay);

    const fs = await import('node:fs/promises');
    const path = await download.path();
    expect(path).toBeTruthy();
    const buf = await fs.readFile(path!);
    const zip = await JSZip.loadAsync(buf);

    const entryNames = Object.keys(zip.files).sort();
    // Every entry must be `<slug>.md`, and the set must exactly equal the two mentors exported by the multi button
    expect(entryNames).toEqual(expectedSlugs.map((s) => `${s}.md`).sort());
    for (const name of entryNames) {
      expect(name).toMatch(/^[a-z0-9][a-z0-9-_]*\.md$/i);
    }


    // Each MD must carry the same week header the user saw on screen,
    // and the H1 must belong to the mentor whose slug names the file.
    for (const slug of expectedSlugs) {
      const md = await zip.files[`${slug}.md`].async('string');
      expect(md, `${slug}.md missing week header parity`).toContain(`- 週別：${weekDisplay}`);
      expect(md).toContain(`- Slug：\`${slug}\``);
      const weekHits = md.match(/- 週別：/g) ?? [];
      expect(weekHits.length).toBe(1);
      // H1 sanity: exactly one, ends with "週記"
      const h1s = md.match(/^# .+週記$/gm) ?? [];
      expect(h1s.length).toBe(1);
      // No other mentor's slug should appear inside this file's slug header
      for (const other of expectedSlugs) {
        if (other === slug) continue;
        expect(md).not.toContain(`- Slug：\`${other}\``);
      }
    }
  });
});
