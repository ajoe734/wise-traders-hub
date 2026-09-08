/**
 * 卡片層（不開抽屜）籌碼渲染回歸：
 * 只從 query cache 訂閱實際 payload rows，法人為 primary、券商分點只在 secondary。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HoldingCardBsr from '@/checkup/components/freecheckup/_ui/holdingCard/HoldingCardBsr';
import { chipsQueryKey } from '@/checkup/hooks/useTwChipsDetail';
import { chipsBatchStatusKey } from '@/checkup/hooks/useChipsBatch';

const PAYLOAD = {
  stock_id: '2478',
  as_of: '2026-09-07',
  as_of_lag_days: 1,
  institutional: {
    d1: { foreign_net: -424791, trust_net: -14000, dealer_net: 5911, total_net: -432880, days_covered: 1 },
    d5: null,
    d20: null,
    d60: null,
  },
  bsr: { d5: null, d20: null, d60: null },
  bsr_as_of: '2026-08-14',
  bsr_freshness_status: 'syncing',
  bsr_provider_state: 'terminal_provider_rejected',
  bsr_provider_code: 'provider_plan_rejected',
};

function renderCard(code: string, payload: unknown, status: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (payload !== undefined) qc.setQueryData(chipsQueryKey(code), { payload });
  if (status !== undefined) qc.setQueryData(chipsBatchStatusKey(code), status);
  const utils = render(
    <QueryClientProvider client={qc}>
      <HoldingCardBsr code={code} />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

describe('HoldingCardBsr · 法人 primary', () => {
  it('普通股不開抽屜即顯示最新三大法人張數與日期', () => {
    renderCard('2478', PAYLOAD, { kind: 'ok' });
    const el = screen.getByTestId('holding-card-bsr');
    expect(el.getAttribute('data-chips-kind')).toBe('institutional');
    expect(el.getAttribute('data-chips-as-of')).toBe('2026/09/07');
    expect(screen.getByTestId('holding-card-chips-primary').textContent).toContain('外資 −425');
    expect(screen.getByTestId('holding-card-chips-secondary').textContent).toContain('券商分點資料源需授權');
    expect(screen.getByTestId('holding-card-chips-secondary').textContent).toContain('2026/08/14');
    expect(el.textContent).not.toContain('籌碼資料暫時無法取得');
  });

  it('reload（重新掛載同一份 cache）結果一致', () => {
    const first = renderCard('2478', PAYLOAD, { kind: 'ok' });
    const a = screen.getByTestId('holding-card-bsr').textContent;
    first.unmount();
    renderCard('2478', PAYLOAD, { kind: 'pending' });
    expect(screen.getByTestId('holding-card-bsr').textContent).toBe(a);
  });

  it('無任何 payload 時 fail-closed，不顯示數字', () => {
    renderCard('2478', undefined, undefined);
    const el = screen.getByTestId('holding-card-bsr');
    expect(el.getAttribute('data-chips-kind')).toBe('loading');
    expect(el.textContent).toBe('');
  });

  it('ETF／權證維持不適用', () => {
    renderCard(
      '0050',
      { ...PAYLOAD, stock_id: '0050', bsr_provider_state: 'ineligible', bsr_provider_code: 'ineligible' },
      { kind: 'ok' },
    );
    const el = screen.getByTestId('holding-card-bsr');
    expect(el.getAttribute('data-chips-kind')).toBe('not_applicable');
    expect(el.textContent).toContain('不適用');
  });
});
