/**
 * 回歸測試：HoldingsSectorSummary 在「0 檔 → N 檔」轉換時不得改變 hook 數量。
 *
 * 真實 bug（Hosted Preview，手動新增成交／截圖匯入後整頁 error boundary）：
 * `concentrationNote` 的 useMemo 原本寫在 `if (!hasHoldings ...) return null` 之後，
 * 空倉時只呼叫 23 顆 hook、有持倉時 24 顆，React 直接丟
 * "change in the order of Hooks"，整個 /holding-checkup 崩潰。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import HoldingsSectorSummary from '@/checkup/components/freecheckup/HoldingsSectorSummary';

vi.mock('@/checkup/hooks/useMetaOverrides', () => ({
  useMetaOverrides: () => ({ overrides: {}, save: () => {}, remove: () => {} }),
}));

const holding = {
  code: '2330', name: '台積電', qty: 1000, price: 1000, cost: 1000,
  value: 1_000_000, pnl: 0, pct: 0, priceSource: 'manual',
};
const stockMeta = { 2330: { industry: '半導體業', themes: [], strategy: '核心' } };

afterEach(() => vi.restoreAllMocks());

describe('HoldingsSectorSummary — hook order stability', () => {
  it('0 檔 → 1 檔 rerender 不觸發 hook order 錯誤', () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      errors.push(args.map(String).join(' '));
    });

    const { rerender, container } = render(
      <HoldingsSectorSummary holdings={[]} stockMeta={{}} selected={null} onSelect={() => {}} />,
    );
    expect(container.textContent).toBe('');

    rerender(
      <HoldingsSectorSummary holdings={[holding]} stockMeta={stockMeta} selected={null} onSelect={() => {}} />,
    );

    expect(container.textContent).toContain('半導體業');
    expect(errors.filter((e) => e.includes('order of Hooks'))).toEqual([]);
  });
});
