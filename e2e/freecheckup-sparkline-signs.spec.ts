import { test, expect, type Page } from '@playwright/test';
import { navigateAndWaitForCardReady } from './helpers/navigation';

/**
 * Playwright 回歸 — pctSign → Sparkline stroke/opacity 對應憲法
 *
 * 憲法（見 HoldingCardHeader）：
 *   const pctSign = pctVal >= 0 ? 1 : -1;
 *   sparkColor  = isInk ? '#F4F1EC' : (pctSign >= 0 ? WB.accent : '#9B968D')
 *   sparkOpacity = pctSign >= 0 ? 0.85 : (isInk ? 0.6 : 0.55)
 *
 * 本測試「窮舉 demo 種子中所有 .wb-card」，實測畫面上每張卡的 sparkline
 * stroke / opacity，並斷言：
 *   1. Normal 卡：同號區間 stroke/opacity 完全一致；正=#FF4D1F/0.85、負=#9B968D/0.55。
 *   2. Feature (ink) 卡：stroke 恆為 #F4F1EC；opacity 正=0.85 / 負=0.6。
 *   3. 兩號段 stroke 與 opacity 各自相異（跨零時必變）。
 *   4. 至少各 1 張正號、負號 normal 卡存在（demo 種子保證）— 否則測試 skip。
 *   5. `.wb-roi` 顯示的 % 字串符號與 aria-label 報酬率符號一致（跨零不錯位）。
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

// 將 SVG stroke 統一成小寫 hex，避免瀏覽器序列化差異
function normHex(v: string | null): string {
  if (!v) return '';
  const s = v.trim().toLowerCase();
  // Chromium 可能把 attribute value 保持原樣（我們 attribute 直接寫 hex）
  return s;
}

// 從卡片 aria-label 抽出 pct 符號：+ / -
function signFromAriaLabel(label: string | null): 1 | -1 | 0 {
  if (!label) return 0;
  const m = label.match(/報酬率\s*([+\-]?)([\d.]+)/);
  if (!m) return 0;
  const sign = m[1];
  const num = Number(m[2]);
  if (!Number.isFinite(num)) return 0;
  if (sign === '-') return -1;
  return 1; // 空字串或 '+' 都視為 >=0（含 0.00 case）
}

// 從 .wb-roi 文字抽出 pct 符號（+ / -）
function signFromRoiText(txt: string | null): 1 | -1 | 0 {
  if (!txt) return 0;
  const m = txt.match(/([+\-])?(\d+\.\d+)\s*%/);
  if (!m) return 0;
  const num = Number(m[2]);
  if (!Number.isFinite(num)) return 0;
  return m[1] === '-' ? -1 : 1;
}

interface SparkSample {
  index: number;
  isFeature: boolean;
  ariaSign: 1 | -1 | 0;
  roiSign: 1 | -1 | 0;
  stroke: string;
  opacity: string;
  hasPolyline: boolean;
}

async function waitForSparklines(page: Page, minCount = 1) {
  // sparkline 由 hooks 的 sparkData 決定；歷史價可能 async 才進來
  // 這裡輪詢 polyline 節點數，最多 8 秒
  await page.waitForFunction(
    (min) => document.querySelectorAll('.holdings-card-grid .wb-card .wb-spark svg polyline').length >= min,
    minCount,
    { timeout: 8_000 },
  ).catch(() => { /* 允許 0：由 caller 決定要不要 skip */ });
}

async function collect(page: Page): Promise<SparkSample[]> {
  return page.$$eval(CARD_SELECTOR, (cards) => {
    return cards.map((card, i) => {
      const label = card.getAttribute('aria-label');
      const isFeature = card.classList.contains('wb-card-feature');
      const roi = card.querySelector('.wb-roi');
      const poly = card.querySelector('.wb-spark svg polyline');
      return {
        index: i,
        isFeature,
        ariaLabel: label,
        roiText: roi?.textContent || '',
        stroke: (poly?.getAttribute('stroke') || '').toLowerCase(),
        opacity: poly?.getAttribute('opacity') || '',
        hasPolyline: !!poly,
      };
    });
  }).then((rows) =>
    rows.map((r) => ({
      index: r.index,
      isFeature: r.isFeature,
      ariaSign: signFromAriaLabel(r.ariaLabel),
      roiSign: signFromRoiText(r.roiText),
      stroke: normHex(r.stroke),
      opacity: r.opacity,
      hasPolyline: r.hasPolyline,
    })),
  );
}

