/**
 * 迴歸測試：發布視窗關閉文案在 TW / US 市場、以及各種鎖窗情境下
 * 一律使用「本週」，禁止出現「下週」。
 *
 * 覆蓋範圍：
 *   - TW 週六 / 週日 / 週五 20:00 後
 *   - US 週日 / 週六 08:00 後
 *   - 提前發布（force）流程使用的按鈕文案與 toast 訊息
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { authoringWindowLabel, isPublishingWindowOpen, nextPublishMomentLabel, shouldPromptPendingJournalPublish } from '@/lib/publishingWindow';
import fs from 'node:fs';
import path from 'node:path';

/** 建構一個「台灣時間 = 指定 y/m/d h:m」的 UTC Date。 */
function twDate(y: number, m: number, d: number, h: number, min: number): Date {
  // Taipei = UTC+8，無 DST
  return new Date(Date.UTC(y, m - 1, d, h - 8, min, 0));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('publishing window copy — 一律使用「本週」', () => {
  const closedCases: Array<{
    label: string;
    now: Date;
    assetClass: string;
  }> = [
    // TW 台股：星期日=0, 星期一=1, ..., 星期六=6
    { label: 'TW 週六 10:00', now: twDate(2026, 7, 25, 10, 0), assetClass: 'tw_stock' },
    { label: 'TW 週日 15:00', now: twDate(2026, 7, 26, 15, 0), assetClass: 'tw_stock' },
    { label: 'TW 週五 20:30', now: twDate(2026, 7, 24, 20, 30), assetClass: 'tw_stock' },
    { label: 'TW 期貨 週六 09:00', now: twDate(2026, 7, 25, 9, 0), assetClass: 'tw_futures' },
    // US 美股：週日全天 + 週六 08:00 後
    { label: 'US 週日 12:00', now: twDate(2026, 7, 26, 12, 0), assetClass: 'us_stock' },
    { label: 'US 週六 09:00', now: twDate(2026, 7, 25, 9, 0), assetClass: 'us_stock' },
    { label: 'US 期貨 週六 20:00', now: twDate(2026, 7, 25, 20, 0), assetClass: 'us_futures' },
    { label: 'Crypto 週日 03:00', now: twDate(2026, 7, 26, 3, 0), assetClass: 'crypto' },
  ];

  for (const c of closedCases) {
    it(`${c.label}：關窗文案不得包含「下週」`, () => {
      vi.useFakeTimers();
      vi.setSystemTime(c.now);
      const res = isPublishingWindowOpen(c.assetClass);
      expect(res.open).toBe(false);
      expect(res.reason, `reason=${res.reason}`).toBeDefined();
      expect(res.reason!).not.toContain('下週');
    });
  }

  it('關窗文案中若提到「週X 統一開放」須以「本週」為前綴（TW 週末）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(twDate(2026, 7, 25, 10, 0)); // 週六
    const res = isPublishingWindowOpen('tw_stock');
    expect(res.reason).toContain('本週五 20:00 統一開放');
  });

  it('關窗文案中若提到「週X 統一開放」須以「本週」為前綴（US 週六收盤後）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(twDate(2026, 7, 25, 9, 0)); // 週六 09:00
    const res = isPublishingWindowOpen('us_stock');
    expect(res.reason).toContain('本週六 08:00 統一開放');
  });

  it('nextPublishMomentLabel 只講「週X」不冠上「下週」', () => {
    expect(nextPublishMomentLabel('tw_stock')).not.toContain('下週');
    expect(nextPublishMomentLabel('us_stock')).not.toContain('下週');
  });
});

