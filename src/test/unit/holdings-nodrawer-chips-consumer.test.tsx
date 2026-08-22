/**
 * Stage 3B / S3B-0 RED test — 不開抽屜也要看得到 BSR 狀態（真有 consumer 訂閱）
 *
 * 契約（v4.1 §S3B-D）：
 *   1. 持倉卡片（HoldingCard）本身必須訂閱 chips 快取（chipsQueryKey / useChipsCard），
 *      不能只有抽屜（HoldingsDetailPanel）才是 consumer。
 *   2. 卡片必須渲染 data-testid="holding-card-bsr" 與 data-bsr-state / data-bsr-as-of，
 *      terminal 時顯示「不支援」與最後可得日期，不得留白。
 *
 * 目前預期 RED，失敗點：HoldingCard 完全沒有 chips 訂閱與 holding-card-bsr 節點，
 * 唯一 consumer 是 HoldingsWorkbench 的 useChipsBatch（只寫入快取，不渲染）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function src(rel: string): string {
  try { return readFileSync(resolve(process.cwd(), rel), 'utf8'); } catch { return ''; }
}

const CARD = src('src/checkup/components/freecheckup/HoldingCard.tsx');
const HEADER = src('src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardHeader.tsx');
const FOOTER = src('src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardFooter.tsx');
const CARD_TREE = [CARD, HEADER, FOOTER].join('\n');

describe('S3B RED · 卡片層（無抽屜）必須是 chips consumer', () => {
  it('卡片樹必須訂閱 chips 快取', () => {
    const subscribes = /chipsQueryKey|useTwChipsDetail|useChipsCard|useChipsSummary/.test(CARD_TREE);
    expect(subscribes, 'RED: HoldingCard 樹沒有任何 chips 訂閱，未開抽屜就完全沒有 BSR 資訊').toBe(true);
  });

  it('卡片必須渲染 holding-card-bsr 契約節點', () => {
    expect(
      CARD_TREE.includes('holding-card-bsr'),
      'RED: 找不到 data-testid="holding-card-bsr"',
    ).toBe(true);
    expect(
      /data-bsr-state/.test(CARD_TREE),
      'RED: 找不到 data-bsr-state（e2e 無法斷言不可用狀態）',
    ).toBe(true);
    expect(
      /data-bsr-as-of/.test(CARD_TREE),
      'RED: 找不到 data-bsr-as-of（無法顯示最後可得日期）',
    ).toBe(true);
  });

  it('terminal 文案不得留白', () => {
    expect(
      /不支援|目前不可用/.test(CARD_TREE),
      'RED: 卡片沒有 terminal 文案（不支援／目前不可用）',
    ).toBe(true);
  });
});
