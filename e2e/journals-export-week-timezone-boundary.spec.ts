import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

/**
 * Timezone-boundary regression for weekly journal export.
 *
 * 匯出檔案的「週別」「檔名日期」與每則訊號的「時間：」欄位
 * 必須永遠採用 Asia/Taipei 曆日，不得受瀏覽器 timezone 影響。
 *
 * 涵蓋：
 *   - 4 種瀏覽器時區：UTC / America/Los_Angeles (-8) / Europe/London (+0/1)
 *     / Pacific/Kiritimati (+14) — 分別跨越 UTC 之前、UTC、UTC 之後與遠東。
 *   - 2 組 Taipei 週別：跨月 (2026-02-23~2026-03-01)、跨年 (2026-12-28~2027-01-03)。
 *   - multi 與 multi-mixed 兩顆按鈕 — zip 內每份 .md 的週別行必須完全一致。
 *   - 每則訊號的「時間：YYYY/MM/DD HH:mm」必須維持 Taipei 呈現。
 */

const HARNESS_URL = '/e2e/journals-export-harness';
const WEEK_LINE_RE = /^-\s*週別[：:]\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})\s*$/m;

// fixture published_at → 對應 Asia/Taipei 呈現（fmtTaipei）
// MENTOR_A_ROWS / MENTOR_B_ROW / MENTOR_C_ROWS 內的 published_at 皆為固定 UTC，
// Taipei = UTC+8，因此下列對應在任何瀏覽器 timezone 下都必須成立。
const TAIPEI_TIME_EXPECTATIONS: Array<{ probe: string }> = [
  { probe: '時間：2026/07/14 09:00' }, // 2026-07-14T01:00:00Z
  { probe: '時間：2026/07/15 10:00' }, // 2026-07-15T02:00:00Z
  { probe: '時間：2026/07/16 21:30' }, // 2026-07-16T13:30:00Z（Wendy）
  { probe: '時間：2026/07/17 09:00' }, // 2026-07-17T01:00:00Z（助教小陳）
];

const TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'Europe/London',
  'Pacific/Kiritimati',
];

const RANGES = [
  { start: '2026-02-23', end: '2026-03-01', label: '跨月' },
  { start: '2026-12-28', end: '2027-01-03', label: '跨年' },
];

async function downloadFrom(page: import('@playwright/test').Page, testId: string) {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(testId).click(),
  ]);
  const p = await dl.path();
  expect(p, `download for ${testId}`).toBeTruthy();
  const fs = await import('node:fs/promises');
  return { filename: dl.suggestedFilename(), buf: await fs.readFile(p!) };
}

async function readZip(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const out: Record<string, string> = {};
  for (const n of Object.keys(zip.files)) out[n] = await zip.files[n].async('string');
  return out;
}

for (const tz of TIMEZONES) {
  test.describe(`Journals export — timezone=${tz}`, () => {
    test.use({ timezoneId: tz });

    for (const r of RANGES) {
      test(`${r.label} (${r.start}~${r.end}) multi zip：週別/檔名/時間欄位保持 Taipei 曆日`, async ({ page }) => {
        await page.goto(`${HARNESS_URL}?start=${r.start}&end=${r.end}`);
        await expect(page.getByTestId('je-status')).toHaveText('idle');
        await expect(page.getByTestId('je-week-display')).toHaveText(`${r.start} ~ ${r.end}`);

        // 瀏覽器 timezone 確實被套用 → 保證 fmtTaipei 若不寫死偏移就會壞
        const browserTz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
        expect(browserTz, `瀏覽器 timezone 應為 ${tz}`).toBe(tz);

        const { filename, buf } = await downloadFrom(page, 'je-export-multi');
        // filename 內必須嵌入使用者提供的 Taipei 範圍，不含舊預設週或 UTC 位移後的日期
        expect(filename).toContain(`${r.start}_to_${r.end}`);
        expect(filename).not.toContain('2026-07-13');
        expect(filename).not.toContain('2026-07-19');

        const files = await readZip(buf);
        const names = Object.keys(files).sort();
        expect(names).toEqual(['master-zhou.md', 'wendy-us.md']);

        const weekLines: string[] = [];
        for (const n of names) {
          const md = files[n];
          const m = md.match(WEEK_LINE_RE);
          expect(m, `[${tz}/${n}] 週別行必須存在`).toBeTruthy();
          expect(m![1]).toBe(r.start);
          expect(m![2]).toBe(r.end);
          weekLines.push(m![0]);

          // 每則訊號的 Taipei 時間戳必須穩定（不隨 browser tz 漂移）
          for (const exp of TAIPEI_TIME_EXPECTATIONS.filter((x) => {
            if (n === 'master-zhou.md') return x.probe.includes('/07/14') || x.probe.includes('/07/15');
            if (n === 'wendy-us.md') return x.probe.includes('/07/16');
            return false;
          })) {
            expect(md, `[${tz}/${n}] 應包含 ${exp.probe}`).toContain(exp.probe);
          }
        }
        // 跨老師週別完全一致
        expect(new Set(weekLines).size, `[${tz}] 所有 mentor 檔的週別必須一致`).toBe(1);
      });

      test(`${r.label} multi-mixed zip：老周 + 助教小陳 週別一致且 Taipei 時間戳穩定`, async ({ page }) => {
        await page.goto(`${HARNESS_URL}?start=${r.start}&end=${r.end}`);
        await expect(page.getByTestId('je-status')).toHaveText('idle');

        const { filename, buf } = await downloadFrom(page, 'je-export-multi-mixed');
        expect(filename).toContain(`${r.start}_to_${r.end}`);

        const files = await readZip(buf);
        const names = Object.keys(files).sort();
        expect(names).toEqual(['assistant-chen.md', 'master-zhou.md']);

        const weekLines: string[] = [];
        for (const n of names) {
          const md = files[n];
          const m = md.match(WEEK_LINE_RE);
          expect(m, `[${tz}/${n}] 週別行必須存在`).toBeTruthy();
          expect(m![1]).toBe(r.start);
          expect(m![2]).toBe(r.end);
          weekLines.push(m![0]);
        }
        expect(new Set(weekLines).size).toBe(1);

        // 助教小陳的 2026-07-17T01:00:00Z 必須渲染為 Taipei 09:00，不受瀏覽器時區干擾
        expect(files['assistant-chen.md']).toContain('時間：2026/07/17 09:00');
        // 老周的兩則亦然
        expect(files['master-zhou.md']).toContain('時間：2026/07/14 09:00');
        expect(files['master-zhou.md']).toContain('時間：2026/07/15 10:00');
      });
    }

    test('single mentor：filename 與內文週別在極端 timezone 下維持 Taipei', async ({ page }) => {
      const { start, end } = RANGES[1]; // 跨年
      await page.goto(`${HARNESS_URL}?start=${start}&end=${end}`);
      await expect(page.getByTestId('je-status')).toHaveText('idle');

      const { filename, buf } = await downloadFrom(page, 'je-export-single');
      expect(filename).toBe(`legendflow-journal-master-zhou-${start}_to_${end}_published.md`);
      const md = buf.toString('utf8');
      const m = md.match(WEEK_LINE_RE);
      expect(m).toBeTruthy();
      expect(m![1]).toBe(start);
      expect(m![2]).toBe(end);
      expect(md).toContain('時間：2026/07/14 09:00');
      expect(md).toContain('時間：2026/07/15 10:00');
    });
  });
}
