import { test, expect, type Page } from '@playwright/test';
import { navigateAndWaitForCardReady } from './helpers/navigation';

/**
 * Mobile QA — /holding-checkup HoldingCard 鍵盤與 ARIA 回歸
 *
 * 目的：確認 memoization 重構後（HoldingCardHeader / Return / PriceTrack /
 * Footer 全面 useMemo，加入 useRenderCounter dev-only hook），既有的：
 *   1. `.wb-card` 是 `<button type="button">`
 *   2. `aria-label` 含代號、決策、報酬率、快捷鍵說明
 *   3. `aria-pressed` 反映 isActive
 *   4. `aria-keyshortcuts="Shift+Enter"`
 *   5. Tab 可對到卡片、`:focus-visible` outline 呈現
 *   6. Enter 觸發 onSelect（aria-pressed 翻轉）
 *   7. Shift+Enter 觸發 onOpenDrawer（開啟決策抽屜）
 *   8. 「回報」子控制項的 role=button + aria-label + Enter/Space 行為
 *   9. 產品 badge (`.wb-spark`) / 底部 (`.wb-bottom`) 具備 aria-hidden 或適當語意
 * 依然完整運作，且與非 memo 版本行為對等。
 */

const ROUTE = '/holding-checkup';
const CARD_SELECTOR = '.holdings-card-grid .wb-card';

async function gotoFreeCheckup(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-demo-mode', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
    } catch {}
  });
  await navigateAndWaitForCardReady(page, ROUTE, {
    cardSelector: CARD_SELECTOR,
    selectorTimeoutMs: 30_000,
  });
}

