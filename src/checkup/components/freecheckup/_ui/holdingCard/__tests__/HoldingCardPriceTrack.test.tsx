import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import HoldingCardPriceTrack from '../HoldingCardPriceTrack';

const base = {
  h: { cost: 100, price: 123.4567 },
  meta: null,
  dec: null,
  subColor: '#333',
  muteColor: '#888',
  variant: 'normal' as const,
};

describe('HoldingCardPriceTrack', () => {
  it('渲染成本→現價、兩位小數', () => {
    const { container } = render(<HoldingCardPriceTrack {...base} />);
    const txt = container.textContent || '';
    expect(txt).toContain('成本');
    expect(txt).toContain('100.00');
    expect(txt).toContain('→');
    expect(txt).toContain('現價');
    expect(txt).toContain('123.46');
  });

  it('cost / price 為 null 時顯示 —', () => {
    const { container } = render(
      <HoldingCardPriceTrack {...base} h={{ cost: null, price: null }} />
    );
    const txt = container.textContent || '';
    // 兩個 —（成本 + 現價）
    const dashCount = (txt.match(/—/g) || []).length;
    expect(dashCount).toBeGreaterThanOrEqual(2);
  });

  it('dec.actionText 存在時取代 strategy fallback', () => {
    const { container } = render(
      <HoldingCardPriceTrack
        {...base}
        dec={{ actionText: '維持持有，觀察下週法說。' }}
        meta={{ strategy: 'STRAT' }}
      />
    );
    expect(container.textContent).toContain('維持持有，觀察下週法說。');
    expect(container.textContent).not.toContain('STRAT');
  });

  it('actionText 超過長度限制時以句號邊界截斷並補 …', () => {
    // normal variant limit=60；建構一段 > 60 字且含句號的中文字串
    const long = '第一句話結束。' + 'A'.repeat(80);
    const { container } = render(
      <HoldingCardPriceTrack {...base} dec={{ actionText: long }} />
    );
    expect(container.textContent).toContain('第一句話結束。…');
  });

  it('無 dec 且無 strategy 時 fallback 為空字串（normal）', () => {
    const { container } = render(<HoldingCardPriceTrack {...base} />);
    // 決策容器內容為空（不影響版面）
    const decDiv = container.querySelector('div[style*="line-height"]');
    // 保險起見只檢查沒有多餘 tokens
    expect((container.textContent || '')).not.toContain('持續監控');
    expect(decDiv).not.toBeNull();
  });

  it('ink variant 無 dec 時 fallback 為預設決策文字', () => {
    const { container } = render(
      <HoldingCardPriceTrack {...base} variant="ink" />
    );
    expect(container.textContent).toContain('持續監控基本面與籌碼變動。');
  });
});
