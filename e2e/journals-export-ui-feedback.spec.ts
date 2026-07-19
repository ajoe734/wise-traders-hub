import { test, expect, type Page, type Download } from '@playwright/test';
import JSZip from 'jszip';

/**
 * 週記匯出 UI 回饋 E2E：
 *   - 空資料匯出 → 顯示 sonner warning toast + status 標記，不觸發 download
 *   - 打開確認對話框 → 按「取消」→ dialog 關閉、confirm=cancelled、無 download
 *   - 打開確認對話框 → 按「確認下載」→ 觸發下載
 *   - 注入失敗 x1 → 出現 je-md-error 橫幅（帶 detail + 重試按鈕），點 je-md-retry 後成功下載
 *   - 注入失敗 x2 → 第一次重試仍失敗，第二次重試才成功（重試按鈕在失敗狀態下持續可用）
 *   - 全部混合情境跑完後最終再匯出一次，週別行仍嚴格位於 index 2 且無跨情境污染
 */

const URL_PATH = '/e2e/journals-export-ui-harness';
const RANGE = { start: '2026-07-13', end: '2026-07-19' };
const WEEK_RE = /^-\s*週別\s*[：:]\s*(\d{4}-\d{2}-\d{2})\s*[~〜～]\s*(\d{4}-\d{2}-\d{2})\s*$/;

async function goto(page: Page) {
  await page.goto(URL_PATH);
  await expect(page.getByTestId('je-ui-status')).toHaveText('idle');
}

async function readDownload(dl: Download) {
  const p = await dl.path();
  expect(p).toBeTruthy();
  const fs = await import('node:fs/promises');
  return { filename: dl.suggestedFilename(), buf: await fs.readFile(p!) };
}

async function extractMdFiles(filename: string, buf: Buffer): Promise<Record<string, string>> {
  if (filename.endsWith('.md')) return { [filename]: buf.toString('utf8') };
  if (filename.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(buf);
    const out: Record<string, string> = {};
    for (const n of Object.keys(zip.files)) {
      if (!zip.files[n].dir && n.endsWith('.md')) out[n] = await zip.files[n].async('string');
    }
    return out;
  }
  throw new Error(`未預期檔名：${filename}`);
}