describe('提前發布（force）流程文案不得出現「下週」', () => {
  const root = path.resolve(__dirname, '..', '..', '..');

  it('src/pages/admin/Signals.tsx 內提前發布相關 UI 沒有「下週」字樣', () => {
    const src = fs.readFileSync(path.join(root, 'src/pages/admin/Signals.tsx'), 'utf8');
    const hits = [...src.matchAll(/提前[\s\S]{0,200}/g)].map((m) => m[0]);
    expect(hits.length, '應該找得到「提前」相關文案').toBeGreaterThan(0);
    for (const chunk of hits) {
      expect(chunk, `chunk=${chunk.slice(0, 80)}`).not.toContain('下週');
    }
    // 至少要有一處 UI 明確講「本週」（按鈕文案）
    expect(src).toMatch(/提前開放本週發布/);
  });


  it('publishingWindow.ts 全檔沒有任何「下週」字樣', () => {
    const src = fs.readFileSync(path.join(root, 'src/lib/publishingWindow.ts'), 'utf8');
    expect(src).not.toContain('下週');
  });
});

describe('排程截止後到週一開市前的待發布提示', () => {
  const cases = [
    ['TW 週五 20:00', twDate(2026, 7, 24, 20, 0), 'tw_stock'],
    ['TW 週六', twDate(2026, 7, 25, 10, 0), 'tw_stock'],
    ['TW 週日', twDate(2026, 7, 26, 10, 0), 'tw_stock'],
    ['US 週六 08:00', twDate(2026, 7, 25, 8, 0), 'us_stock'],
    ['US option 週六', twDate(2026, 7, 25, 10, 0), 'us_option'],
    ['週一開市前', twDate(2026, 7, 27, 7, 59), 'us_stock'],
  ] as const;

  for (const [label, now, assetClass] of cases) {
    it(`${label} 有 pending 時主動詢問`, () => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      expect(shouldPromptPendingJournalPublish(assetClass, 1)).toBe(true);
      expect(shouldPromptPendingJournalPublish(assetClass, 0)).toBe(false);
    });
  }

  it('週一 08:00 後不再顯示補發詢問', () => {
    vi.useFakeTimers();
    vi.setSystemTime(twDate(2026, 7, 27, 8, 0));
    expect(shouldPromptPendingJournalPublish('us_stock', 1)).toBe(false);
  });
});

/**
 * Issue 06 回歸補強：後台「撰寫視窗」文案與發布門檻單一來源。
 *
 * 憲法：台股週五 20:00、美股週六 08:00 統一發布。後台文案必須：
 *  1. 由 `publishingWindow` 模組單一來源提供（不得在頁面內硬寫，避免門檻改了文案沒跟著改）
 *  2. 美股文案明寫「週六 08:00」門檻；台股文案明寫「週一~五」撰寫日
 *  3. 不出現「下週」
 */
describe('後台撰寫視窗文案與門檻一致性（issue 06）', () => {
  it('美股文案明寫「週六 08:00」門檻', () => {
    expect(authoringWindowLabel('us_stock')).toContain('週六 08:00');
    expect(authoringWindowLabel('us_futures')).toContain('週六 08:00');
    expect(authoringWindowLabel('us_option')).toContain('週六 08:00');
    expect(authoringWindowLabel('crypto')).toContain('週六 08:00');
  });

  it('台股文案明寫「週一~五」撰寫日', () => {
    expect(authoringWindowLabel('tw_stock')).toContain('週一~五');
    expect(authoringWindowLabel('tw_futures')).toContain('週一~五');
  });

  it('文案不得出現「下週」', () => {
    expect(authoringWindowLabel('us_stock')).not.toContain('下週');
    expect(authoringWindowLabel('tw_stock')).not.toContain('下週');
  });

  it('Signals.tsx 後台文案由模組提供，不得硬寫撰寫視窗字串', () => {
    const root = path.resolve(__dirname, '..', '..', '..');
    const src = fs.readFileSync(path.join(root, 'src/pages/admin/Signals.tsx'), 'utf8');
    expect(src).toContain('authoringWindowLabel');
    expect(src).toMatch(/import\s*\{[^}]*authoringWindowLabel[^}]*\}\s*from\s*'@\/lib\/publishingWindow'/);
    expect(src).not.toContain("'週一~週六 08:00 前撰寫'");
    expect(src).not.toContain("'週一~五撰寫'");
  });
});
