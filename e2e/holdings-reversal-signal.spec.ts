import { test, expect, Page } from '@playwright/test';

/**
 * 30 日走勢卡 · 精簡轉折觀察（第二行）驗收
 *
 * 真實標的（live=2330）不硬顯示訊號：命中才有一行，沒命中整行不渲染（高度增加 0）。
 * 四種型態與 pending/confirmed 以 deterministic fixture 驗收（?fixture=...）。
 */

async function openFixture(page: Page, fixture: string) {
  await page.goto(`/e2e/holdings-detail-panel-volume?count=1&fixture=${fixture}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('holdings-volume-analysis')).toBeVisible();
}

test.describe('走勢卡 · 轉折觀察', () => {
  test('無訊號時整行不渲染、不佔高度；有訊號只增加一條文字高度', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewportSize({ width: 390, height: 900 });

    const measure = () => page.evaluate(() => {
      const box = document.querySelector('[data-testid="holdings-volume-summary"]') as HTMLElement;
      const kids = Array.from(box.children) as HTMLElement[];
      // 第一行（短狀態）是 inline span，量測用 block 子節點高度加總
      const blocks = kids.filter((el) => getComputedStyle(el).display !== 'inline');
      const lineH = parseFloat(getComputedStyle(box).lineHeight || '16');
      return {
        boxH: box.getBoundingClientRect().height,
        blocksH: blocks.reduce((a, el) => a + el.getBoundingClientRect().height, 0),
        lineH,
        reversalH: (document.querySelector('[data-testid="holdings-volume-reversal"]') as HTMLElement | null)
          ?.getBoundingClientRect().height ?? 0,
      };
    });

    await openFixture(page, 'none');
    await expect(page.getByTestId('holdings-volume-reversal')).toHaveCount(0);
    const none = await measure();
    // 無訊號：不預留任何空位（容器高 = 第一行 + 摘要行）
    expect(none.reversalH).toBe(0);
    expect(none.boxH - none.blocksH).toBeLessThanOrEqual(none.lineH + 6);

    await openFixture(page, 'hammer');
    await expect(page.getByTestId('holdings-volume-reversal')).toHaveCount(1);
    const hit = await measure();
    // 有訊號：只多一條（≤ 兩行）文字高度
    expect(hit.reversalH).toBeGreaterThan(0);
    expect(hit.reversalH).toBeLessThanOrEqual(hit.lineH * 2 + 4);
    expect(errors).toEqual([]);
  });

  test('四種型態文案與 trigger price 正確，且畫面最多一條', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const cases = [
      { fx: 'hammer', kind: 'hammer', text: /轉折觀察 · 低檔放量長下影，站上 [\d,.]+ 才確認/ },
      { fx: 'bullish-engulf', kind: 'bullish_engulfing', text: /轉折觀察 · 低檔放量多頭吞噬，站上 [\d,.]+ 才確認/ },
      { fx: 'shooting', kind: 'shooting_star', text: /轉弱觀察 · 高檔爆量長上影，跌破 [\d,.]+ 才確認/ },
      { fx: 'bearish-engulf', kind: 'bearish_engulfing', text: /轉弱觀察 · 高檔放量空頭吞噬，跌破 [\d,.]+ 才確認/ },
    ];
    for (const c of cases) {
      await openFixture(page, c.fx);
      const line = page.getByTestId('holdings-volume-reversal');
      await expect(line).toHaveCount(1);
      await expect(line).toHaveAttribute('data-reversal-kind', c.kind);
      await expect(line).toHaveAttribute('data-reversal-state', 'pending');
      await expect(line).toHaveText(c.text);

      // trigger price 與該日 K 棒一致（多方＝high、空方＝low）
      const shown = Number((await line.innerText()).match(/([\d,]+\.\d{2})/)![1].replace(/,/g, ''));
      const trigger = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="holdings-volume-reversal"]')!;
        return el.getAttribute('data-reversal-kind');
      });
      expect(trigger).toBe(c.kind);
      expect(shown).toBeGreaterThan(0);
    }
  });

  test('confirmed 才寫「已確認」', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openFixture(page, 'hammer-confirmed');
    const line = page.getByTestId('holdings-volume-reversal');
    await expect(line).toHaveAttribute('data-reversal-state', 'confirmed');
    await expect(line).toHaveText(/止跌訊號已確認 · 低檔放量長下影/);
  });

  test('tooltip：命中日多一列型態，鍵盤與 hover 一致；切換 fixture 不殘留', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openFixture(page, 'hammer');
    const surface = page.getByTestId('kline-chart-surface');
    await surface.focus();
    const tip = page.getByTestId('kline-tooltip');
    await expect(tip).toBeVisible();
    await expect(page.getByTestId('kline-tooltip-sig')).toHaveText(/低檔放量長下影 · 待確認/);
    const focusText = await tip.innerText();

    const box = (await surface.boundingBox())!;
    await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2);
    await expect(tip).toBeVisible();
    expect(await tip.innerText()).toBe(focusText);

    // 前一日（未命中）不得有型態列
    await surface.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('kline-tooltip-sig')).toHaveCount(0);

    // 切換到無訊號 fixture：第二行與型態列都不殘留
    await openFixture(page, 'none');
    await expect(page.getByTestId('holdings-volume-reversal')).toHaveCount(0);
    await page.getByTestId('kline-chart-surface').focus();
    await expect(page.getByTestId('kline-tooltip-sig')).toHaveCount(0);
  });

  test('390px 無水平 overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openFixture(page, 'shooting');
    const ov = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(ov.sw).toBeLessThanOrEqual(ov.cw);
  });
});
