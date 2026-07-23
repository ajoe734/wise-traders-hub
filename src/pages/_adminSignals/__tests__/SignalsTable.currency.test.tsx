/**
 * 回歸：admin/Signals 週記列表在 `expert_signals.currency` 缺欄位時，
 * 美股（asset_class=us_stock）不得顯示為 NT$。
 * 對應 bug：SignalRow 舊 `normalizeCurrency() || spec.currency` 永不 fallback。
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils/renderWithProviders';
import { SignalsTable } from '../SignalsTable';

// 避免 FxHint 依賴 useFxRate / DisplayCurrencyContext
vi.mock('@/components/FxHint', () => ({
  FxHint: () => null,
}));
// InstrumentTooltip 內部 tooltip / portal 對此測試無關
vi.mock('@/components/InstrumentTooltip', () => ({
  InstrumentTooltip: ({ children }: any) => <span>{children}</span>,
}));

const baseProps = {
  isMentor: false,
  isAdvisor: true,
  isReadOnly: false,
  expertSlug: 'test-expert',
  expandedId: null,
  setExpandedId: () => {},
  openInstruments: new Set<string>(),
  addBuySignalIds: new Set<string>(),
  batchInfo: new Map(),
  collapsedBatches: new Set<string>(),
  setCollapsedBatches: () => {},
  recalling: false,
  repushingId: null,
  onRepush: () => {},
  onRecall: () => {},
  onEdit: () => {},
  contentLabel: '訊號',
  holdingSummary: null,
};

function mkSignal(overrides: any = {}) {
  return {
    id: overrides.id ?? 'sig-1',
    action: 'buy',
    status: 'published',
    published_at: '2026-07-01T02:00:00Z',
    price_hint: 100,
    quantity: 1,
    reason_summary: 'test',
    ...overrides,
  };
}

describe('SignalsTable × currency fallback（缺 signal.currency）', () => {
  it('US stock（asset_class=us_stock）缺 currency 欄位 → 顯示 US$，不得顯示 NT$', () => {
    const signals = [
      mkSignal({ id: 's-spcx', instrument: 'SPCX', asset_class: 'us_stock', currency: null }),
      mkSignal({ id: 's-intc', instrument: 'INTC', asset_class: 'us_stock' }),
      mkSignal({ id: 's-meta', instrument: 'META', asset_class: 'us_stock', currency: undefined }),
    ];
    renderWithProviders(
      <SignalsTable
        {...baseProps}
        visibleSignals={signals}
        defaultCurrency="USD"
        defaultAssetClass="us_stock"
      />,
    );
    const usPrices = screen.getAllByText(/US\$/);
    expect(usPrices.length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/NT\$/)).toBeNull();
  });

  it('spec 為 TWD 但 instrument 是美股代號 → 由代號推斷 US$', () => {
    renderWithProviders(
      <SignalsTable
        {...baseProps}
        visibleSignals={[mkSignal({ instrument: 'AAPL' })]}
        defaultCurrency="TWD"
        defaultAssetClass={null}
      />,
    );
    expect(screen.getByText(/US\$/)).toBeTruthy();
    expect(screen.queryByText(/NT\$/)).toBeNull();
  });

  it('台股（asset_class=tw_stock）缺 currency → NT$', () => {
    renderWithProviders(
      <SignalsTable
        {...baseProps}
        visibleSignals={[mkSignal({ instrument: '2330 台積電', asset_class: 'tw_stock' })]}
        defaultCurrency="TWD"
        defaultAssetClass="tw_stock"
      />,
    );
    expect(screen.getByText(/NT\$/)).toBeTruthy();
    expect(screen.queryByText(/US\$/)).toBeNull();
  });

  it('signal.currency 明確 TWD 可覆寫 asset_class=us_stock 的推斷', () => {
    renderWithProviders(
      <SignalsTable
        {...baseProps}
        visibleSignals={[mkSignal({ instrument: 'AAPL', asset_class: 'us_stock', currency: 'TWD' })]}
        defaultCurrency="USD"
        defaultAssetClass="us_stock"
      />,
    );
    expect(screen.getByText(/NT\$/)).toBeTruthy();
    expect(screen.queryByText(/US\$/)).toBeNull();
  });

  describe('幣別來源標示 (data-testid="admin-signal-currency-source")', () => {
    it('signal.currency 明確 → data-source=explicit，文案「明確」', () => {
      renderWithProviders(
        <SignalsTable
          {...baseProps}
          visibleSignals={[mkSignal({ instrument: 'AAPL', asset_class: 'us_stock', currency: 'USD' })]}
          defaultCurrency="USD"
          defaultAssetClass="us_stock"
        />,
      );
      const chip = screen.getByTestId('admin-signal-currency-source');
      expect(chip.getAttribute('data-source')).toBe('explicit');
      expect(chip.getAttribute('data-currency')).toBe('USD');
      expect(chip.textContent).toContain('明確');
    });

    it('由 asset_class 推斷 → data-source=asset-class，文案含「資產類別」', () => {
      renderWithProviders(
        <SignalsTable
          {...baseProps}
          visibleSignals={[mkSignal({ instrument: 'SPCX', asset_class: 'us_stock', currency: null })]}
          defaultCurrency="TWD"
          defaultAssetClass="us_stock"
        />,
      );
      const chip = screen.getByTestId('admin-signal-currency-source');
      expect(chip.getAttribute('data-source')).toBe('asset-class');
      expect(chip.textContent).toContain('資產類別');
    });

    it('由代號推斷 → data-source=inferred-instrument，文案含「代號推斷」', () => {
      renderWithProviders(
        <SignalsTable
          {...baseProps}
          visibleSignals={[mkSignal({ instrument: 'AAPL' })]}
          defaultCurrency="TWD"
          defaultAssetClass={null}
        />,
      );
      const chip = screen.getByTestId('admin-signal-currency-source');
      expect(chip.getAttribute('data-source')).toBe('inferred-instrument');
      expect(chip.textContent).toContain('代號推斷');
    });

    it('無法推斷 → data-source=default-fallback，文案含「預設」', () => {
      renderWithProviders(
        <SignalsTable
          {...baseProps}
          visibleSignals={[mkSignal({ instrument: '比特幣' })]}
          defaultCurrency="TWD"
          defaultAssetClass={null}
        />,
      );
      const chip = screen.getByTestId('admin-signal-currency-source');
      expect(chip.getAttribute('data-source')).toBe('default-fallback');
      expect(chip.textContent).toContain('預設');
    });
  });
});


