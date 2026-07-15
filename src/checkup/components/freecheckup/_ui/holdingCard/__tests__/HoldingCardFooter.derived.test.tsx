/**
 * HoldingCardFooter — 派生計算單元測試。
 * 覆蓋：srcLabel / srcTitle / srcBadge / errBadge / valueStr / tgtStr / todayNode 分支
 *      + 樣式 useMemo 引用穩定性（priceTick 不重建 containerStyle）。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HoldingCardFooter from '../HoldingCardFooter';
import { WB } from '@/pages/_freeCheckup/constants.jsx';

const base = {
  h: { value: 123456, price: 100 },
  tp: null,
  upside: null,
  hasToday: false,
  todayPnlNum: null,
  todayPctNum: null,
  variant: 'normal' as const,
  subColor: '#333',
  muteColor: '#888',
  hairColor: '#eee',
  lossColor: '#8A857F',
};

// 直接取 VALUE 標頭的 badge <span>
const getBadge = (container: HTMLElement, text: string): HTMLElement | null => {
  const spans = Array.from(container.querySelectorAll('span')) as HTMLElement[];
  return spans.find((s) => s.textContent === text) ?? null;
};

describe('HoldingCardFooter — srcLabel 派生', () => {
  it.each([
    ['live', '即時'],
    ['screenshot', '截圖'],
    ['high', '最高'],
    ['ask', '賣一'],
    ['yclose', '昨收'],
    ['demo', 'DEMO'],
    ['regularMarketPrice', '收盤'],
    ['previousClose', '昨收'],
    ['chartClose', '已收K'],
    ['twse', 'TWSE'],
    ['yahoo', 'Yahoo'],
  ])('priceSource=%s → %s', (src, label) => {
    render(<HoldingCardFooter {...base} h={{ ...base.h, priceSource: src }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('未知 priceSource 落 fallback 原字串', () => {
    render(<HoldingCardFooter {...base} h={{ ...base.h, priceSource: 'weird_src' }} />);
    expect(screen.getByText('weird_src')).toBeInTheDocument();
  });

  it('無 priceSource 時不渲染 srcLabel badge', () => {
    const { container } = render(<HoldingCardFooter {...base} />);
    // VALUE 標頭應該無附屬 badge
    expect(getBadge(container, '即時')).toBeNull();
    expect(getBadge(container, '截圖')).toBeNull();
  });
});

describe('HoldingCardFooter — srcTitle 派生（tooltip）', () => {
  it('priceError 存在時 title 為「報價問題：<err>」，其餘欄位不參與', () => {
    const { container } = render(
      <HoldingCardFooter
        {...base}
        h={{
          ...base.h,
          priceSource: 'live',
          priceError: 'timeout',
          priceUpdatedAt: '2026-01-01T00:00:00Z',
          yesterday: 90,
        }}
      />,
    );
    const badge = getBadge(container, '即時')!;
    expect(badge.getAttribute('title')).toBe('報價問題：timeout');
  });

  it('無 priceSource + 無 error → 顯示於 errBadge（此路徑走 srcTitle=空源提示）', () => {
    render(<HoldingCardFooter {...base} h={{ ...base.h, priceError: 'net' }} />);
    const err = screen.getByText('失敗');
    expect(err.getAttribute('title')).toBe('net');
  });

  it('組合 priceUpdatedAt / yesterday / price 以全形空格連接', () => {
    const iso = '2026-06-15T02:30:00Z';
    const { container } = render(
      <HoldingCardFooter
        {...base}
        h={{
          ...base.h,
          priceSource: 'live',
          priceUpdatedAt: iso,
          yesterday: 95,
          price: 101.234,
        }}
      />,
    );
    const badge = getBadge(container, '即時')!;
    const title = badge.getAttribute('title') || '';
    expect(title).toContain('來源：即時（live）');
    expect(title).toContain('更新於');
    expect(title).toContain('昨收 95.00');
    expect(title).toContain('現價 101.23');
    // 分隔符為全形空格
    expect(title.split('　').length).toBe(4);
  });

  it('yesterday=null / price=NaN 時該段落略過', () => {
    const { container } = render(
      <HoldingCardFooter
        {...base}
        h={{
          ...base.h,
          priceSource: 'live',
          price: NaN,
        }}
      />,
    );
    const badge = getBadge(container, '即時')!;
    const title = badge.getAttribute('title') || '';
    expect(title).toBe('來源：即時（live）');
  });

  it('僅 priceSource=null 但 error=null → title 為「尚未同步即時報價」（未渲染 srcBadge，故走 errBadge 路徑不會觸發此字串；驗證 badge 不存在）', () => {
    const { container } = render(<HoldingCardFooter {...base} />);
    expect(container.querySelector('[title="尚未同步即時報價"]')).toBeNull();
  });
});

describe('HoldingCardFooter — srcBadge / errBadge 樣式派生', () => {
  // WB.accent = #FF4D1F → rgb(255, 77, 31)
  const ACCENT_RGB = 'rgba(255, 77, 31,';

  it('normal + live → 前景 WB.accent、背景 alpha(WB.accent, 22)', () => {
    const { container } = render(
      <HoldingCardFooter {...base} h={{ ...base.h, priceSource: 'live' }} />,
    );
    const badge = getBadge(container, '即時')!;
    const style = badge.getAttribute('style') || '';
    expect(style).toContain(`background: ${ACCENT_RGB}`);
    expect(style).toContain('color: rgb(255, 77, 31)');
    expect(style).toContain('opacity: 0.85');
  });

  it('normal + screenshot → 背景 alpha(muteColor, 18)', () => {
    const { container } = render(
      <HoldingCardFooter
        {...base}
        h={{ ...base.h, priceSource: 'screenshot' }}
        muteColor="#ABCDEF"
      />,
    );
    const badge = getBadge(container, '截圖')!;
    const style = badge.getAttribute('style') || '';
    expect(style).toContain('background: rgba(171, 205, 239,');
    // 前景色為 subColor
    expect(style).toContain('color: rgb(51, 51, 51)');
  });

  it('normal + 其他來源 → 背景 alpha(lossColor, 22)', () => {
    const { container } = render(
      <HoldingCardFooter
        {...base}
        h={{ ...base.h, priceSource: 'ask' }}
        lossColor="#112233"
      />,
    );
    const badge = getBadge(container, '賣一')!;
    expect(badge.getAttribute('style') || '').toContain('background: rgba(17, 34, 51,');
  });

  it('ink + live → 背景 alpha(WB.accent, 30)、色 WB.accent、opacity 0.9', () => {
    const { container } = render(
      <HoldingCardFooter {...base} variant="ink" h={{ ...base.h, priceSource: 'live' }} />,
    );
    const badge = getBadge(container, '即時')!;
    const style = badge.getAttribute('style') || '';
    expect(style).toContain(`background: ${ACCENT_RGB}`);
    expect(style).toContain('color: rgb(255, 77, 31)');
    expect(style).toContain('opacity: 0.9');
  });

  it('ink + 非 live → 背景 rgba(244,241,236,0.…)、色 rgba(244,241,236,0.85)', () => {
    const { container } = render(
      <HoldingCardFooter
        {...base}
        variant="ink"
        h={{ ...base.h, priceSource: 'screenshot' }}
      />,
    );
    const badge = getBadge(container, '截圖')!;
    const style = (badge.getAttribute('style') || '').replace(/\s+/g, '');
    expect(style).toContain('background:rgba(244,241,236,');
    expect(style).toContain('color:rgba(244,241,236,0.85)');
  });

  it('normal errBadge → 背景 alpha(lossColor, 22)、色 lossColor', () => {
    const { container } = render(
      <HoldingCardFooter
        {...base}
        h={{ ...base.h, priceError: 'boom' }}
        lossColor="#445566"
      />,
    );
    const err = getBadge(container, '失敗')!;
    const style = err.getAttribute('style') || '';
    expect(style).toContain('background: rgba(68, 85, 102,');
    expect(style).toContain('color: rgb(68, 85, 102)');
  });

  it('ink errBadge → 背景 rgba(244,241,236,0.12)、色 rgba(244,241,236,0.65)', () => {
    const { container } = render(
      <HoldingCardFooter
        {...base}
        variant="ink"
        h={{ ...base.h, priceError: 'boom' }}
      />,
    );
    const err = getBadge(container, '失敗')!;
    const style = (err.getAttribute('style') || '').replace(/\s+/g, '');
    expect(style).toContain('rgba(244,241,236,0.12)');
    expect(style).toContain('rgba(244,241,236,0.65)');
  });
});

describe('HoldingCardFooter — valueStr / tgtStr / todayNode 派生', () => {
  it('valueStr 使用 toLocaleString', () => {
    render(<HoldingCardFooter {...base} h={{ value: 1234567, price: 1 }} />);
    expect(screen.getByText('1,234,567')).toBeInTheDocument();
  });

  it('value=null → —', () => {
    const { container } = render(
      <HoldingCardFooter {...base} h={{ value: null, price: 1 }} />,
    );
    const vals = container.querySelectorAll('.wb-bottom-val');
    expect(vals[1]?.textContent).toBe('—');
  });

  it('value=0 → 因 `||` fallback 判定為 falsy 前的 toLocaleString="0"（truthy）→ 顯示 "0"', () => {
    const { container } = render(
      <HoldingCardFooter {...base} h={{ value: 0, price: 1 }} />,
    );
    const vals = container.querySelectorAll('.wb-bottom-val');
    expect(vals[1]?.textContent).toBe('0');
  });

  it('tgtStr: ink + tp + upside≥0 → "TGT +X.X%"', () => {
    const { container } = render(
      <HoldingCardFooter {...base} variant="ink" tp={200} upside={12.36} />,
    );
    expect(container.textContent).toContain('TGT +12.4%');
  });

  it('tgtStr: ink + upside<0 → 保留負號', () => {
    const { container } = render(
      <HoldingCardFooter {...base} variant="ink" tp={80} upside={-3.14} />,
    );
    expect(container.textContent).toContain('TGT -3.1%');
  });

  it('tgtStr: ink + tp=null → 不渲染', () => {
    const { container } = render(
      <HoldingCardFooter {...base} variant="ink" tp={null} upside={5} />,
    );
    expect(container.textContent).not.toContain('TGT');
  });

  it('tgtStr: ink + upside=null → 不渲染', () => {
    const { container } = render(
      <HoldingCardFooter {...base} variant="ink" tp={200} upside={null} />,
    );
    expect(container.textContent).not.toContain('TGT');
  });

  it('tgtStr: normal + tp + upside → 不渲染（僅 ink）', () => {
    const { container } = render(
      <HoldingCardFooter {...base} tp={200} upside={5} />,
    );
    expect(container.textContent).not.toContain('TGT');
  });

  it('todayNode: hasToday=true 但 todayPnlNum=null → —（pnl 段）；pct 為 null 不渲染百分比', () => {
    const { container } = render(
      <HoldingCardFooter {...base} hasToday todayPnlNum={null} todayPctNum={null} />,
    );
    const today = container.querySelectorAll('.wb-bottom-val')[0]!;
    expect(today.textContent).toBe('—');
  });

  it('todayNode: pnl>=0 帶 + 號、pct=null 不渲染百分比', () => {
    const { container } = render(
      <HoldingCardFooter {...base} hasToday todayPnlNum={1000} todayPctNum={null} />,
    );
    const today = container.querySelectorAll('.wb-bottom-val')[0]!;
    expect(today.textContent).toBe('+1,000');
  });

  it('todayNode: pnl=0 也帶 + 號', () => {
    const { container } = render(
      <HoldingCardFooter {...base} hasToday todayPnlNum={0} todayPctNum={0} />,
    );
    const today = container.querySelectorAll('.wb-bottom-val')[0]!;
    expect(today.textContent).toBe('+0+0.00%');
  });

  it('todayNode: pnl<0 無 +、pct<0 保留負號', () => {
    const { container } = render(
      <HoldingCardFooter {...base} hasToday todayPnlNum={-1234} todayPctNum={-5.678} />,
    );
    const today = container.querySelectorAll('.wb-bottom-val')[0]!;
    expect(today.textContent).toBe('-1,234-5.68%');
  });
});

describe('HoldingCardFooter — 樣式 useMemo 引用穩定', () => {
  it('僅 todayPnlNum 變動時，containerStyle / valCellStyle 不重建（style 屬性字串不變）', () => {
    const { container, rerender } = render(
      <HoldingCardFooter {...base} hasToday todayPnlNum={100} todayPctNum={1} />,
    );
    const bottom = container.querySelector('.wb-bottom') as HTMLElement;
    const val = container.querySelector('.wb-bottom-val') as HTMLElement;
    const bottomStyle1 = bottom.getAttribute('style');
    const valStyle1 = val.getAttribute('style');

    rerender(
      <HoldingCardFooter {...base} hasToday todayPnlNum={999} todayPctNum={9.9} />,
    );
    const bottom2 = container.querySelector('.wb-bottom') as HTMLElement;
    const val2 = container.querySelector('.wb-bottom-val') as HTMLElement;
    expect(bottom2.getAttribute('style')).toBe(bottomStyle1);
    expect(val2.getAttribute('style')).toBe(valStyle1);
  });

  it('variant normal → ink 時，containerStyle 的 columnGap 12 → 16', () => {
    const { container, rerender } = render(<HoldingCardFooter {...base} />);
    const b1 = container.querySelector('.wb-bottom') as HTMLElement;
    expect(b1.getAttribute('style')).toContain('column-gap: 12px');
    rerender(<HoldingCardFooter {...base} variant="ink" />);
    const b2 = container.querySelector('.wb-bottom') as HTMLElement;
    expect(b2.getAttribute('style')).toContain('column-gap: 16px');
  });
});
