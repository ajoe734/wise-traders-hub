/**
 * Extended parity matrix for the weekly journal export.
 *
 * Verifies filename ↔ slug ↔ on-screen week-label parity across:
 *   - multiple week ranges (harness ?start=&end=)
 *   - repeated downloads on the same render (stability)
 *   - full remount / hard reload (no drift between renders)
 *   - both single-mentor (.md) and multi-mentor (.zip) paths
 *
 * Complements journals-export-filename-and-week-parity.spec.ts which
 * covers a single canonical range once.
 */
import { test, expect, Page } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

const HARNESS = '/e2e/journals-export-harness';
const SUFFIX = 'published';
const MENTOR_A_SLUG = 'master-zhou';
const MENTOR_B_SLUG = 'wendy-us';
// The multi-export button only exports these two mentors; other harness mentors are separate buttons.
const MULTI_EXPORT_SLUGS = [MENTOR_A_SLUG, MENTOR_B_SLUG];

const RANGES = [

  { start: '2026-07-13', end: '2026-07-19' }, // canonical
  { start: '2026-01-05', end: '2026-01-11' }, // year boundary-ish
  { start: '2025-12-29', end: '2026-01-04' }, // cross-year week
  { start: '2026-02-23', end: '2026-03-01' }, // cross-month week
];

async function open(page: Page, r: { start: string; end: string }) {
  await page.goto(`${HARNESS}?start=${r.start}&end=${r.end}`);
  await expect(page.getByTestId('je-status')).toHaveText('idle');
  const weekDisplay = (await page.getByTestId('je-week-display').textContent())?.trim() ?? '';
  expect(weekDisplay).toBe(`${r.start} ~ ${r.end}`);
  const slugMap = JSON.parse((await page.getByTestId('je-slug-map').textContent()) ?? '{}') as Record<string, string>;
  return { weekDisplay, slugMap };
}

async function downloadOnce(page: Page, testid: 'je-export-single' | 'je-export-multi') {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(testid).click(),
  ]);
  const filename = dl.suggestedFilename();
  const path = await dl.path();
  expect(path).toBeTruthy();
  const buf = await readFile(path!);
  return { filename, buf };
}

function assertSingleFilename(filename: string, expectedSlug: string, r: { start: string; end: string }) {
  const m = filename.match(
    /^legendflow-journal-(.+?)-(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})_([a-z]+)\.md$/,
  );
  expect(m, `single filename shape: ${filename}`).not.toBeNull();
  const [, slugInName, startInName, endInName, suffixInName] = m!;
  expect(slugInName).toBe(expectedSlug);
  expect(startInName).toBe(r.start);
  expect(endInName).toBe(r.end);
  expect(suffixInName).toBe(SUFFIX);
}

function assertZipFilename(filename: string, r: { start: string; end: string }) {
  const m = filename.match(
    /^legendflow-journals-(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})_([a-z]+)\.zip$/,
  );
  expect(m, `zip filename shape: ${filename}`).not.toBeNull();
  const [, s, e, suf] = m!;
  expect(s).toBe(r.start);
  expect(e).toBe(r.end);
  expect(suf).toBe(SUFFIX);
}

test.describe('Journals export — filename × slug × week parity matrix', () => {
  for (const r of RANGES) {
    test(`single: ${r.start}~${r.end} — filename slug + week parity + repeat stability`, async ({ page }) => {
      const { weekDisplay, slugMap } = await open(page, r);
      const expectedSlug = slugMap['expert-a'];
      expect(expectedSlug).toBeTruthy();

      const seen: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { filename, buf } = await downloadOnce(page, 'je-export-single');
        assertSingleFilename(filename, expectedSlug, r);
        seen.push(filename);
        const md = buf.toString('utf8');
        expect(md).toContain(`- 週別：${weekDisplay}`);
        expect(md).toContain(`- Slug：\`${expectedSlug}\``);
        expect((md.match(/- 週別：/g) ?? []).length).toBe(1);
      }
      // deterministic across repeats on the same render
      expect(new Set(seen).size).toBe(1);
    });

    test(`multi: ${r.start}~${r.end} — zip entries per-slug + week parity + reload stability`, async ({ page }) => {
      const first = await open(page, r);
      const expectedSlugs = [...MULTI_EXPORT_SLUGS].sort();

      const firstDl = await downloadOnce(page, 'je-export-multi');

      assertZipFilename(firstDl.filename, r);

      // Full remount to catch any drift between renders.
      await page.reload();
      await expect(page.getByTestId('je-status')).toHaveText('idle');
      const secondDl = await downloadOnce(page, 'je-export-multi');

      expect(secondDl.filename).toBe(firstDl.filename);

      for (const dl of [firstDl, secondDl]) {
        const zip = await JSZip.loadAsync(dl.buf);
        const entryNames = Object.keys(zip.files).sort();
        expect(entryNames).toEqual(expectedSlugs.map((s) => `${s}.md`).sort());

        for (const slug of expectedSlugs) {
          const md = await zip.files[`${slug}.md`].async('string');
          expect(md, `${slug}.md week header`).toContain(`- 週別：${first.weekDisplay}`);
          expect(md).toContain(`- Slug：\`${slug}\``);
          expect((md.match(/- 週別：/g) ?? []).length).toBe(1);
          const h1s = md.match(/^# .+週記$/gm) ?? [];
          expect(h1s.length).toBe(1);
          for (const other of expectedSlugs) {
            if (other === slug) continue;
            expect(md).not.toContain(`- Slug：\`${other}\``);
          }
        }
      }
    });
  }

  test('mixed sequence on one render: single → multi → single stays parity-locked', async ({ page }) => {
    const r = RANGES[0];
    const { weekDisplay, slugMap } = await open(page, r);
    const expectedSlug = slugMap['expert-a'];
    const expectedSlugs = [...MULTI_EXPORT_SLUGS].sort();

    const s1 = await downloadOnce(page, 'je-export-single');

    assertSingleFilename(s1.filename, expectedSlug, r);

    const m1 = await downloadOnce(page, 'je-export-multi');
    assertZipFilename(m1.filename, r);
    const zip = await JSZip.loadAsync(m1.buf);
    expect(Object.keys(zip.files).sort()).toEqual(expectedSlugs.map((s) => `${s}.md`).sort());

    const s2 = await downloadOnce(page, 'je-export-single');
    expect(s2.filename).toBe(s1.filename);
    expect(s2.buf.toString('utf8')).toContain(`- 週別：${weekDisplay}`);
  });
});
