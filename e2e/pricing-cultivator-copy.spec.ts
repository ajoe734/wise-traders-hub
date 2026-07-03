import { test, expect } from '@playwright/test';

/**
 * Pricing 頁 — 修煉派文案 + 心法展開 + 方案差異比較區塊
 *
 * 兩個斷點：desktop 1280 / mobile 390，避免文字在切換版型時被截斷。
 */

const CULTIVATOR_PAIN = '週末才有空，利用老師的心法決定下週出手';

test.describe('Pricing 修煉派文案與比較區塊', () => {
  test('desktop：修煉派 painPoint 顯示且不截斷；心法展開有 4 條學習重點', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' });

    // painPoint 文字存在（用引號包起來的完整字串）
    const painEl = page.getByText(`「${CULTIVATOR_PAIN}」`, { exact: true });
    await expect(painEl).toBeVisible();

    // 不能被截斷：scrollWidth <= clientWidth（不含省略號溢位）
    const clipped = await painEl.evaluate((el) => {
      const style = getComputedStyle(el);
      const overflow = style.textOverflow === 'ellipsis';
      const truncated = el.scrollWidth > el.clientWidth + 1;
      return { overflow, truncated };
    });
    expect(clipped.truncated).toBe(false);

    // 展開修煉派卡片的「看完整內容」——同時驗證 Radix Accordion
    // 有正確的 aria-expanded / aria-controls，並在展開後指向可見的 region。
    const cultivatorCard = page.locator('#cultivator-card');
    await expect(cultivatorCard).toBeVisible();
    const trigger = cultivatorCard.getByRole('button', { name: '看完整內容' });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const controlsId = await trigger.getAttribute('aria-controls');
    expect(controlsId, 'accordion trigger 必須有 aria-controls 指向內容 region').toBeTruthy();

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // aria-controls 指向的 region 展開後必須實際渲染於 DOM 且可見
    const region = page.locator(`#${controlsId}`);
    await expect(region).toBeVisible();

    const mindset = page.getByTestId('cultivator-mindset-points');
    await expect(mindset).toBeVisible();
    await expect(mindset).toContainText('心法決定下週出手');
    await expect(mindset.locator('li')).toHaveCount(4);
    await expect(mindset).toContainText('復盤');
    await expect(mindset).toContainText('框架');
  });


  test('desktop：方案差異比較區塊有完整 6 列且雙欄描述皆非空', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' });

    const table = page.getByTestId('pricing-comparison-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText('分析師即時訂閱');
    await expect(table).toContainText('實戰導師 T+7 週記');

    // 表格具備可存取結構：aria-describedby → section title，thead 每個 th 有 scope
    await expect(table).toHaveAttribute('aria-describedby', 'pricing-comparison-title');
    const scopes = await table.locator('thead th').evaluateAll((els) =>
      els.map((el) => el.getAttribute('scope')),
    );
    expect(scopes.every((s) => s === 'col')).toBe(true);

    // section 有可識別的 landmark（aria-labelledby 指向標題）
    const section = page.getByTestId('pricing-comparison-section');
    await expect(section).toHaveAttribute('aria-labelledby', 'pricing-comparison-title');

    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(6);

    // 每一列的兩個描述欄位都要有非空文字，避免將來加欄位漏掉一邊
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const cells = rows.nth(i).locator('td');
      const follower = (await cells.nth(1).innerText()).trim();
      const cultivator = (await cells.nth(2).innerText()).trim();
      expect(follower.length).toBeGreaterThan(4);
      expect(cultivator.length).toBeGreaterThan(4);
    }
  });


  test('mobile 390：修煉派 painPoint 不會被截斷、比較區塊以 stacked 卡片呈現', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' });

    // 切到修煉派 pill → carousel 滑到 index 1（cultivator）
    await page.getByRole('button', { name: /我要練方法/ }).click();
    // 等 transform 動畫完成
    await page.waitForTimeout(700);

    const painEl = page.getByText(`「${CULTIVATOR_PAIN}」`, { exact: true });
    await expect(painEl).toBeVisible();

    // 文字節點自身不應被 overflow/ellipsis 截斷
    const clipped = await painEl.evaluate((el) => ({
      truncated: el.scrollWidth > el.clientWidth + 1,
      textOverflow: getComputedStyle(el).textOverflow,
    }));
    expect(clipped.truncated).toBe(false);

    // 桌面版 table 隱藏、手機版比較卡片可見
    await expect(page.getByTestId('pricing-comparison-table')).toBeHidden();
    const section = page.getByTestId('pricing-comparison-section');
    await expect(section).toBeVisible();
    await expect(section).toContainText('T+7 週記');
    await expect(section).toContainText('心法');
  });
});