function normalizeLines(md: string) {
  return md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function assertWeekLineIntegrity(files: Record<string, string>, ctx: string) {
  const names = Object.keys(files);
  expect(names.length, `[${ctx}] 至少 1 份檔案`).toBeGreaterThanOrEqual(1);
  for (const [name, md] of Object.entries(files)) {
    const lines = normalizeLines(md);
    const m = lines[2]?.match(WEEK_RE);
    expect(m, `[${ctx}] ${name} 週別行必須位於 index 2；lines[2]=${JSON.stringify(lines[2])}`).not.toBeNull();
    expect(m![1], `[${ctx}] ${name} start`).toBe(RANGE.start);
    expect(m![2], `[${ctx}] ${name} end`).toBe(RANGE.end);
    // 全檔僅一行帶「週別：」，避免污染
    const hits = lines.filter((l) => /週別\s*[：:]/.test(l));
    expect(hits.length, `[${ctx}] ${name} 全檔僅能一行含「週別：」`).toBe(1);
  }
}

async function expectNoDownload(page: Page, action: () => Promise<void> | void, ms = 800) {
  let triggered = false;
  const off = () => page.off('download', handler);
  const handler = () => { triggered = true; };
  page.on('download', handler);
  try {
    await action();
    await page.waitForTimeout(ms);
  } finally {
    off();
  }
  expect(triggered, '此操作不應觸發下載').toBe(false);
}

test.describe('Journals export — UI 回饋（空資料 / 取消 / 重試）', () => {
  test('空資料匯出：顯示 warning toast，不觸發下載，status=empty:*', async ({ page }) => {
    await goto(page);
    await expectNoDownload(page, async () => {
      await page.getByTestId('je-ui-export-empty').click();
    });
    // sonner 全域 toast：目前條件下沒有可匯出的週記
    await expect(page.getByText('目前條件下沒有可匯出的週記', { exact: false })).toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId('je-ui-status')).toHaveText('empty:empty');
    // 沒有錯誤橫幅
    await expect(page.getByTestId('je-md-error')).toHaveCount(0);
  });

  test('確認對話框：按取消 → 關閉且不觸發下載，狀態標記 cancelled', async ({ page }) => {
    await goto(page);
    await page.getByTestId('je-ui-open-confirm').click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByTestId('je-ui-confirm-week')).toContainText(`${RANGE.start} ~ ${RANGE.end}`);

    await expectNoDownload(page, async () => {
      await page.getByTestId('je-ui-confirm-cancel').click();
    });
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByTestId('je-ui-confirm-result')).toHaveText('confirm=cancelled');
    // 取消不應建立錯誤橫幅
    await expect(page.getByTestId('je-md-error')).toHaveCount(0);
    // 取消不應留下 last filename
    await expect(page.getByTestId('je-ui-last-filename')).toHaveText('last=');
  });

  test('確認對話框：按確認下載 → 觸發下載且週別行位於 index 2', async ({ page }) => {
    await goto(page);
    await page.getByTestId('je-ui-open-confirm').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('je-ui-confirm-download').click(),
    ]);
    const { filename, buf } = await readDownload(dl);
    const files = await extractMdFiles(filename, buf);
    assertWeekLineIntegrity(files, 'confirm-download');
    await expect(page.getByTestId('je-ui-confirm-result')).toHaveText('confirm=downloaded');
    await expect(page.getByTestId('je-ui-status')).toContainText('success:confirm:');
  });

  test('注入失敗 x1 → 顯示錯誤橫幅（含 detail + retry），點重試後成功下載', async ({ page }) => {
    await goto(page);
    await page.getByTestId('je-ui-arm-fail-1').click();
    await expect(page.getByTestId('je-ui-fail-next')).toHaveText('failNextN=1');

    // 首次匯出：不觸發下載，而是 fail
    await expectNoDownload(page, async () => {
      await page.getByTestId('je-ui-export-flaky').click();
    });
    const banner = page.getByTestId('je-md-error');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-error-source', 'unknown');
    await expect(page.getByTestId('je-md-error-detail')).toContainText('Injected failure');
    await expect(page.getByTestId('je-md-retry')).toBeEnabled();
    await expect(page.getByTestId('je-ui-status')).toContainText('fail:flaky:');

    // 重試 → 這次 failNextN=0，會成功
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('je-md-retry').click(),
    ]);
    const { filename, buf } = await readDownload(dl);
    const files = await extractMdFiles(filename, buf);
    assertWeekLineIntegrity(files, 'retry-success');

    // 成功後：failure 應被 setFailure(null) 清掉
    await expect(page.getByTestId('je-md-error')).toHaveCount(0);
    await expect(page.getByTestId('je-ui-status')).toContainText('success:retry:');
  });

  test('注入失敗 x2 → 第一次重試仍失敗、第二次重試才成功', async ({ page }) => {
    await goto(page);
    await page.getByTestId('je-ui-arm-fail-2').click();
    await expect(page.getByTestId('je-ui-fail-next')).toHaveText('failNextN=2');

    // 首次：fail (剩 1)
    await expectNoDownload(page, async () => {
      await page.getByTestId('je-ui-export-flaky').click();
    });
    await expect(page.getByTestId('je-md-error')).toBeVisible();
    await expect(page.getByTestId('je-ui-fail-next')).toHaveText('failNextN=1');

    // 第一次重試：仍 fail (剩 0)
    await expectNoDownload(page, async () => {
      await page.getByTestId('je-md-retry').click();
    });
    await expect(page.getByTestId('je-md-error')).toBeVisible();
    await expect(page.getByTestId('je-md-retry')).toBeEnabled();
    await expect(page.getByTestId('je-ui-fail-next')).toHaveText('failNextN=0');

    // 第二次重試：成功
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('je-md-retry').click(),
    ]);
    const { filename, buf } = await readDownload(dl);
    const files = await extractMdFiles(filename, buf);
    assertWeekLineIntegrity(files, 'double-retry-success');
    await expect(page.getByTestId('je-md-error')).toHaveCount(0);
  });

  test('混合情境（空→取消→失敗→重試→成功）跑完後最終匯出週別行仍固定 index 2 且無污染', async ({ page }) => {
    await goto(page);
    // 1. 空
    await expectNoDownload(page, async () => { await page.getByTestId('je-ui-export-empty').click(); });
    // 2. 開對話框 → 取消
    await page.getByTestId('je-ui-open-confirm').click();
    await page.getByTestId('je-ui-confirm-cancel').click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    // 3. 注入失敗 x1 → 觸發失敗
    await page.getByTestId('je-ui-arm-fail-1').click();
    await expectNoDownload(page, async () => { await page.getByTestId('je-ui-export-flaky').click(); });
    await expect(page.getByTestId('je-md-error')).toBeVisible();
    // 4. 點重試 → 成功
    const [dlRetry] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('je-md-retry').click(),
    ]);
    const r1 = await readDownload(dlRetry);
    assertWeekLineIntegrity(await extractMdFiles(r1.filename, r1.buf), 'mixed-retry');

    // 5. 最終再匯一次 (ok)
    const [dlFinal] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('je-ui-export-ok').click(),
    ]);
    const r2 = await readDownload(dlFinal);
    const finalFiles = await extractMdFiles(r2.filename, r2.buf);
    assertWeekLineIntegrity(finalFiles, 'mixed-final');

    // 污染守門：最終檔案內僅能有自家 token，不得混入其他 mentor token
    const namesOfFiles = Object.keys(finalFiles);
    expect(namesOfFiles.length, '最終應為 A+B 兩位老師').toBe(2);
    const aFile = namesOfFiles.find((n) => finalFiles[n].includes('UI-A-token'))!;
    const bFile = namesOfFiles.find((n) => finalFiles[n].includes('UI-B-token'))!;
    expect(aFile).toBeTruthy();
    expect(bFile).toBeTruthy();
    expect(aFile).not.toBe(bFile);
    expect(finalFiles[aFile].includes('UI-B-token'), 'A 檔不得含 B token').toBe(false);
    expect(finalFiles[bFile].includes('UI-A-token'), 'B 檔不得含 A token').toBe(false);
    // 檔名唯一
    expect(new Set(namesOfFiles).size).toBe(namesOfFiles.length);
    // history 應累積：retry + ok = 2 份 filename
    const historyText = await page.getByTestId('je-ui-download-history').textContent();
    expect(historyText, historyText ?? '').toContain(r1.filename);
    expect(historyText).toContain(r2.filename);
  });

  test('全部情境串跑不得產生 console/page error', async ({ page }) => {
    const errors: string[] = [];
    const IGNORE_RE = /(traffic-ingest|Access-Control-Allow-Origin|ERR_FAILED|Failed to load resource)/i;
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (IGNORE_RE.test(t)) return;
      errors.push(`console: ${t}`);
    });
    await goto(page);
    await expectNoDownload(page, async () => { await page.getByTestId('je-ui-export-empty').click(); });
    await page.getByTestId('je-ui-open-confirm').click();
    await page.getByTestId('je-ui-confirm-cancel').click();
    await page.getByTestId('je-ui-arm-fail-1').click();
    await expectNoDownload(page, async () => { await page.getByTestId('je-ui-export-flaky').click(); });
    await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('je-md-retry').click(),
    ]);
    await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('je-ui-export-ok').click(),
    ]);
    expect(errors, `不得產生錯誤：\n${errors.join('\n')}`).toEqual([]);
  });
});
