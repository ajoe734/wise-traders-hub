import { test, expect, type Page } from '@playwright/test';
import { navigateAndWaitForCardReady } from './helpers/navigation';

/**
 * per-signal 教學徽章 (.wb-tip) 端到端回歸
 *
 * 憲法（見 HoldingCardHeader）：
 *   - 每張 .wb-card 恆有 .wb-tip；data-tip-source ∈ {meta, fallback}。
 *   - fallback 分流依 actionLabel（getFallbackTip）：
 *       ADD/BUY/加碼/買進     → 進場前先確認風險比例
 *       REDUCE/SELL/減碼/賣出 → 分批減碼保留紀律
 *       HOLD/續抱             → 續抱請設好停損
 *       其他 / 空                → 持倉檢視小提醒
 *   - .wb-tip aria-label 開頭必為「教學提示：」，文字非空。
 *   - Header 不動卡片外層 aria-label（本頁 aria-label 覆蓋 sparkline 憲法：報酬率 / 標的等）。
 *
 * demo 模式下：seed 未提供 meta.tip → 幾乎全數落 fallback；本 spec 主要驗
 * 「徽章恆存在 + 分流表 + 不污染外層 aria」。
 */

const ROUTE = '/holding-checkup';
const CARD_SELECTOR = '.holdings-card-grid .wb-card';

const FALLBACK_MAP: Array<{ re: RegExp; text: string }> = [
  { re: /^(ADD|BUY)$/i, text: '進場前先確認風險比例' },
  { re: /加碼|買進/, text: '進場前先確認風險比例' },
  { re: /^(REDUCE|SELL)$/i, text: '分批減碼保留紀律' },
  { re: /減碼|賣出/, text: '分批減碼保留紀律' },
  { re: /^HOLD$/i, text: '續抱請設好停損' },
  { re: /續抱/, text: '續抱請設好停損' },
];
function expectedFallback(action: string): string {
  for (const { re, text } of FALLBACK_MAP) if (re.test(action)) return text;
  return '持倉檢視小提醒';
}

async function gotoFreeCheckup(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-demo-mode', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
    } catch {}
    class IOStub {
      cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) { this.cb = cb; }
      observe(el: Element) {
        this.cb(
          [{
            isIntersecting: true,
            target: el,
            intersectionRatio: 1,
            boundingClientRect: el.getBoundingClientRect(),
            rootBounds: null,
            intersectionRect: el.getBoundingClientRect(),
            time: 0,
          } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
      root: Element | null = null;
      rootMargin = '';
      thresholds: number[] = [];
    }
    (window as any).IntersectionObserver = IOStub;
  });
  await navigateAndWaitForCardReady(page, ROUTE, {
    cardSelector: CARD_SELECTOR,
    selectorTimeoutMs: 30_000,
  });
  await page.waitForFunction(
    () => document.querySelectorAll('.holdings-card-grid .wb-card .wb-tip').length > 0,
    null,
    { timeout: 8_000 },
  );
}

interface TipSample {
  index: number;
  cardAria: string | null;
  tipText: string;
  tipAria: string | null;
  source: string | null;
  action: string;
  title: string | null;
}

async function collect(page: Page): Promise<TipSample[]> {
  return await page.$$eval(CARD_SELECTOR, (cards) =>
    cards.map((card, i) => {
      const tip = card.querySelector('.wb-tip') as HTMLElement | null;
      return {
        index: i,
        cardAria: card.getAttribute('aria-label'),
        tipText: (tip?.textContent || '').trim(),
        tipAria: tip?.getAttribute('aria-label') || null,
        source: tip?.getAttribute('data-tip-source') || null,
        action: tip?.getAttribute('data-tip-action') || '',
        title: tip?.getAttribute('title') || null,
      };
    }),
  );
}

test.describe('per-signal 教學徽章', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('每張卡都有 .wb-tip，data-tip-source ∈ {meta, fallback}', async ({ page }) => {
    await gotoFreeCheckup(page);
    const samples = await collect(page);
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      expect(['meta', 'fallback'], `card #${s.index} source=${s.source}`).toContain(s.source);
      expect(s.tipText.length, `card #${s.index} tipText 非空`).toBeGreaterThan(0);
    }
  });

  test('.wb-tip aria-label 開頭必為「教學提示：」且與文字一致', async ({ page }) => {
    await gotoFreeCheckup(page);
    const samples = await collect(page);
    for (const s of samples) {
      expect(s.tipAria, `card #${s.index} aria`).toBe(`教學提示：${s.tipText}`);
    }
  });

  test('fallback 分流：文字必與 actionLabel 對應', async ({ page }) => {
    await gotoFreeCheckup(page);
    const samples = (await collect(page)).filter((s) => s.source === 'fallback');
    if (samples.length === 0) test.skip(true, '本輪 demo 全數 meta.tip 提供，無 fallback 樣本');
    for (const s of samples) {
      expect(s.tipText, `card #${s.index} action=${s.action}`)
        .toBe(expectedFallback(s.action));
    }
  });

  test('meta 提供時 .wb-tip title 含主文（且 aria/text 一致）', async ({ page }) => {
    await gotoFreeCheckup(page);
    const samples = (await collect(page)).filter((s) => s.source === 'meta');
    if (samples.length === 0) test.skip(true, '本輪 demo 無 meta.tip 樣本');
    for (const s of samples) {
      expect(s.title || '', `card #${s.index} title 含主文`).toContain(s.tipText);
    }
  });

  test('卡片外層 aria-label 不受 Header tip 注入影響（守門：外層仍為報酬率等資訊）', async ({ page }) => {
    await gotoFreeCheckup(page);
    const samples = await collect(page);
    for (const s of samples) {
      if (!s.cardAria) continue;
      // 外層 aria 不得被本次注入的「教學提示：」污染
      expect(s.cardAria, `card #${s.index} 外層 aria`).not.toContain('教學提示');
    }
  });
});
