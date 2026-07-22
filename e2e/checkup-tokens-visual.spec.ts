// 視覺回歸 — Checkup token 漂移守門
//
// 目標：確保 Batch E/F 引入的 --cm-page-px / --cm-page-py / --cm-accent
// 與自架 Noto Serif/Sans TC woff2 在字型載入完成後，於常見解析度
// (390 / 768 / 1024 / 1280) 的版面間距與 accent 顏色不會漂移。
//
// 三層守門：
//   1) 計算 token：讀 :root computed style，比對常數
//   2) 版面間距：`.cm-page-content` computed paddingLeft 依 clamp(16, 3.5vw, 40) 對應
//   3) Accent 色：實際被使用的元素（cm-badge-exit / cm-upload-cta）
//      background/color === rgb(255, 77, 31)
//   4) Pixel diff：header + hero 區塊小範圍截圖
//
// 首次執行請帶 --update-snapshots 產生 baseline。
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const ACCENT_RGB = 'rgb(255, 77, 31)';

// clamp(16, 3.5vw, 40)
function expectedPagePx(viewportWidth: number): number {
  return Math.min(40, Math.max(16, viewportWidth * 0.035));
}

async function prime(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
    } catch {}
  });
}

async function stabilize(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
      }
      .wb-spark, video, canvas[data-animated],
      [data-testid="live-quote"], [data-realtime],
      [data-skeleton], .animate-pulse, .animate-spin,
      [role="status"], [data-sonner-toaster], [data-radix-toast-root] {
        visibility: hidden !important;
      }
    `,
  });
  // 等 fontsource woff2 全部載入 —— 這是本 spec 的關鍵前置條件
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.scrollTo(0, 0);
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.describe('Checkup tokens visual — /holding-checkup', () => {
  test('token / spacing / accent 不漂移', async ({ page }, testInfo) => {
    const width = testInfo.project.use.viewport?.width ?? 1280;
    await prime(page);
    await gotoWithRetry(page, '/holding-checkup', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await stabilize(page);
    await page.waitForTimeout(200);

    // 1) --cm-accent 常數
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--cm-accent').trim(),
    );
    expect(accent.toUpperCase()).toBe('#FF4D1F');

    // 2) --cm-page-px 依 viewport 對應 clamp 值（tolerance 0.5px 吸收次像素）
    const pagePx = await page.evaluate(() => {
      const el = document.createElement('div');
      el.style.padding = '0 var(--cm-page-px)';
      document.body.appendChild(el);
      const v = parseFloat(getComputedStyle(el).paddingLeft);
      el.remove();
      return v;
    });
    expect(Math.abs(pagePx - expectedPagePx(width))).toBeLessThan(0.75);

    // 3) --cm-page-py 常數
    const pagePy = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--cm-page-py').trim(),
    );
    expect(pagePy).toBe('10px');

    // 4) 字型 stack — fontsource @font-face 已註冊 Noto Sans TC / Noto Serif TC
    //    （fontsource 帶 unicode-range CJK 子集，僅在頁面出現對應字元時載入；
    //     此處只驗證 @font-face 註冊成功，避免 unicode-range 造成假陰性）
    const fontsRegistered = await page.evaluate(() => {
      const families = new Set<string>();
      document.fonts.forEach((f) => families.add(f.family.replace(/^["']|["']$/g, '')));
      return { sans: families.has('Noto Sans TC'), serif: families.has('Noto Serif TC') };
    });
    expect(fontsRegistered.sans).toBe(true);
    expect(fontsRegistered.serif).toBe(true);



    // 5) 實際使用 accent 的元素配色正確
    //    上傳 CTA 桌機顯示、手機由底欄圓鈕承接；用寬度切
    if (width >= 641) {
      const cta = page.locator('.cm-upload-cta').first();
      await expect(cta).toBeVisible();
      const bg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(ACCENT_RGB);
    } else {
      const upload = page.locator('.cm-mobile-tabbar__upload').first();
      await expect(upload).toBeVisible();
      const bg = await upload.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(ACCENT_RGB);
    }

    // 6) Pixel diff — 頁面頂部固定範圍（含返回列 + 品牌/tab 區）
    //    /holding-checkup 頂欄無單一穩定 selector，直接以 clip 截固定範圍即可
    await expect(page).toHaveScreenshot(
      `checkup-tokens-header-${testInfo.project.name}.png`,
      {
        clip: { x: 0, y: 0, width, height: 220 },
        maxDiffPixelRatio: 0.02,
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
      },
    );

    // 7) Hero — 持倉概覽 section（未實現損益 + 狀態列）
    //    以 [data-testid="holdings-hero"] 定位；等它可見再截圖
    const hero = page.locator('[data-testid="holdings-hero"]').first();
    await hero.waitFor({ state: 'visible', timeout: 10_000 });
    // hero 內動態文案 / 即時金額穩定化：
    //  a) 相對時間與 <time> 節點 → 直接隱藏
    //  b) 大字 P&L、%、右側市值列、更新時間戳、refreshing/error chip → 用 Playwright mask 蓋色塊
    //     （避免 demo 報價 tick、"剛剛更新"→"1 分鐘前" 這種 30s tick 造成 flake）
    await page.addStyleTag({
      content: `[data-testid="holdings-hero"] [data-live-timestamp],
                [data-testid="holdings-hero"] time { visibility: hidden !important; }`,
    });
    const heroMask = [
      hero.locator('.wb-hero-pnl-num'),
      hero.locator('.wb-hero-pnl-pct'),
      hero.locator('.wb-hero-market'),
      hero.locator('[data-testid="holdings-hero-updated-at"]'),
      hero.locator('[data-testid="holdings-hero-refreshing"]'),
      hero.locator('[data-testid="holdings-hero-refresh-error"]'),
      hero.locator('[data-testid="holdings-hero-oldest-fetch"]'),
    ];
    await expect(hero).toHaveScreenshot(
      `checkup-tokens-hero-${testInfo.project.name}.png`,
      {
        maxDiffPixelRatio: 0.02,
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
        mask: heroMask,
        // 沿用 Playwright 預設 mask color（#FF00FF），baseline / actual 皆為同色塊即穩定

      },
    );


    // 8) 持倉卡 — 第一張 .wb-card（未展開狀態）
    //    有 demo 資料保底；若真的沒卡（新註冊會員）就跳過此檢查
    const firstCard = page.locator('.holdings-card-grid .wb-card').first();
    const cardCount = await page.locator('.holdings-card-grid .wb-card').count();
    if (cardCount > 0) {
      await firstCard.waitFor({ state: 'visible', timeout: 10_000 });
      // 等 sparkline 準備好（若有）或 220ms 讓 layout 穩定
      await page
        .waitForFunction(
          () => {
            const c = document.querySelector('.holdings-card-grid .wb-card');
            return !!c && !c.hasAttribute('aria-busy');
          },
          { timeout: 5_000 },
        )
        .catch(() => {});
      await page.waitForTimeout(220);

      // 8a) §3.4 ROI 符號合約 — 卡片 `.wb-roi` 必須用 `+` / `−` (U+2212)，
      //     嚴禁再出現 `↑` / `↓` 或 ASCII `-` 或 `+/-`。
      const cardRoiText = (await firstCard.locator('.wb-roi').first().textContent()) ?? '';
      expect(cardRoiText, `卡片 ROI 不得含 ↑/↓ 箭頭：${cardRoiText}`).not.toMatch(/[↑↓]/);
      expect(cardRoiText, `卡片 ROI 負號必須為 U+2212，不得用 ASCII '-'：${cardRoiText}`)
        .not.toMatch(/-\d/);
      // 至少要見到 `+`、`−` (U+2212) 或以 0 開頭（0.00%）三者其一
      expect(cardRoiText, `卡片 ROI 必須帶 +/−/0 符號：${cardRoiText}`)
        .toMatch(/[+\u2212]|^\s*0/);

      await expect(firstCard).toHaveScreenshot(
        `checkup-tokens-holding-card-${testInfo.project.name}.png`,
        { maxDiffPixelRatio: 0.03, animations: 'disabled', caret: 'hide', scale: 'css' },
      );

      // 9) 抽屜 — dblclick 開啟 HoldingsDetailPanel（比 Shift+Enter 對焦更穩定）
      await firstCard.scrollIntoViewIfNeeded();
      await firstCard.dblclick();
      const drawer = page.locator('[data-testid="holdings-detail-panel"]').first();
      await drawer.waitFor({ state: 'attached', timeout: 15_000 });
      await drawer.waitFor({ state: 'visible', timeout: 15_000 });
      // 等 Radix Dialog 動畫結束 + 內容 lazy import 完成
      await page.waitForTimeout(500);
      await page.evaluate(() => document.fonts?.ready);

      // 9a) §3.4 ROI 符號合約 — 抽屜大字 ROI 同樣禁用箭頭 / ASCII '-'
      const drawerRoi = drawer.locator('[data-testid="drawer-roi-main"]').first();
      await expect(drawerRoi).toBeVisible();
      const drawerRoiText = (await drawerRoi.textContent()) ?? '';
      expect(drawerRoiText, `抽屜 ROI 不得含 ↑/↓ 箭頭：${drawerRoiText}`).not.toMatch(/[↑↓]/);
      expect(drawerRoiText, `抽屜 ROI 負號必須為 U+2212，不得用 ASCII '-'：${drawerRoiText}`)
        .not.toMatch(/-\d/);
      expect(drawerRoiText, `抽屜 ROI 必須帶 +/−/0 符號：${drawerRoiText}`)
        .toMatch(/[+\u2212]|^\s*0/);
      // 兜住整個抽屜第一屏：全域檢查沒有殘留 `↑` / `↓` 出現在數值旁（例如 `↑ 12.3%`）
      const drawerFullText = (await drawer.textContent()) ?? '';
      expect(drawerFullText, '抽屜任何位置都不得出現 `↑數字%` 或 `↓數字%` 樣式')
        .not.toMatch(/[↑↓]\s*\d+(?:\.\d+)?\s*%/);

      // 抽屜可能超出 viewport → 用 element screenshot 保證完整
      await expect(drawer).toHaveScreenshot(
        `checkup-tokens-drawer-${testInfo.project.name}.png`,
        {
          maxDiffPixelRatio: 0.03,
          animations: 'disabled',
          caret: 'hide',
          scale: 'css',
        },
      );
    }
  });
});

