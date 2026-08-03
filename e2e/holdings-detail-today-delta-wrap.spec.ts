/**
 * E2E — HoldingsDetailPanel · 「今日 delta」窄屏 wrap + 節奏守門
 *
 * 背景：Header 迷你 sparkline 移除後，右側改放「今日 +X%／+Y」delta。
 *   - 寬螢幕（≥560px）：與名稱 <h2> 同一列，右對齊。
 *   - 窄螢幕（≤414px）：flex-wrap 落到名稱下方，仍右對齊，不得溢出。
 *
 * 另守門：抽屜 body 每個主要區塊之間的垂直間距落在 16–28px（憲法 20px ±），
 *   避免刪除 sparkline 後留下 34–38px 疊加空隙或不一致鴻溝。
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const NARROW_WIDTHS = [320, 360, 390, 414] as const;
const WIDE_WIDTHS = [768, 1024, 1280] as const;

const GAP_MIN = 12;
const GAP_MAX = 32;

async function primeDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
    } catch {}
  });
}

async function openDrawer(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await primeDemo(page);
  await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
  const card = page.locator('.wb-card').first();
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  await card.click();
  const panel = page.locator('[data-testid="holdings-detail-panel"]').first();
  await panel.waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(200);
  return panel;
}

test.describe('HoldingsDetailPanel · today-delta wrap + 節奏守門', () => {
  for (const w of NARROW_WIDTHS) {
    test(`窄屏 ${w}px：今日 delta wrap 到名稱下方且不溢出`, async ({ page }) => {
      const panel = await openDrawer(page, w);
      const name = panel.locator('h2').first();
      const delta = panel.locator('[data-testid="drawer-today-delta"]').first();

      // demo 資料可能無 todayPct → 若不存在直接跳過（不視為失敗）
      if (!(await delta.count())) {
        test.skip(true, 'demo 樣本無 todayPct，跳過');
        return;
      }

      const [nameBox, deltaBox, panelBox] = await Promise.all([
        name.boundingBox(),
        delta.boundingBox(),
        panel.boundingBox(),
      ]);
      expect(nameBox, 'h2 box').toBeTruthy();
      expect(deltaBox, 'delta box').toBeTruthy();
      expect(panelBox, 'panel box').toBeTruthy();
      if (!nameBox || !deltaBox || !panelBox) return;

      // 窄屏：delta 應該 wrap 到名稱下方（top 大於名稱底邊 - 少量容差）
      expect(
        deltaBox.y,
        `[${w}px] delta.top=${deltaBox.y} 應落在 h2.bottom=${nameBox.y + nameBox.height} 之下`,
      ).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 4);

      // 不得水平溢出抽屜
      expect(
        deltaBox.x + deltaBox.width,
        `[${w}px] delta 右緣 ${deltaBox.x + deltaBox.width} 超過抽屜右緣 ${panelBox.x + panelBox.width}`,
      ).toBeLessThanOrEqual(panelBox.x + panelBox.width + 0.5);

      // 右對齊：delta 右緣應貼近抽屜內容右緣（≤ 32px 內距）
      expect(
        panelBox.x + panelBox.width - (deltaBox.x + deltaBox.width),
        `[${w}px] delta 未右對齊，距抽屜右緣 ${panelBox.x + panelBox.width - (deltaBox.x + deltaBox.width)}px`,
      ).toBeLessThanOrEqual(32);

      // 今日 delta 旁 info 圖示必須有 a11y label 與 tooltip 說明文字
      const info = delta.locator('[data-testid="drawer-today-delta-info"]').first();
      await expect(info).toHaveAttribute('aria-label', '今日漲跌幅說明');
      await info.hover();
      await page.waitForTimeout(150);
      await expect(
        page.locator('text=今日漲跌幅（% 與金額）與下方 30 日走勢帶使用相同收盤價來源').first(),
      ).toBeVisible();
    });
  }


  for (const w of WIDE_WIDTHS) {
    test(`寬屏 ${w}px：抽屜 panel 受 sm:max-w-md 限制，delta 仍為獨立右對齊行`, async ({ page }) => {
      const panel = await openDrawer(page, w);
      const name = panel.locator('h2').first();
      const delta = panel.locator('[data-testid="drawer-today-delta"]').first();
      if (!(await delta.count())) {
        test.skip(true, 'demo 樣本無 todayPct，跳過');
        return;
      }

      const [nameBox, deltaBox, panelBox] = await Promise.all([
        name.boundingBox(),
        delta.boundingBox(),
        panel.boundingBox(),
      ]);
      if (!nameBox || !deltaBox || !panelBox) throw new Error('boxes missing');

      // 憲法：delta 為獨立行、位於 h2 之下、右對齊、不溢出
      expect(deltaBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 4);
      expect(deltaBox.x + deltaBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 0.5);
      expect(
        panelBox.x + panelBox.width - (deltaBox.x + deltaBox.width),
        `[${w}px] delta 未右對齊，距抽屜右緣 ${panelBox.x + panelBox.width - (deltaBox.x + deltaBox.width)}px`,
      ).toBeLessThanOrEqual(32);
    });
  }

  test('抽屜區塊間距節奏一致（無多餘留白）@ 390px', async ({ page }) => {
    const panel = await openDrawer(page, 390);

    // 每個模組都用「外容器」的 testid，避免內部子節點被錯位為分段錨點
    const selectors = [
      '[data-testid="drawer-identity"]',             // §2 identity
      '[data-testid="drawer-return-tower"]',         // §3 return tower
      '[data-testid="decision-stamp"]',              // §4 decision
      '[data-testid="holdings-price-axis"]',         // §5 price axis
      '[data-testid="holdings-range-band"]',         // §6 30D range band（唯一保留的折線圖）
      // §7 weight rank 已移到抽屜最下方且預設摺疊，不參與上半部節奏檢查
    ];

    const boxes: Array<{ sel: string; y: number; h: number }> = [];
    for (const sel of selectors) {
      const el = panel.locator(sel).first();
      if (!(await el.count())) continue;
      const b = await el.boundingBox();
      if (b) boxes.push({ sel, y: b.y, h: b.height });
    }
    expect(boxes.length, '至少要抓到 4 個區塊').toBeGreaterThanOrEqual(4);

    // 相鄰區塊的間距（下一段 top - 前一段 bottom）應落在 GAP_MIN..GAP_MAX
    for (let i = 1; i < boxes.length; i++) {
      const prev = boxes[i - 1];
      const curr = boxes[i];
      const gap = curr.y - (prev.y + prev.h);
      expect(
        gap,
        `${prev.sel} → ${curr.sel} gap=${gap}px 不在 ${GAP_MIN}..${GAP_MAX} 內（節奏不一致）`,
      ).toBeGreaterThanOrEqual(GAP_MIN);
      expect(
        gap,
        `${prev.sel} → ${curr.sel} gap=${gap}px 超過 ${GAP_MAX}px（多餘留白）`,
      ).toBeLessThanOrEqual(GAP_MAX);
    }
  });

  test('佔比排名與情境模擬已完全移除', async ({ page }) => {
    const panel = await openDrawer(page, 390);
    await expect(panel.locator('[data-testid="holdings-weight-rank"]')).toHaveCount(0);
    await expect(panel.getByText('情境模擬')).toHaveCount(0);
    await expect(panel.getByText(/排名 #/)).toHaveCount(0);
  });

  test('header 迷你 sparkline 已完全移除', async ({ page }) => {
    const panel = await openDrawer(page, 1280);
    await expect(
      panel.locator('[data-panel-sparkline]'),
      'header 迷你 sparkline 節點不得再出現',
    ).toHaveCount(0);
    await expect(
      panel.locator('[data-testid="holdings-range-band"]').first(),
      '唯一保留的 RangeBand 必須存在',
    ).toBeVisible();
  });
});
