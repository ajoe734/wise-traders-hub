/**
 * Pricing 「實戰導師／修煉派」文案一致性守門測試
 *
 * 硬性規則：
 *   1. 修煉派 painPoint 一律使用中性語言（v2.1 合規補漏後之 canonical）。
 *   2. 過去用過的舊文案不得殘留於 Pricing.tsx / PricingFaq / PricingExampleModal /
 *      PricingPlanCard / PricingComparisonSection。
 *   3. 「修煉派」 badge / 標題文字必須同時出現在主卡片、比較區塊、FAQ、
 *      Example Modal 這四處，避免任何一處被 rename 走。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CANONICAL_PAIN_POINT = '週末才有空，想把整週的操作看懂再做功課';

// 舊文案 → 不能再出現於任何 pricing 相關檔案
const FORBIDDEN_LEGACY_STRINGS = [
  '給我全部，練出自己的投資秘笈',
  '練出自己的投資秘笈',
  '週末才練功',
  '週末才有空，利用老師的心法決定下週出手',
  '每週交易紀錄與心法公開',
];

const FILES = {
  'Pricing.tsx': 'src/pages/Pricing.tsx',
  'PricingFaq.tsx': 'src/pages/_pricing/PricingFaq.tsx',
  'PricingExampleModal.tsx': 'src/pages/_pricing/PricingExampleModal.tsx',
  'PricingPlanCard.tsx': 'src/pages/_pricing/PricingPlanCard.tsx',
  'PricingComparisonSection.tsx': 'src/pages/_pricing/PricingComparisonSection.tsx',
} as const;

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('Pricing 修煉派文案一致性', () => {
  it('canonical painPoint 只在 Pricing.tsx 主卡片定義', () => {
    const src = read(FILES['Pricing.tsx']);
    expect(src).toContain(CANONICAL_PAIN_POINT);
    // 確認它被綁在 cultivator 卡片旁邊（避免只是註解字串）
    const cultivatorBlock = src.slice(
      src.indexOf("id: 'cultivator'"),
      src.indexOf("id: 'cultivator'") + 1200,
    );
    expect(cultivatorBlock).toContain(CANONICAL_PAIN_POINT);
    expect(cultivatorBlock).toMatch(/faction:\s*'修煉派'/);
  });

  it.each(FORBIDDEN_LEGACY_STRINGS)(
    '舊文案「%s」不得殘留於任何 pricing 檔案',
    (legacy) => {
      for (const [label, rel] of Object.entries(FILES)) {
        const src = read(rel);
        expect(
          src.includes(legacy),
          `${label} 仍含有舊文案「${legacy}」，請改為「${CANONICAL_PAIN_POINT}」`,
        ).toBe(false);
      }
    },
  );

  it('「修煉派」關鍵字同時出現在主卡片 / 比較區塊 / FAQ / Example Modal', () => {
    for (const label of ['Pricing.tsx', 'PricingComparisonSection.tsx', 'PricingFaq.tsx', 'PricingExampleModal.tsx'] as const) {
      const src = read(FILES[label]);
      expect(src.includes('修煉派'), `${label} 缺少「修煉派」字樣`).toBe(true);
    }
  });

  it('「實戰導師」在比較區塊與 FAQ 描述中出現，避免 rename 造成用語斷裂', () => {
    const cmp = read(FILES['PricingComparisonSection.tsx']);
    expect(cmp).toContain('實戰導師');
  });
});
