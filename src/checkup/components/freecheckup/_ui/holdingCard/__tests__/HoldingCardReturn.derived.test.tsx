/**
 * HoldingCardReturn — 派生 useMemo 分支測試
 *
 * 覆蓋：
 *  1. variantStyle 分支：normal vs ink 的 fontSize / letterSpacing / gap /
 *     rowGap / marginTop / marginBottom 全部欄位。
 *  2. rowStyle 引用穩定：只要 variant 不變，rerender 應維持同一物件引用
 *     （透過對容器 style 直接讀值驗證計算結果）。
 *  3. roiStyle 依賴：pnlWeight / pnlColor 改變才重算，其他 prop（pctVal /
 *     pnlArrow / subColor）不影響 fontWeight/color。
 *  4. pnlSubStyle 依 subColor：只在 ink 分支渲染，subColor 改變會反映到 DOM。
 *  5. 附屬損益條件渲染：normal 不顯示、ink 顯示且格式（千分位 + 正負號）正確。
 *  6. pctVal 格式化：正號帶 +、負號不帶、零帶 +（>=0 判定）、兩位小數。
 *  7. pnlArrow：'↑' / '↓' 各自渲染，空字串完全不渲染 arrow span。
 *  8. ROI class name `.wb-roi` 存在（截圖回歸 hook）。
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import HoldingCardReturn from '../HoldingCardReturn';

const base = {
  pctVal: 5,
  pnlVal: 12345,
  pnlColor: '#FF4D1F',
  pnlWeight: 500,
  pnlArrow: '↑',
  subColor: '#555',
  variant: 'normal' as const,
};

// 讀取 ROI wrapper（第一層 div）style
function rowOf(container: HTMLElement) {
  return container.firstElementChild as HTMLElement;
}
function roiOf(container: HTMLElement) {
  return container.querySelector('.wb-roi') as HTMLElement;
}

describe('HoldingCardReturn 派生 useMemo', () => {
  // ─── variantStyle 分支 ─────────────────────────────
  describe('variantStyle 分支', () => {
    it('normal：fontSize / letterSpacing / gap / rowGap / marginBottom 為 normal 版本', () => {
      const { container } = render(<HoldingCardReturn {...base} variant="normal" />);
      const row = rowOf(container);
      const roi = roiOf(container);
      const roiStyle = roi.getAttribute('style') || '';
      expect(row.style.gap).toBe('10px');
      expect(row.style.marginTop).toBe('8px');
      expect(row.style.marginBottom).toBe('8px');
      // jsdom 不解析 clamp()，改讀 style 原始字串
      expect(roiStyle).toContain('clamp(36px, 4.5vw + 10px, 52px)');
      expect(roiStyle).toContain('letter-spacing: -0.035em');
      expect(roiStyle).toContain('gap: 5px');
    });

    it('ink：fontSize / letterSpacing / gap / rowGap / marginBottom 為 ink 版本', () => {
      const { container } = render(<HoldingCardReturn {...base} variant="ink" />);
      const row = rowOf(container);
      const roi = roiOf(container);
      const roiStyle = roi.getAttribute('style') || '';
      expect(row.style.gap).toBe('14px');
      expect(row.style.marginTop).toBe('8px');
      expect(row.style.marginBottom).toBe('10px');
      expect(roiStyle).toContain('clamp(40px, 6vw + 12px, 64px)');
      expect(roiStyle).toContain('letter-spacing: -0.04em');
      expect(roiStyle).toContain('gap: 6px');
    });
  });

  // ─── rowStyle 穩定 ─────────────────────────────────
  describe('rowStyle 引用穩定性（variant 不變）', () => {
    it('pctVal/pnlArrow 變動時 rowStyle 計算結果不變', () => {
      const { container, rerender } = render(<HoldingCardReturn {...base} />);
      const before = { gap: rowOf(container).style.gap, mb: rowOf(container).style.marginBottom };
      rerender(<HoldingCardReturn {...base} pctVal={-3} pnlArrow="↓" />);
      const after = { gap: rowOf(container).style.gap, mb: rowOf(container).style.marginBottom };
      expect(after).toEqual(before);
    });
  });

  // ─── roiStyle 依賴 ────────────────────────────────
  describe('roiStyle 依賴 pnlColor / pnlWeight', () => {
    it('pnlColor 改變 → color style 同步更新', () => {
      const { container, rerender } = render(<HoldingCardReturn {...base} pnlColor="#111" />);
      expect(roiOf(container).style.color).toBe('rgb(17, 17, 17)');
      rerender(<HoldingCardReturn {...base} pnlColor="#EEE" />);
      expect(roiOf(container).style.color).toBe('rgb(238, 238, 238)');
    });

    it('pnlWeight 改變 → fontWeight 同步更新', () => {
      const { container, rerender } = render(<HoldingCardReturn {...base} pnlWeight={400} />);
      expect(roiOf(container).style.fontWeight).toBe('400');
      rerender(<HoldingCardReturn {...base} pnlWeight={700} />);
      expect(roiOf(container).style.fontWeight).toBe('700');
    });

    it('pctVal 變動不會影響 fontWeight/color', () => {
      const { container, rerender } = render(<HoldingCardReturn {...base} />);
      const before = { fw: roiOf(container).style.fontWeight, c: roiOf(container).style.color };
      rerender(<HoldingCardReturn {...base} pctVal={99} />);
      const after = { fw: roiOf(container).style.fontWeight, c: roiOf(container).style.color };
      expect(after).toEqual(before);
    });

    it('roiStyle lineHeight 恆為 1、fontVariantNumeric 恆為 tabular-nums', () => {
      const { container } = render(<HoldingCardReturn {...base} />);
      const s = roiOf(container).style;
      expect(s.lineHeight).toBe('1');
      expect(s.fontVariantNumeric).toBe('tabular-nums');
    });
  });

  // ─── pnlSubStyle 依 subColor ───────────────────────
  describe('pnlSubStyle 依 subColor（僅 ink）', () => {
    it('normal 不渲染附屬損益 span', () => {
      const { container } = render(<HoldingCardReturn {...base} variant="normal" />);
      // ROI 為第一個 span，附屬損益若渲染會是第二個直系 span
      const spans = container.firstElementChild?.querySelectorAll(':scope > span');
      expect(spans?.length).toBe(1);
    });

    it('ink：subColor 反映到附屬損益 span color', () => {
      const { container, rerender } = render(
        <HoldingCardReturn {...base} variant="ink" subColor="#123456" />
      );
      const spans = container.firstElementChild!.querySelectorAll(':scope > span');
      expect(spans.length).toBe(2);
      const pnlSub = spans[1] as HTMLElement;
      expect(pnlSub.style.color).toBe('rgb(18, 52, 86)');

      rerender(<HoldingCardReturn {...base} variant="ink" subColor="#abcdef" />);
      const pnlSub2 = container.firstElementChild!.querySelectorAll(':scope > span')[1] as HTMLElement;
      expect(pnlSub2.style.color).toBe('rgb(171, 205, 239)');
    });

    it('ink：pnlSubStyle fontSize=13, letterSpacing=0.02em, tabular-nums', () => {
      const { container } = render(<HoldingCardReturn {...base} variant="ink" />);
      const pnlSub = container.firstElementChild!.querySelectorAll(':scope > span')[1] as HTMLElement;
      expect(pnlSub.style.fontSize).toBe('13px');
      expect(pnlSub.style.letterSpacing).toBe('0.02em');
      expect(pnlSub.style.fontVariantNumeric).toBe('tabular-nums');
    });
  });

  // ─── 附屬損益格式 ──────────────────────────────────
  describe('附屬損益（ink）格式：千分位 + 正負號', () => {
    it('正 pnlVal 帶 + 與千分位', () => {
      const { container } = render(<HoldingCardReturn {...base} variant="ink" pnlVal={1234567} />);
      const pnlSub = container.firstElementChild!.querySelectorAll(':scope > span')[1];
      expect(pnlSub.textContent).toBe('+1,234,567');
    });
    it('負 pnlVal 不加 +（toLocaleString 已含負號）', () => {
      const { container } = render(<HoldingCardReturn {...base} variant="ink" pnlVal={-9876} />);
      const pnlSub = container.firstElementChild!.querySelectorAll(':scope > span')[1];
      expect(pnlSub.textContent).toBe('-9,876');
    });
    it('0 帶 +（>=0 判定）', () => {
      const { container } = render(<HoldingCardReturn {...base} variant="ink" pnlVal={0} />);
      const pnlSub = container.firstElementChild!.querySelectorAll(':scope > span')[1];
      expect(pnlSub.textContent).toBe('+0');
    });
  });

  // ─── pctVal 格式化 ────────────────────────────────
  describe('pctVal 格式化', () => {
    it('正 pctVal 帶 + 與兩位小數', () => {
      const { container } = render(<HoldingCardReturn {...base} pctVal={12.3} />);
      expect(roiOf(container).textContent).toMatch(/\+12\.30\s*%/);
    });
    it('負 pctVal 不加 +（.toFixed 已含 -）', () => {
      const { container } = render(<HoldingCardReturn {...base} pctVal={-4.5} pnlArrow="↓" />);
      expect(roiOf(container).textContent).toMatch(/-4\.50\s*%/);
      expect(roiOf(container).textContent).not.toMatch(/\+-/);
    });
    it('pctVal=0 帶 +（>=0）', () => {
      const { container } = render(<HoldingCardReturn {...base} pctVal={0} pnlArrow="" />);
      expect(roiOf(container).textContent).toMatch(/\+0\.00\s*%/);
    });
    it('pctVal 有極多小數 → 只取兩位', () => {
      const { container } = render(<HoldingCardReturn {...base} pctVal={3.14159265} />);
      expect(roiOf(container).textContent).toMatch(/\+3\.14\s*%/);
    });
  });

  // ─── pnlArrow 條件渲染 ────────────────────────────
  describe('pnlArrow 條件渲染', () => {
    it('pnlArrow="↑" 渲染 arrow span', () => {
      const { container } = render(<HoldingCardReturn {...base} pnlArrow="↑" />);
      expect(roiOf(container).textContent).toMatch(/^↑/);
    });
    it('pnlArrow="↓" 渲染 arrow span', () => {
      const { container } = render(<HoldingCardReturn {...base} pnlArrow="↓" pctVal={-1} />);
      expect(roiOf(container).textContent).toMatch(/^↓/);
    });
    it('pnlArrow="" 不渲染 arrow span（只剩百分比 span）', () => {
      const { container } = render(<HoldingCardReturn {...base} pnlArrow="" pctVal={0} />);
      const inner = roiOf(container).querySelectorAll(':scope > span');
      // 只有一個 span：百分比容器（arrow span 不渲染）
      expect(inner.length).toBe(1);
    });
  });

  // ─── class hook ───────────────────────────────────
  it('保留 .wb-roi class（截圖回歸 hook）', () => {
    const { container } = render(<HoldingCardReturn {...base} />);
    expect(container.querySelector('.wb-roi')).not.toBeNull();
  });

  // ─── ARIA ─────────────────────────────────────────
  it('外層 aria-hidden=true（由父卡 aria-label 統一朗讀）', () => {
    const { container } = render(<HoldingCardReturn {...base} />);
    expect(rowOf(container).getAttribute('aria-hidden')).toBe('true');
  });
});
