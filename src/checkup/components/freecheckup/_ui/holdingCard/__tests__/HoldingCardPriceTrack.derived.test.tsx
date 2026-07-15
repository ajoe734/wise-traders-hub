/**
 * HoldingCardPriceTrack — 派生計算單元測試。
 * 覆蓋：costStr / priceStr / decText / truncateAction 分支 / 樣式 useMemo 引用穩定性。
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import HoldingCardPriceTrack from '../HoldingCardPriceTrack';

const baseProps = {
  h: { cost: 100, price: 123.4567 },
  meta: null,
  dec: null,
  subColor: '#333',
  muteColor: '#888',
  variant: 'normal' as const,
};

// 讀取「成本→現價」列的節點順序：labels + values
const readRow = (container: HTMLElement) => {
  const row = container.querySelector('div[style*="baseline"]') as HTMLElement;
  return Array.from(row.querySelectorAll('span')).map((s) => s.textContent);
};

const readDecDiv = (container: HTMLElement) =>
  container.querySelector('div[style*="line-height"]') as HTMLElement;

describe('HoldingCardPriceTrack — costStr / priceStr 派生', () => {
  it('正常數字 → toFixed(2)', () => {
    const { container } = render(<HoldingCardPriceTrack {...baseProps} />);
    const spans = readRow(container);
    expect(spans).toEqual(['成本', '100.00', '→', '現價', '123.46']);
  });

  it('cost=0 顯示 0.00（不落入 —）', () => {
    const { container } = render(
      <HoldingCardPriceTrack {...baseProps} h={{ cost: 0, price: 10 }} />,
    );
    expect(readRow(container)).toEqual(['成本', '0.00', '→', '現價', '10.00']);
  });

  it('負數 cost / price 保留負號', () => {
    const { container } = render(
      <HoldingCardPriceTrack {...baseProps} h={{ cost: -5, price: -1.234 }} />,
    );
    expect(readRow(container)).toEqual(['成本', '-5.00', '→', '現價', '-1.23']);
  });

  it('cost=null 顯示 —；price 有值不受影響', () => {
    const { container } = render(
      <HoldingCardPriceTrack {...baseProps} h={{ cost: null, price: 50 }} />,
    );
    expect(readRow(container)).toEqual(['成本', '—', '→', '現價', '50.00']);
  });

  it('price=null 顯示 —；cost 有值不受影響', () => {
    const { container } = render(
      <HoldingCardPriceTrack {...baseProps} h={{ cost: 50, price: null }} />,
    );
    expect(readRow(container)).toEqual(['成本', '50.00', '→', '現價', '—']);
  });

  it('字串型別數字仍可 Number(x).toFixed(2)', () => {
    const { container } = render(
      <HoldingCardPriceTrack {...baseProps} h={{ cost: '88.888', price: '.5' }} />,
    );
    expect(readRow(container)).toEqual(['成本', '88.89', '→', '現價', '0.50']);
  });

  it('大數千位不加逗號（toFixed 純小數格式）', () => {
    const { container } = render(
      <HoldingCardPriceTrack {...baseProps} h={{ cost: 1234567, price: 9999.9 }} />,
    );
    expect(readRow(container)).toEqual([
      '成本', '1234567.00', '→', '現價', '9999.90',
    ]);
  });
});

describe('HoldingCardPriceTrack — decText 派生分支', () => {
  it('normal + dec.actionText 未超過 60 → 原字串', () => {
    const txt = '維持持有，觀察下週法說。';
    const { container } = render(
      <HoldingCardPriceTrack {...baseProps} dec={{ actionText: txt }} />,
    );
    expect(readDecDiv(container).textContent).toBe(txt);
  });

  it('normal + actionText > 60 且含句號 → 於最後標點截斷 + …', () => {
    const long = '第一句話結束。' + 'A'.repeat(80);
    const { container } = render(
      <HoldingCardPriceTrack {...baseProps} dec={{ actionText: long }} />,
    );
    expect(readDecDiv(container).textContent).toBe('第一句話結束。…');
  });

  it('normal + actionText > 60 且無標點 → head.slice(0, 58) + …', () => {
    const long = 'A'.repeat(120);
    const { container } = render(
      <HoldingCardPriceTrack {...baseProps} dec={{ actionText: long }} />,
    );
    expect(readDecDiv(container).textContent).toBe('A'.repeat(58) + '…');
  });

  it('ink + actionText > 90 → limit 提高到 90', () => {
    const long = 'B'.repeat(200);
    const { container } = render(
      <HoldingCardPriceTrack {...baseProps} variant="ink" dec={{ actionText: long }} />,
    );
    expect(readDecDiv(container).textContent).toBe('B'.repeat(88) + '…');
  });

  it('normal + 無 dec 且無 strategy → 空字串', () => {
    const { container } = render(<HoldingCardPriceTrack {...baseProps} />);
    expect(readDecDiv(container).textContent).toBe('');
  });

  it('normal + 無 dec 但有 strategy → strategy.slice(0, 40)', () => {
    const strat = 'S'.repeat(100);
    const { container } = render(
      <HoldingCardPriceTrack {...baseProps} meta={{ strategy: strat }} />,
    );
    expect(readDecDiv(container).textContent).toBe('S'.repeat(40));
  });

  it('normal + 無 dec + strategy 短於 40 → 完整保留', () => {
    const { container } = render(
      <HoldingCardPriceTrack {...baseProps} meta={{ strategy: '短策略' }} />,
    );
    expect(readDecDiv(container).textContent).toBe('短策略');
  });

  it('ink + 無 dec + 無 strategy → 使用預設決策文字', () => {
    const { container } = render(
      <HoldingCardPriceTrack {...baseProps} variant="ink" />,
    );
    expect(readDecDiv(container).textContent).toBe('持續監控基本面與籌碼變動。');
  });

  it('ink + 無 dec + 有 strategy → 用 strategy 而非預設', () => {
    const { container } = render(
      <HoldingCardPriceTrack {...baseProps} variant="ink" meta={{ strategy: 'INK-STRAT' }} />,
    );
    expect(readDecDiv(container).textContent).toBe('INK-STRAT');
  });

  it('dec.actionText 優先於 strategy（不論長度）', () => {
    const { container } = render(
      <HoldingCardPriceTrack
        {...baseProps}
        dec={{ actionText: 'ACT' }}
        meta={{ strategy: 'STRAT' }}
      />,
    );
    expect(readDecDiv(container).textContent).toBe('ACT');
  });

  it('truncateAction 邊界：長度等於 limit 不截斷', () => {
    const s = 'X'.repeat(60);
    const { container } = render(
      <HoldingCardPriceTrack {...baseProps} dec={{ actionText: s }} />,
    );
    expect(readDecDiv(container).textContent).toBe(s);
  });
});

describe('HoldingCardPriceTrack — 樣式 useMemo 引用穩定', () => {
  it('僅 h.price / h.cost 變動時，rowStyle 與 decWrapStyle 引用不重建（DOM style 屬性字串不變）', () => {
    const { container, rerender } = render(<HoldingCardPriceTrack {...baseProps} />);
    const row1 = container.querySelector('div[style*="baseline"]') as HTMLElement;
    const dec1 = readDecDiv(container);
    const rowStyle1 = row1.getAttribute('style');
    const decStyle1 = dec1.getAttribute('style');

    rerender(
      <HoldingCardPriceTrack {...baseProps} h={{ cost: 200, price: 999.99 }} />,
    );
    const row2 = container.querySelector('div[style*="baseline"]') as HTMLElement;
    const dec2 = readDecDiv(container);
    expect(row2.getAttribute('style')).toBe(rowStyle1);
    expect(dec2.getAttribute('style')).toBe(decStyle1);
  });

  it('variant 切換 normal → ink 時，rowStyle marginBottom 從 8 → 10', () => {
    const { container, rerender } = render(<HoldingCardPriceTrack {...baseProps} />);
    const row1 = container.querySelector('div[style*="baseline"]') as HTMLElement;
    expect(row1.getAttribute('style')).toContain('margin-bottom: 8px');
    rerender(<HoldingCardPriceTrack {...baseProps} variant="ink" />);
    const row2 = container.querySelector('div[style*="baseline"]') as HTMLElement;
    expect(row2.getAttribute('style')).toContain('margin-bottom: 10px');
  });

  it('subColor 變動時 rowStyle.color 同步；muteColor 變動時 labelStyle.color 同步', () => {
    const { container, rerender } = render(<HoldingCardPriceTrack {...baseProps} />);
    rerender(<HoldingCardPriceTrack {...baseProps} subColor="#111" muteColor="#999" />);
    const row = container.querySelector('div[style*="baseline"]') as HTMLElement;
    expect(row.getAttribute('style')).toContain('color: rgb(17, 17, 17)');
    const label = row.querySelector('span') as HTMLElement;
    expect(label.getAttribute('style')).toContain('color: rgb(153, 153, 153)');
  });
});
