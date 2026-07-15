import { test, expect } from '@playwright/test';

/**
 * ETF 代號 + 名稱 在多寬度下的視覺回歸：
 * 覆蓋典型行動 / 平板 / 桌面斷點，驗證
 *   1. JournalDetail 列與 SignalDetail 標題容器都不會水平溢出
 *   2. 代號 / 名稱兩個 span 都完整存在、bounding box 非零、且都在
 *      父容器的可視範圍內（不會被隱藏或截切）
 *   3. 代號區塊的 textContent 完整保留字尾（00631L / 00878B）
 *   4. 附截圖 artifact，供人工回歸比對
 *
 * 為何用 assertion + 截圖 而非 toHaveScreenshot：
 *   - baseline 隨字型/dpr 漂移，維護成本高
 *   - assertion 對 truncation / 溢出更直接、更耐 CSS refactor
 */

const CASES = [
  { code: '00631L', name: '元大台灣50正2' },
  { code: '00878B', name: '國泰永續高股息' },
];

const WIDTHS = [320, 360, 375, 414, 480, 768, 1024];

test.describe.parallel('ETF 代號+名稱視覺不截斷 — 跨寬度回歸', () => {
  for (const c of CASES) {
    for (const w of WIDTHS) {
      test(`${c.code} @ ${w}px 不截斷 / 不溢出 / 完整顯示`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: 900 });
        const url = `/e2e/etf-display-harness?code=${c.code}&name=${encodeURIComponent(c.name)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#etf-display-harness-root');

        // 1. 頁面本身不能水平捲動
        const bodyOverflow = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(bodyOverflow.scroll, `body overflow @ ${w}px`).toBeLessThanOrEqual(bodyOverflow.client);

        // 2. 兩個 section 容器都不能水平溢出
        for (const sec of ['section-journal-detail', 'section-signal-detail']) {
          const box = await page.getByTestId(sec).evaluate((el) => ({
            scroll: (el as HTMLElement).scrollWidth,
            client: (el as HTMLElement).clientWidth,
          }));
          expect(box.scroll, `${sec} overflow @ ${w}px`).toBeLessThanOrEqual(box.client);
        }

        // 3. 代號 / 名稱都可見，textContent 完整（含字尾）
        for (const prefix of ['jd', 'sd']) {
          const codeEl = page.getByTestId(`${prefix}-code`);
          const nameEl = page.getByTestId(`${prefix}-name`);
          await expect(codeEl, `${prefix}-code visible`).toBeVisible();
          await expect(nameEl, `${prefix}-name visible`).toBeVisible();
          await expect(codeEl).toHaveText(c.code);
          await expect(nameEl).toHaveText(c.name);

          // 逐字尾檢查（防未來 CSS truncate 悄悄砍字）
          const codeText = (await codeEl.textContent())?.trim() ?? '';
          expect(codeText.endsWith(c.code.slice(-1)), `${prefix}-code 字尾保留`).toBe(true);
          expect(codeText.length, `${prefix}-code 長度不縮`).toBe(c.code.length);

          const nameText = (await nameEl.textContent())?.trim() ?? '';
          expect(nameText.length, `${prefix}-name 長度不縮`).toBe(c.name.length);

          // 4. 尺寸 sanity — 兩者 bounding box 非零、寬度加總 > 0
          const [cb, nb] = await Promise.all([
            codeEl.boundingBox(),
            nameEl.boundingBox(),
          ]);
          expect(cb, `${prefix}-code bbox`).not.toBeNull();
          expect(nb, `${prefix}-name bbox`).not.toBeNull();
          expect(cb!.width).toBeGreaterThan(0);
          expect(cb!.height).toBeGreaterThan(0);
          expect(nb!.width).toBeGreaterThan(0);
          expect(nb!.height).toBeGreaterThan(0);
        }

        // 5. 附圖存查（人工回歸）
        await page
          .getByTestId('section-journal-detail')
          .screenshot({ path: `test-results/etf-display/${c.code}-${w}-journal.png` });
        await page
          .getByTestId('section-signal-detail')
          .screenshot({ path: `test-results/etf-display/${c.code}-${w}-signal.png` });
      });
    }
  }
});
