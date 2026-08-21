/**
 * /pricing 契約測試（v2.1 補漏輪）：
 *  1) 手機不得再有 absolute 疊卡 carousel（單欄 document flow）。
 *  2) mentor 相關文案不得出現禁用字／矛盾舊語。
 *  3) FAQ 健檢資格必須與同頁 verified contract 一致（可獨立訂閱）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const PRICING = read('src/pages/Pricing.tsx');
const CARD = read('src/pages/_pricing/PricingPlanCard.tsx');
const COMPARISON = read('src/pages/_pricing/PricingComparisonSection.tsx');
const FAQ = read('src/pages/_pricing/PricingFaq.tsx');
const MODAL = read('src/pages/_pricing/PricingExampleModal.tsx');
const CHECKUP = read('src/pages/_pricing/CheckupPlansSection.tsx');

const ALL = [PRICING, CARD, COMPARISON, FAQ, MODAL];

describe('pricing mobile layout', () => {
  it('移除 carousel：無 absolute 疊卡 / translateZ / rotateY / swipe', () => {
    for (const token of [
      'absolute inset-x-0 mx-auto',
      'translateZ',
      'rotateY',
      'handleSwipe',
      'mobileSelectedIndex',
      'animate-swipe-hint',
      'perspective',
    ]) {
      expect(PRICING).not.toContain(token);
    }
  });

  it('方案區為 grid-cols-1 → md:grid-cols-2 的正常 flow', () => {
    expect(PRICING).toContain('grid grid-cols-1 md:grid-cols-2');
    expect(PRICING).toContain('data-testid="pricing-plan-grid"');
  });

  it('不得用 overflow-x hidden/clip 遮蔽溢出', () => {
    for (const s of ALL) {
      expect(s).not.toMatch(/overflow-x-(hidden|clip)/);
    }
  });
});

describe('pricing mentor copy compliance', () => {
  const BANNED = ['下週出手', 'T+7', '保證', '目標價'];

  it('/pricing 文案不得含禁用字或 T+7 絕對化', () => {
    for (const s of ALL) {
      for (const b of BANNED) expect(s).not.toContain(b);
    }
  });

  it('mentor 不得被寫成跟單（跟單只能出現在 advisor 品牌名脈絡）', () => {
    expect(CARD).not.toContain('跟單');
    // 修煉派描述行不得出現「跟單」
    for (const line of COMPARISON.split('\n')) {
      if (line.includes('cultivator:')) expect(line).not.toContain('跟單');
    }
  });

  it('mentor 使用中性交付語言', () => {
    expect(PRICING).toContain('當週操作復盤＋下週觀察框架');
    expect(PRICING).toContain('下週研究清單與觀察條件');
    expect(COMPARISON).toContain('當週操作復盤');
  });
});

describe('pricing FAQ 一致性', () => {
  it('健檢可獨立訂閱，不要求跟單派訂閱有效', () => {
    expect(FAQ).toContain('可獨立訂閱');
    expect(FAQ).not.toContain('跟單派訂閱還在有效期間');
    expect(CHECKUP).toContain('可獨立訂閱');
  });

  it('LINE 通知不得同頁自相矛盾', () => {
    expect(FAQ).not.toContain('未來我們將支援 LINE 推播');
    expect(FAQ).toContain('LINE 推播');
  });
});
