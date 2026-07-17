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
import { test, expect, type Page, type Locator } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';
import { drawerStep, registerDrawerFailureReport } from './helpers/drawer-failure-report';

registerDrawerFailureReport();

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

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

  // ────────────────────────────────────────────────────────────────────────
  // 焦點契約強化（activeElement 精確驗證 + focus trap 邊界 wrap-around +
  // ESC 焦點必須落回原始觸發按鈕）
  // ────────────────────────────────────────────────────────────────────────

  /** 於指定 root 內取得可 focus 元素清單（tag/aria-label/textContent 摘要） */
  async function focusablesIn(root: Locator, selector: string) {
    return root.evaluate((el, sel) => {
      const list = Array.from(el.querySelectorAll<HTMLElement>(sel)).filter((n) => {
        const cs = window.getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const rect = n.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      return list.map((n, i) => ({
        index: i,
        tag: n.tagName.toLowerCase(),
        ariaLabel: n.getAttribute('aria-label'),
        text: (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      }));
    }, selector);
  }

  test('開啟後 activeElement 是抽屜內「真正可 focus」的元素（非 body、非 panel 容器本身）', async ({ page }) => {
    await openDrawer(page);
    await drawerStep('assert activeElement is focusable within panel', async () => {
      const focus = await page.evaluate((sel) => {
        const active = document.activeElement as HTMLElement | null;
        const panel = document.querySelector('[data-testid="holdings-detail-panel"]');
        if (!active || !panel) return { ok: false, reason: 'no active or no panel' };
        if (active === document.body) return { ok: false, reason: 'activeElement is <body>' };
        if (!panel.contains(active) && active !== panel) {
          return { ok: false, reason: 'activeElement outside panel', tag: active.tagName };
        }
        // 必須是「真正可 focus」的元素 — 不能只是 panel 容器本身
        const matches = (active as Element).matches?.(sel);
        return {
          ok: !!matches || active.hasAttribute('tabindex'),
          reason: matches ? 'matches focusable selector' : (active.hasAttribute('tabindex') ? 'has tabindex' : 'not a focusable node'),
          tag: active.tagName.toLowerCase(),
          ariaLabel: active.getAttribute('aria-label'),
          role: active.getAttribute('role'),
          text: (active.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        };
      }, FOCUSABLE_SELECTOR);
      expect(focus.ok, `activeElement 非可 focus 元素：${JSON.stringify(focus)}`).toBe(true);
    });
  });

  test('focus trap 前向邊界：從最後一個可 focus 元素 Tab → wrap 回第一個', async ({ page }) => {
    const panel = await openDrawer(page);
    const focusables = await drawerStep('enumerate focusables', () => focusablesIn(panel, FOCUSABLE_SELECTOR));
    expect(focusables.length, '抽屜內至少要有 1 個可 focus 元素').toBeGreaterThan(0);

    await drawerStep('focus the LAST focusable element', async () => {
      await panel.evaluate((el, sel) => {
        const list = Array.from(el.querySelectorAll<HTMLElement>(sel)).filter((n) => {
          const cs = window.getComputedStyle(n);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          const rect = n.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        list[list.length - 1]?.focus();
      }, FOCUSABLE_SELECTOR);
    });

    const before = await focusInfo(page);
    expect(before.insideDialog, `pre-Tab focus must be inside dialog → ${JSON.stringify(before)}`).toBe(true);

    await drawerStep('press Tab past last focusable', () => page.keyboard.press('Tab'));

    const after = await page.evaluate((sel) => {
      const active = document.activeElement as HTMLElement | null;
      const panel = document.querySelector('[data-testid="holdings-detail-panel"]');
      if (!active || !panel) return { insidePanel: false } as const;
      const list = Array.from(panel.querySelectorAll<HTMLElement>(sel)).filter((n) => {
        const cs = window.getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const rect = n.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const idx = list.indexOf(active);
      return {
        insidePanel: panel.contains(active),
        activeIndex: idx,
        totalFocusables: list.length,
        tag: active.tagName.toLowerCase(),
        ariaLabel: active.getAttribute('aria-label'),
        text: (active.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      };
    }, FOCUSABLE_SELECTOR);

    expect(after.insidePanel, `Tab 後焦點必須仍在 panel 內 → ${JSON.stringify(after)}`).toBe(true);
    // wrap 回開頭：activeIndex 應為 0（或至少 < 上一個 index）
    expect(
      after.activeIndex === 0,
      `Tab 從最後一個焦點應 wrap 回第一個（index=0），實際 index=${after.activeIndex} / total=${after.totalFocusables} · ${JSON.stringify(after)}`,
    ).toBe(true);
  });

  test('focus trap 反向邊界：從第一個可 focus 元素 Shift+Tab → wrap 回最後一個', async ({ page }) => {
    const panel = await openDrawer(page);
    const focusables = await drawerStep('enumerate focusables', () => focusablesIn(panel, FOCUSABLE_SELECTOR));
    expect(focusables.length, '抽屜內至少要有 1 個可 focus 元素').toBeGreaterThan(0);

    await drawerStep('focus the FIRST focusable element', async () => {
      await panel.evaluate((el, sel) => {
        const list = Array.from(el.querySelectorAll<HTMLElement>(sel)).filter((n) => {
          const cs = window.getComputedStyle(n);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          const rect = n.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        list[0]?.focus();
      }, FOCUSABLE_SELECTOR);
    });

    await drawerStep('press Shift+Tab before first focusable', () => page.keyboard.press('Shift+Tab'));

    const after = await page.evaluate((sel) => {
      const active = document.activeElement as HTMLElement | null;
      const panel = document.querySelector('[data-testid="holdings-detail-panel"]');
      if (!active || !panel) return { insidePanel: false } as const;
      const list = Array.from(panel.querySelectorAll<HTMLElement>(sel)).filter((n) => {
        const cs = window.getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const rect = n.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      return {
        insidePanel: panel.contains(active),
        activeIndex: list.indexOf(active),
        totalFocusables: list.length,
        tag: active.tagName.toLowerCase(),
        ariaLabel: active.getAttribute('aria-label'),
      };
    }, FOCUSABLE_SELECTOR);

    expect(after.insidePanel, `Shift+Tab 後焦點必須仍在 panel 內 → ${JSON.stringify(after)}`).toBe(true);
    expect(
      after.activeIndex,
      `Shift+Tab 從第一個焦點應 wrap 回最後一個（index=${after.totalFocusables - 1}），實際 index=${after.activeIndex}`,
    ).toBe(after.totalFocusables - 1);
  });

  test('ESC 關閉後焦點必須落回原始觸發按鈕（.wb-card 首張）', async ({ page }) => {
    // 標準 A11y 契約：Radix Dialog 的 onCloseAutoFocus 應把焦點還回原觸發元素
    await drawerStep('prime demo storage', () => primeDemo(page));
    await drawerStep('goto /holding-checkup-demo', () =>
      gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' }),
    );

    // 為第一張卡片打上唯一標記，關閉後用同一標記確認 activeElement 完全相同
    const TRIGGER_TAG = '__drawer_trigger_probe__';
    await drawerStep('mark first card as focus trigger + keyboard-open', async () => {
      const firstCard = page.locator('.wb-card').first();
      await firstCard.waitFor({ state: 'visible', timeout: 15_000 });
      await firstCard.scrollIntoViewIfNeeded();
      await firstCard.evaluate((el, tag) => {
        el.setAttribute('data-focus-probe', tag);
        // 若卡片本身不可 focus，補一個 tabindex=0 讓它能承接 focus 還原
        if (!(el as HTMLElement).matches('a,button,[tabindex]')) {
          el.setAttribute('tabindex', '0');
        }
        (el as HTMLElement).focus();
      }, TRIGGER_TAG);
      // 用鍵盤啟動而非點擊，最貼近鍵盤使用者路徑
      const focusedTag = await page.evaluate(() => document.activeElement?.getAttribute('data-focus-probe'));
      expect(focusedTag, '觸發前卡片應被 focus').toBe(TRIGGER_TAG);
      // 有些卡片需要 Enter，有些需 Space — 兩個都嘗試，任一開啟即可
      await page.keyboard.press('Enter');
      const opened = await page.locator('[data-testid="holdings-detail-panel"]').count();
      if (opened === 0) {
        // 若 Enter 沒開，退回 click（仍保留 focus probe，Radix 記住 trigger）
        await firstCard.click();
      }
      await page.locator('[data-testid="holdings-detail-panel"]').first().waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(200);
    });

    await drawerStep('assert focus moved into dialog after open', async () => {
      const info = await focusInfo(page);
      expect(info.insideDialog, `開啟後焦點應進入 dialog → ${JSON.stringify(info)}`).toBe(true);
    });

    await drawerStep('press Escape', () => page.keyboard.press('Escape'));
    await drawerStep('await drawer unmount', () =>
      expect(page.locator('[data-testid="holdings-detail-panel"]')).toHaveCount(0, { timeout: 5_000 }),
    );

    // 等 Radix restoreFocus microtask + onCloseAutoFocus 完成
    await page.waitForTimeout(200);

    const restored = await page.evaluate((tag) => {
      const active = document.activeElement as HTMLElement | null;
      const probe = document.querySelector(`[data-focus-probe="${tag}"]`);
      return {
        activeIsProbe: !!active && active === probe,
        activeTag: active?.tagName?.toLowerCase() ?? null,
        activeIsBody: active === document.body,
        activeProbeAttr: active?.getAttribute('data-focus-probe') ?? null,
        probeExists: !!probe,
      };
    }, TRIGGER_TAG);

    expect(restored.probeExists, '關閉後觸發卡片必須仍存在於 DOM').toBe(true);
    expect(
      restored.activeIsProbe,
      `ESC 後 activeElement 必須 === 原觸發卡片；實際：${JSON.stringify(restored)}`,
    ).toBe(true);
  });
});
