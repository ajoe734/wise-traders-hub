/**
 * HoldingCardHeader — 效能回歸
 *
 * 憲法：
 *  - Sparkline 派生 props（color/opacity）以 `pctSign` 為 memo key，
 *    現價於同一方向抖動（pctVal 變動但不跨零）時，props 引用必須維持穩定，
 *    Sparkline (React.memo) 不應重繪。
 *  - 跨零（正↔負）才允許重新計算並重繪一次。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memo } from 'react';
import { render } from '@testing-library/react';
import { resetRenderStats } from '@/checkup/hooks/useRenderCounter';

// 以 spy 版 Sparkline 取代真實元件，計算實際 render 次數
const sparkRenderSpy = vi.fn();
vi.mock('@/pages/_freeCheckup/constants.jsx', async () => {
  const actual = await vi.importActual<any>('@/pages/_freeCheckup/constants.jsx');
  const SpySparkline = memo(function SpySparkline(props: any) {
    sparkRenderSpy(props);
    return <svg data-testid="spy-spark" data-color={props.color} data-opacity={props.opacity} />;
  });
  return { ...actual, Sparkline: SpySparkline };
});

// mock 完再 import 元件，確保吃到 mock
const { default: HoldingCardHeader } = await import('../HoldingCardHeader');

const baseProps = {
  h: { code: '2330', name: '台積電', qty: 1000, unit: '股' },
  meta: null,
  onReportMeta: undefined,
  variant: 'normal' as const,
  cardColor: '#000',
  muteColor: '#888',
  sparkData: [1, 2, 3, 4, 5],
  sparkFailed: false,
  actionLabel: 'HOLD',
  pctVal: 5,
};

describe('HoldingCardHeader — Sparkline 效能回歸', () => {
  beforeEach(() => {
    // 清掉 dev-only render counter；跨 it 累積會觸發 warn 噪音
    resetRenderStats();
    sparkRenderSpy.mockClear();
  });
  it('pctVal 在同號區間變動（不跨零）時，Sparkline props 引用穩定且不重繪', () => {
    sparkRenderSpy.mockClear();
    const { rerender } = render(<HoldingCardHeader {...baseProps} pctVal={5} />);
    expect(sparkRenderSpy).toHaveBeenCalledTimes(1);
    const first = sparkRenderSpy.mock.calls[0][0];

    // 正 → 正：多次 tick，色/透明度物件應同一引用，memo 命中不重繪
    rerender(<HoldingCardHeader {...baseProps} pctVal={5.01} />);
    rerender(<HoldingCardHeader {...baseProps} pctVal={12.4} />);
    rerender(<HoldingCardHeader {...baseProps} pctVal={0.001} />);
    expect(sparkRenderSpy).toHaveBeenCalledTimes(1);

    // sparkData 引用未變 → 亦不應觸發
    rerender(<HoldingCardHeader {...baseProps} pctVal={8} />);
    expect(sparkRenderSpy).toHaveBeenCalledTimes(1);

    // 驗證第一次的 color/opacity 為正號分支
    expect(first.color).toBeTruthy();
    expect(first.opacity).toBeCloseTo(0.85);
  });

  it('負→負 區間變動亦不重繪', () => {
    sparkRenderSpy.mockClear();
    const { rerender } = render(<HoldingCardHeader {...baseProps} pctVal={-2} />);
    expect(sparkRenderSpy).toHaveBeenCalledTimes(1);
    rerender(<HoldingCardHeader {...baseProps} pctVal={-2.5} />);
    rerender(<HoldingCardHeader {...baseProps} pctVal={-10} />);
    expect(sparkRenderSpy).toHaveBeenCalledTimes(1);
  });

  it('跨零（負→正）時允許重繪一次，且顏色/透明度切換', () => {
    sparkRenderSpy.mockClear();
    const { rerender } = render(<HoldingCardHeader {...baseProps} pctVal={-3} />);
    const negCall = sparkRenderSpy.mock.calls[0][0];
    expect(sparkRenderSpy).toHaveBeenCalledTimes(1);

    rerender(<HoldingCardHeader {...baseProps} pctVal={4} />);
    expect(sparkRenderSpy).toHaveBeenCalledTimes(2);
    const posCall = sparkRenderSpy.mock.calls[1][0];

    // 切換後 color / opacity 應不同
    expect(posCall.color).not.toBe(negCall.color);
    expect(posCall.opacity).not.toBe(negCall.opacity);
  });

  it('ink variant 於同號區間變動亦不重繪', () => {
    sparkRenderSpy.mockClear();
    const { rerender } = render(
      <HoldingCardHeader {...baseProps} variant="ink" pctVal={3} />
    );
    expect(sparkRenderSpy).toHaveBeenCalledTimes(1);
    rerender(<HoldingCardHeader {...baseProps} variant="ink" pctVal={6} />);
    rerender(<HoldingCardHeader {...baseProps} variant="ink" pctVal={9} />);
    expect(sparkRenderSpy).toHaveBeenCalledTimes(1);
  });
});
