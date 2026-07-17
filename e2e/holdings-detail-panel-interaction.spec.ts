/**
 * E2E · HoldingsDetailPanel 抽屜互動守門
 *
 * 覆蓋 Radix Sheet/Dialog 的可存取性合約：
 *   1. 開啟後焦點必須落在抽屜內
 *   2. Tab 正向循環：焦點永遠停留在抽屜內、不逃逸到底層頁面
 *   3. Shift+Tab 反向循環：同上
 *   4. ESC 關閉抽屜
 *   5. 點擊遮罩（overlay）關閉抽屜
 *   6. 關閉後底層頁面回復可互動（無殘留 aria-hidden / inert / pointer-events 卡死）
 *
 * 覆蓋斷點：手機 (390) / 平板 (863) / 桌面 (1280)
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';
import { drawerStep, registerDrawerFailureReport } from './helpers/drawer-failure-report';

registerDrawerFailureReport();

async function primeDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
    } catch {}
  });
}

async function openDrawer(page: Page) {
  await drawerStep('prime demo storage', () => primeDemo(page));
  await drawerStep('goto /holding-checkup-demo', () =>
    gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' }),
  );
  return drawerStep('click first holding card & wait for drawer', async () => {
    const firstCard = page.locator('.wb-card').first();
    await firstCard.waitFor({ state: 'visible', timeout: 15_000 });
    await firstCard.scrollIntoViewIfNeeded();
    await firstCard.click();
    const panel = page.locator('[data-testid="holdings-detail-panel"]').first();
    await panel.waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(300);
    return panel;
  });
}

/** 取得目前焦點元素相對抽屜的位置 + 描述 */
async function focusInfo(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return { tag: null, insideDialog: false, insidePanel: false, text: '', isBody: true };
    const dialog = active.closest('[role="dialog"]');
    const panel = active.closest('[data-testid="holdings-detail-panel"]');
    return {
      tag: active.tagName.toLowerCase(),
      insideDialog: !!dialog,
      insidePanel: !!panel,
      text: (active.textContent || active.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      isBody: active === document.body,
    };
  });
}

test.describe('HoldingsDetailPanel · 抽屜互動守門', () => {
  test('開啟後焦點落在抽屜內（Radix autoFocus）', async ({ page }) => {
    await openDrawer(page);
    await drawerStep('assert focus inside dialog', async () => {
      const info = await focusInfo(page);
      expect(info.insideDialog, `focus should be inside dialog, got: ${JSON.stringify(info)}`).toBe(true);
    });
  });

  test('Tab 正向循環：焦點永遠停在抽屜內，不逃逸底層頁面', async ({ page }) => {
    await openDrawer(page);
    for (let i = 0; i < 30; i += 1) {
      await drawerStep(`Tab #${i + 1} — expect focus stays in dialog`, async () => {
        await page.keyboard.press('Tab');
        const info = await focusInfo(page);
        expect(
          info.insideDialog,
          `[Tab ${i + 1}] focus escaped dialog → ${JSON.stringify(info)}`,
        ).toBe(true);
      });
    }
  });

  test('Shift+Tab 反向循環：焦點永遠停在抽屜內', async ({ page }) => {
    await openDrawer(page);
    for (let i = 0; i < 30; i += 1) {
      await drawerStep(`Shift+Tab #${i + 1} — expect focus stays in dialog`, async () => {
        await page.keyboard.press('Shift+Tab');
        const info = await focusInfo(page);
        expect(
          info.insideDialog,
          `[Shift+Tab ${i + 1}] focus escaped dialog → ${JSON.stringify(info)}`,
        ).toBe(true);
      });
    }
  });

  test('ESC 關閉抽屜、底層恢復可互動', async ({ page }) => {
    await openDrawer(page);
    await drawerStep('press Escape', () => page.keyboard.press('Escape'));
    await drawerStep('assert drawer + dialog unmounted', async () => {
      await expect(page.locator('[data-testid="holdings-detail-panel"]')).toHaveCount(0, { timeout: 5_000 });
      await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 5_000 });
    });
    await drawerStep('assert first card clickable & no residual overlay', async () => {
      const firstCard = page.locator('.wb-card').first();
      await expect(firstCard).toBeVisible();
      const clickable = await firstCard.evaluate((el) => {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const middle = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          pointerEvents: cs.pointerEvents,
          ariaHidden: el.closest('[aria-hidden="true"]')?.getAttribute('aria-hidden') ?? null,
          inertAncestor: !!el.closest('[inert]'),
          hitSelf: !!middle && (el === middle || el.contains(middle)),
        };
      });
      expect(clickable.pointerEvents).not.toBe('none');
      expect(clickable.ariaHidden, 'card ancestor should not be aria-hidden after close').toBeNull();
      expect(clickable.inertAncestor, 'card ancestor should not remain inert after close').toBe(false);
      expect(clickable.hitSelf, 'card should receive pointer events at its center').toBe(true);
    });
  });

  test('點擊遮罩關閉抽屜（跨斷點：手機全寬時走 pointerdown outside 事件）', async ({ page }) => {
    await openDrawer(page);
    await drawerStep('dispatch pointerdown/up/click on overlay', async () => {
      const overlay = page.locator('div.fixed.inset-0[data-state="open"]').first();
      await overlay.waitFor({ state: 'attached', timeout: 5_000 });
      await overlay.evaluate((el) => {
        const opts = { bubbles: true, cancelable: true, pointerType: 'mouse', clientX: 2, clientY: 2 } as PointerEventInit;
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 2, clientY: 2 }));
      });
    });
    await drawerStep('assert drawer + dialog unmounted after overlay dismiss', async () => {
      await expect(page.locator('[data-testid="holdings-detail-panel"]')).toHaveCount(0, { timeout: 5_000 });
      await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 5_000 });
    });
  });

  test('關閉後可再次開啟（不出現 double-open / 焦點鎖死）', async ({ page }) => {
    await openDrawer(page);
    await drawerStep('press Escape to close', () => page.keyboard.press('Escape'));
    await drawerStep('await drawer unmount', () =>
      expect(page.locator('[data-testid="holdings-detail-panel"]')).toHaveCount(0, { timeout: 5_000 }),
    );
    await drawerStep('reopen drawer via card click', async () => {
      const firstCard = page.locator('.wb-card').first();
      await firstCard.click();
      await expect(page.locator('[data-testid="holdings-detail-panel"]')).toHaveCount(1, { timeout: 5_000 });
      await expect(page.locator('[role="dialog"]')).toHaveCount(1);
    });
    await drawerStep('assert re-open focus inside dialog', async () => {
      const info = await focusInfo(page);
      expect(info.insideDialog, `re-open focus should be inside dialog → ${JSON.stringify(info)}`).toBe(true);
    });
  });
});