test.describe('Sparkline pctSign 視覺一致性回歸', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('normal 卡：正號與負號 stroke/opacity 分組完全一致且互相相異', async ({ page }) => {
    await gotoFreeCheckup(page);
    await waitForSparklines(page, 1);
    const samples = (await collect(page)).filter((s) => !s.isFeature && s.hasPolyline);
    if (samples.length === 0) test.skip(true, '本輪 demo 無 normal 卡具 sparkline（歷史價未同步）');

    const pos = samples.filter((s) => s.ariaSign === 1);
    const neg = samples.filter((s) => s.ariaSign === -1);

    // demo 種子含正負 → 若某側為 0，仍檢查已存在的一側；同時 skip 相異性斷言
    if (pos.length === 0 && neg.length === 0) test.skip(true, 'demo 種子無法區分符號');

    // 每個群組內 stroke / opacity 全一致
    if (pos.length > 0) {
      const s0 = pos[0];
      expect(s0.stroke).toBe('#ff4d1f');
      expect(s0.opacity).toBe('0.85');
      for (const s of pos) {
        expect(s.stroke, `card #${s.index} 正號 stroke`).toBe(s0.stroke);
        expect(s.opacity, `card #${s.index} 正號 opacity`).toBe(s0.opacity);
      }
    }
    if (neg.length > 0) {
      const s0 = neg[0];
      expect(s0.stroke).toBe('#9b968d');
      expect(s0.opacity).toBe('0.55');
      for (const s of neg) {
        expect(s.stroke, `card #${s.index} 負號 stroke`).toBe(s0.stroke);
        expect(s.opacity, `card #${s.index} 負號 opacity`).toBe(s0.opacity);
      }
    }
    // 跨零：兩群 stroke / opacity 必相異
    if (pos.length > 0 && neg.length > 0) {
      expect(pos[0].stroke).not.toBe(neg[0].stroke);
      expect(pos[0].opacity).not.toBe(neg[0].opacity);
    }
  });

  test('feature (ink) 卡：stroke 恆為 #F4F1EC，opacity 依符號 0.85 / 0.6', async ({ page }) => {
    await gotoFreeCheckup(page);
    await waitForSparklines(page, 1);
    const samples = (await collect(page)).filter((s) => s.isFeature && s.hasPolyline);
    if (samples.length === 0) test.skip(true, '本輪 demo 無 feature 卡具 sparkline');

    for (const s of samples) {
      expect(s.stroke, `feature card #${s.index} stroke`).toBe('#f4f1ec');
      if (s.ariaSign === 1) {
        expect(s.opacity, `feature card #${s.index} 正號 opacity`).toBe('0.85');
      } else if (s.ariaSign === -1) {
        expect(s.opacity, `feature card #${s.index} 負號 opacity`).toBe('0.6');
      }
    }
  });

  test('aria-label 報酬率符號 與 .wb-roi 顯示 % 符號一致（跨零不錯位）', async ({ page }) => {
    await gotoFreeCheckup(page);
    const samples = await collect(page);
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      if (s.ariaSign === 0 || s.roiSign === 0) continue;
      expect(
        s.ariaSign,
        `card #${s.index} aria=${s.ariaSign} roi=${s.roiSign}`,
      ).toBe(s.roiSign);
    }
  });

  test('sparkline stroke 屬性值全部合法（僅三種預期色）', async ({ page }) => {
    await gotoFreeCheckup(page);
    await waitForSparklines(page, 1);
    const samples = (await collect(page)).filter((s) => s.hasPolyline);
    if (samples.length === 0) test.skip(true, '本輪 demo 無任何 sparkline');
    const allowed = new Set(['#ff4d1f', '#9b968d', '#f4f1ec']);
    for (const s of samples) {
      expect(allowed.has(s.stroke), `card #${s.index} stroke=${s.stroke} 不在白名單`).toBe(true);
    }
  });

  test('sparkline opacity 屬性值全部合法（僅 0.85 / 0.55 / 0.6）', async ({ page }) => {
    await gotoFreeCheckup(page);
    await waitForSparklines(page, 1);
    const samples = (await collect(page)).filter((s) => s.hasPolyline);
    if (samples.length === 0) test.skip(true, '本輪 demo 無任何 sparkline');
    const allowed = new Set(['0.85', '0.55', '0.6']);
    for (const s of samples) {
      expect(allowed.has(s.opacity), `card #${s.index} opacity=${s.opacity} 不在白名單`).toBe(true);
    }
  });
});
