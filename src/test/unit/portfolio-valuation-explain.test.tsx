/**
 * 投組估值「計算說明」折疊面板（PORTFOLIO_VALUATION_EXPLAIN_V1）回歸測試。
 *
 * 鎖死行為：
 *   1. 預設收起；點「計算說明」展開、點「收起說明」收起。
 *   2. 說明文字必須含真實門檻數字：同業至少 3 家、極端值 5%–95%、
 *      單檔溢價上限 +200%、中性判讀 10%。
 *   3. 說明不得出現買賣建議字眼。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PortfolioValuationStrip from '@/checkup/components/freecheckup/PortfolioValuationStrip';

const HOLDINGS = [{ code: '2330', value: 1000 }];

function snapshotRow() {
  return {
    symbol: '2330',
    asOf: '2026-09-18',
    pe: 12,
    pb: 3,
    dividendYield: 2,
    peers: [
      { symbol: 'A', pe: 8, pb: 2, dividendYield: 1 },
      { symbol: 'B', pe: 10, pb: 3, dividendYield: 2 },
      { symbol: 'C', pe: 12, pb: 4, dividendYield: 3 },
      { symbol: 'D', pe: 14, pb: 5, dividendYield: 4 },
      { symbol: 'E', pe: 16, pb: 6, dividendYield: 5 },
    ],
  };
}

const WB = {
  ink: '#292520',
  inkSub: '#6b6259',
  inkMute: '#9a918a',
  hair: '#e2ddd6',
};

describe('PortfolioValuationStrip 計算說明', () => {
  it('預設收起，點擊後展開且含真實門檻數字', () => {
    const rpc = vi.fn(async () => [snapshotRow()]);
    render(
      <PortfolioValuationStrip holdings={HOLDINGS} WB={WB} injectedGateway={{ rpc } as any} />,
    );

    expect(screen.queryByTestId('portfolio-valuation-explain')).toBeNull();

    fireEvent.click(screen.getByTestId('portfolio-valuation-explain-toggle'));
    const panel = screen.getByTestId('portfolio-valuation-explain');
    expect(panel.textContent).toContain('3 家');
    expect(panel.textContent).toContain('5%–95%');
    expect(panel.textContent).toContain('+200%');
    expect(panel.textContent).toContain('10%');
    expect(panel.textContent).toContain('不構成任何買賣建議');

    fireEvent.click(screen.getByTestId('portfolio-valuation-explain-toggle'));
    expect(screen.queryByTestId('portfolio-valuation-explain')).toBeNull();
  });

  it('aria-expanded 狀態正確切換', () => {
    const rpc = vi.fn(async () => [snapshotRow()]);
    render(
      <PortfolioValuationStrip holdings={HOLDINGS} WB={WB} injectedGateway={{ rpc } as any} />,
    );
    const toggle = screen.getByTestId('portfolio-valuation-explain-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});