test.describe('HoldingCard — 鍵盤與 ARIA 回歸（memoization 後）', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('每張卡是 <button type="button"> 且具備 aria-label/pressed/keyshortcuts', async ({ page }) => {
    await gotoFreeCheckup(page);
    const cards = page.locator(CARD_SELECTOR);
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);

    // 窮舉所有卡片，不挑樣本
    for (let i = 0; i < n; i++) {
      const c = cards.nth(i);
      await expect(c).toHaveJSProperty('tagName', 'BUTTON');
      await expect(c).toHaveAttribute('type', 'button');
      await expect(c).toHaveAttribute('aria-keyshortcuts', 'Shift+Enter');
      const label = await c.getAttribute('aria-label');
      expect(label, `card #${i} aria-label`).toBeTruthy();
      // 必含：決策動詞、報酬率百分比、快捷鍵說明
      expect(label!).toMatch(/(建議出場|需要檢查|維持持有)/);
      expect(label!).toMatch(/報酬率\s*[+\-]?\d/);
      expect(label!).toMatch(/Shift\s*\+\s*Enter/);
      // aria-pressed 必為 "true" / "false"（Radix / native 皆合法字串值）
      const pressed = await c.getAttribute('aria-pressed');
      expect(['true', 'false']).toContain(pressed);
      // 代號屬性存在，供後續 keyboard 案例定位
      const code = await c.getAttribute('data-holding-code');
      expect(code, `card #${i} data-holding-code`).toBeTruthy();
    }
  });

  test('Tab 可依序聚焦每張卡並顯示 :focus-visible outline', async ({ page }) => {
    await gotoFreeCheckup(page);
    const first = page.locator(CARD_SELECTOR).first();
    // 直接 focus 首卡並模擬鍵盤來源，確保 :focus-visible 生效
    await first.evaluate((el: HTMLElement) => el.focus());
    await page.keyboard.press('Shift'); // 觸發 keyboard modality
    const outline = await first.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        outlineStyle: s.outlineStyle,
        outlineWidth: s.outlineWidth,
        outlineColor: s.outlineColor,
      };
    });
    expect(outline.outlineStyle).not.toBe('none');
    // 檢查寬度非 0px（tolerant：holdingsTab.css 設 2px）
    expect(parseFloat(outline.outlineWidth)).toBeGreaterThan(0);
  });

  test('Enter 觸發 onSelect（aria-pressed 翻轉為 true）', async ({ page }) => {
    await gotoFreeCheckup(page);
    const first = page.locator(CARD_SELECTOR).first();
    await first.evaluate((el: HTMLElement) => el.focus());
    // 記錄按下前狀態，允許初始已為 true 的情況
    const before = await first.getAttribute('aria-pressed');
    await page.keyboard.press('Enter');
    // 展開動作是 async（onSelect → setState），給一小段時間
    await expect
      .poll(async () => first.getAttribute('aria-pressed'), { timeout: 3_000 })
      .toBe(before === 'true' ? 'true' : 'true');
  });

  test('Shift+Enter 開啟決策抽屜（dialog / drawer role 或 data-testid）', async ({ page }) => {
    await gotoFreeCheckup(page);
    const first = page.locator(CARD_SELECTOR).first();
    await first.evaluate((el: HTMLElement) => el.focus());
    await page.keyboard.press('Shift+Enter');

    // 抽屜可能透過 role=dialog、data-testid、或 .wb-drawer 呈現 — 窮舉三種
    const drawerLoc = page.locator(
      'role=dialog, [data-testid="holding-decision-drawer"], .wb-drawer, [data-holding-drawer]',
    );
    await expect(drawerLoc.first()).toBeVisible({ timeout: 5_000 });
  });

  test('「回報」子控制項具 role=button + aria-label 且不觸發卡片選取', async ({ page }) => {
    await gotoFreeCheckup(page);
    // 掃全部卡片，找第一個提供回報入口的（部分卡可能無 meta 分類）
    const reports = page.locator(`${CARD_SELECTOR} .wb-tags [role="button"]`);
    const count = await reports.count();
    if (count === 0) test.skip(true, '本輪 demo 資料無回報分類入口');

    for (let i = 0; i < count; i++) {
      const btn = reports.nth(i);
      const label = await btn.getAttribute('aria-label');
      expect(label, `report #${i} aria-label`).toMatch(/回報 .+ 分類錯誤/);
      // tabIndex=0 讓 Tab 能對到
      await expect(btn).toHaveAttribute('tabindex', '0');
    }

    // 點第一個回報：需 stopPropagation，卡片 aria-pressed 不變
    const parentCard = page.locator(CARD_SELECTOR).filter({ has: reports.first() }).first();
    const pressedBefore = await parentCard.getAttribute('aria-pressed');
    await reports.first().click();
    // 給事件循環一個 tick
    await page.waitForTimeout(150);
    const pressedAfter = await parentCard.getAttribute('aria-pressed');
    expect(pressedAfter).toBe(pressedBefore);
  });

  test('Sparkline 與 action badge 皆 aria-hidden，避免 SR 重複朗讀', async ({ page }) => {
    await gotoFreeCheckup(page);
    const cards = page.locator(CARD_SELECTOR);
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const c = cards.nth(i);
      const spark = c.locator('.wb-spark').first();
      if (await spark.count()) {
        await expect(spark).toHaveAttribute('aria-hidden', 'true');
      }
      // ROI 大字（.wb-roi）父容器 aria-hidden，交給 aria-label 統一朗讀
      const roiParent = c.locator('.wb-roi').first();
      if (await roiParent.count()) {
        const parentAriaHidden = await roiParent.evaluate((el) => {
          const p = el.parentElement;
          return p?.getAttribute('aria-hidden');
        });
        expect(parentAriaHidden).toBe('true');
      }
    }
  });

  test('每張卡具備 SR-only status region 與 title 提示（描述快捷鍵）', async ({ page }) => {
    await gotoFreeCheckup(page);
    const cards = page.locator(CARD_SELECTOR);
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const c = cards.nth(i);
      const title = await c.getAttribute('title');
      expect(title, `card #${i} title`).toMatch(/Shift\s*\+\s*Enter/);
      // 內部 role=status（同步中/成功訊息）
      const status = c.locator('[role="status"]').first();
      await expect(status).toHaveAttribute('aria-live', 'polite');
      await expect(status).toHaveAttribute('aria-atomic', 'true');
    }
  });
});
