/**
 * HoldingCardHeader — 派生計算單元測試
 *
 * 覆蓋：
 *   1. pctSign memo key：Sparkline props (color/opacity) 在同號區間變動時 **引用相等**，
 *      跨零時才改變。
 *   2. sparkOpacity 三分支：正號=0.85 / 負號 normal=0.55 / 負號 ink=0.6。
 *   3. sparkColor 分支：正號 normal=WB.accent / 負號 normal='#9B968D' / ink='#F4F1EC'。
 *   4. industries useMemo：
 *       a) meta.industries 陣列引用不變 → 產出引用穩定
 *       b) 只有 meta.industry 字串時 → 產出 [industry]，且 industry 相同再 render 引用穩定
 *       c) industries 從無變有時 → tag DOM 出現對應數量
 *       d) 陣列內容變更 → tag DOM 更新
 *   5. hasTags 邏輯：industries 空 + strategy 空 + 無 onReportMeta → 不渲染 .wb-tags；
 *      任一存在都要渲染。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memo } from 'react';
import { render } from '@testing-library/react';
import { resetRenderStats } from '@/checkup/hooks/useRenderCounter';
import { WB } from '@/pages/_freeCheckup/constants.jsx';

// 攔截 Sparkline 讀取 props，用於斷言 color/opacity 引用
const sparkSpy = vi.fn();
vi.mock('@/pages/_freeCheckup/constants.jsx', async () => {
  const actual = await vi.importActual<any>('@/pages/_freeCheckup/constants.jsx');
  const SpySparkline = memo(function SpySparkline(props: any) {
    sparkSpy(props);
    return <svg data-testid="spy-spark" />;
  });
  return { ...actual, Sparkline: SpySparkline };
});

const { default: HoldingCardHeader } = await import('../HoldingCardHeader');

const baseProps = {
  h: { code: '2330', name: '台積電', qty: 100 },
  meta: null as any,
  onReportMeta: undefined as any,
  variant: 'normal' as const,
  cardColor: '#000',
  muteColor: '#888',
  sparkData: [1, 2, 3, 4],
  sparkFailed: false,
  actionLabel: 'HOLD',
  pctVal: 5,
};

describe('HoldingCardHeader 派生計算', () => {
  beforeEach(() => {
    resetRenderStats();
    sparkSpy.mockClear();
  });

  // ─── pctSign memo key ───────────────────────────────────────
  describe('pctSign memo key', () => {
    it('正→正：Sparkline color/opacity 引用完全相同', () => {
      const { rerender } = render(<HoldingCardHeader {...baseProps} pctVal={5} />);
      const a = sparkSpy.mock.calls[0][0];
      rerender(<HoldingCardHeader {...baseProps} pctVal={0.001} />);
      // memo hit → 應該沒有第二次呼叫
      expect(sparkSpy).toHaveBeenCalledTimes(1);
      // 若強制 re-render（改變其他 prop），也應吃到同一 color/opacity 引用
      rerender(<HoldingCardHeader {...baseProps} pctVal={9} cardColor="#111" />);
      const b = sparkSpy.mock.calls[sparkSpy.mock.calls.length - 1][0];
      expect(b.color).toBe(a.color);
      expect(b.opacity).toBe(a.opacity);
    });

    it('負→負：Sparkline color/opacity 引用完全相同', () => {
      const { rerender } = render(<HoldingCardHeader {...baseProps} pctVal={-1} />);
      const a = sparkSpy.mock.calls[0][0];
      rerender(<HoldingCardHeader {...baseProps} pctVal={-30} cardColor="#222" />);
      const b = sparkSpy.mock.calls[sparkSpy.mock.calls.length - 1][0];
      expect(b.color).toBe(a.color);
      expect(b.opacity).toBe(a.opacity);
    });

    it('跨零（正→負）：color 與 opacity 引用同時變更', () => {
      const { rerender } = render(<HoldingCardHeader {...baseProps} pctVal={3} />);
      const pos = sparkSpy.mock.calls[0][0];
      rerender(<HoldingCardHeader {...baseProps} pctVal={-3} />);
      const neg = sparkSpy.mock.calls[1][0];
      expect(neg.color).not.toBe(pos.color);
      expect(neg.opacity).not.toBe(pos.opacity);
    });

    it('pctVal=0 視為非負號（sign=1）', () => {
      // pctSign = pctVal >= 0 ? 1 : -1 → 0 → 1 → 正號分支
      render(<HoldingCardHeader {...baseProps} pctVal={0} />);
      const { color, opacity } = sparkSpy.mock.calls[0][0];
      expect(color).toBe(WB.accent);
      expect(opacity).toBeCloseTo(0.85);
    });
  });

  // ─── sparkOpacity / sparkColor 分支值 ───────────────────────
  describe('sparkColor / sparkOpacity 分支值', () => {
    it('normal + 正號 → accent / 0.85', () => {
      render(<HoldingCardHeader {...baseProps} pctVal={2} variant="normal" />);
      const p = sparkSpy.mock.calls[0][0];
      expect(p.color).toBe(WB.accent);
      expect(p.opacity).toBeCloseTo(0.85);
    });

    it('normal + 負號 → #9B968D / 0.55', () => {
      render(<HoldingCardHeader {...baseProps} pctVal={-2} variant="normal" />);
      const p = sparkSpy.mock.calls[0][0];
      expect(p.color).toBe('#9B968D');
      expect(p.opacity).toBeCloseTo(0.55);
    });

    it('ink + 正號 → #F4F1EC / 0.85', () => {
      render(<HoldingCardHeader {...baseProps} pctVal={2} variant="ink" />);
      const p = sparkSpy.mock.calls[0][0];
      expect(p.color).toBe('#F4F1EC');
      expect(p.opacity).toBeCloseTo(0.85);
    });

    it('ink + 負號 → #F4F1EC / 0.6', () => {
      render(<HoldingCardHeader {...baseProps} pctVal={-2} variant="ink" />);
      const p = sparkSpy.mock.calls[0][0];
      expect(p.color).toBe('#F4F1EC');
      expect(p.opacity).toBeCloseTo(0.6);
    });
  });

  // ─── industries useMemo ────────────────────────────────────
  describe('industries useMemo', () => {
    it('meta.industries 陣列引用不變 → 重 render tag DOM 不消失且順序不變', () => {
      const industries = ['半導體', 'AI'];
      const { container, rerender } = render(
        <HoldingCardHeader {...baseProps} meta={{ industries }} />
      );
      const first = Array.from(
        container.querySelectorAll('.wb-tags > span:not(.wb-tip)')
      ).map((n) => n.textContent);
      rerender(<HoldingCardHeader {...baseProps} meta={{ industries }} pctVal={7} />);
      const second = Array.from(
        container.querySelectorAll('.wb-tags > span:not(.wb-tip)')
      ).map((n) => n.textContent);
      expect(second).toEqual(first);
      expect(second).toEqual(['半導體', 'AI']);
    });

    it('meta.industry 單字串 → 渲染為單一 tag', () => {
      const { container } = render(
        <HoldingCardHeader {...baseProps} meta={{ industry: '金融' }} />
      );
      const tags = Array.from(
        container.querySelectorAll('.wb-tags > span:not(.wb-tip)')
      ).map((n) => n.textContent);
      expect(tags).toEqual(['金融']);
    });

    it('industries 從空變有：industries 相關 tag 從 0 → N 個', () => {
      // 註：`.wb-tags` 容器現為恆渲染（教學徽章依賴），空 meta 時內僅有 .wb-tip。
      const { container, rerender } = render(<HoldingCardHeader {...baseProps} meta={null} />);
      expect(
        container.querySelectorAll('.wb-tags > span:not(.wb-tip)').length,
      ).toBe(0);
      rerender(
        <HoldingCardHeader
          {...baseProps}
          meta={{ industries: ['a', 'b', 'c'] }}
        />
      );
      const tags = container.querySelectorAll('.wb-tags > span:not(.wb-tip)');
      expect(tags.length).toBe(3);
    });

    it('industries 內容變更 → tag DOM 對應更新（不會殘留舊值）', () => {
      const { container, rerender } = render(
        <HoldingCardHeader {...baseProps} meta={{ industries: ['半導體'] }} />
      );
      expect(container.textContent).toContain('半導體');
      rerender(
        <HoldingCardHeader {...baseProps} meta={{ industries: ['光電', '生技'] }} />
      );
      const tags = Array.from(
        container.querySelectorAll('.wb-tags > span:not(.wb-tip)')
      ).map((n) => n.textContent);
      expect(tags).toEqual(['光電', '生技']);
      expect(container.textContent).not.toContain('半導體');
    });

    it('industries 存在時忽略 meta.industry（陣列優先）', () => {
      const { container } = render(
        <HoldingCardHeader
          {...baseProps}
          meta={{ industries: ['半導體'], industry: '金融' }}
        />
      );
      const tags = Array.from(
        container.querySelectorAll('.wb-tags > span:not(.wb-tip)')
      ).map((n) => n.textContent);
      expect(tags).toEqual(['半導體']);
      expect(container.textContent).not.toContain('金融');
    });

    it('industries 空陣列 fallback 到 meta.industry', () => {
      const { container } = render(
        <HoldingCardHeader
          {...baseProps}
          meta={{ industries: [], industry: '金融' }}
        />
      );
      const tags = Array.from(
        container.querySelectorAll('.wb-tags > span:not(.wb-tip)')
      ).map((n) => n.textContent);
      expect(tags).toEqual(['金融']);
    });
  });

  // ─── wb-tags 條件渲染（教學徽章導入後：容器恆存在，僅資訊 tag 依條件） ─
  describe('wb-tags 內部內容條件渲染', () => {
    it('industries 空 + strategy 空 + 無 onReportMeta → .wb-tags 只剩 .wb-tip', () => {
      const { container } = render(<HoldingCardHeader {...baseProps} meta={{}} />);
      const tags = container.querySelector('.wb-tags');
      expect(tags).not.toBeNull();
      expect(tags?.querySelectorAll('span:not(.wb-tip)').length).toBe(0);
      expect(tags?.querySelector('.wb-tip')).not.toBeNull();
    });

    it('只有 strategy → strategy tag 出現於 .wb-tags', () => {
      const { container } = render(
        <HoldingCardHeader {...baseProps} meta={{ strategy: '成長' }} />
      );
      const tags = container.querySelector('.wb-tags');
      expect(tags).not.toBeNull();
      expect(tags?.textContent).toContain('成長');
    });

    it('只有 onReportMeta → .wb-tags 渲染回報按鈕', () => {
      const { container } = render(
        <HoldingCardHeader {...baseProps} onReportMeta={() => {}} />
      );
      const tags = container.querySelector('.wb-tags');
      expect(tags).not.toBeNull();
      expect(tags?.querySelector('[role="button"]')).not.toBeNull();
    });

    it('三者皆有 → 完整渲染（industries + strategy + tip + 回報）', () => {
      const { container } = render(
        <HoldingCardHeader
          {...baseProps}
          meta={{ industries: ['半導體'], strategy: '成長' }}
          onReportMeta={() => {}}
        />
      );
      const spans = Array.from(container.querySelectorAll('.wb-tags > span')).map(
        (n) => n.textContent
      );
      expect(spans).toContain('半導體');
      expect(spans).toContain('成長');
      expect(spans).toContain('回報');
      expect(container.querySelector('.wb-tip')).not.toBeNull();
    });
  });
});

