/**
 * 真正渲染 WarrantIdentityHarnessEntry，證明 harness 與 production 共用
 * `screenImportedTradeIdentities` fail-closed gate。
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import WarrantIdentityHarnessEntry from '@/pages/WarrantIdentityHarnessEntry';

function setUrl(ocr: string) {
  window.history.replaceState(
    {},
    '',
    `/e2e/warrant-identity-harness?ocr=${ocr}&name=${encodeURIComponent('祥碩凱基5C購01')}`,
  );
}

describe('WarrantIdentityHarnessEntry · gate parity', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({
      data: { result: { '054530': { ohlc: [{ close: 0.6 }, { close: 0.71 }] } } },
      error: null,
    });
  });

  it('5269 + 權證名 → blocked、accepted 0、無 chart_symbol、不呼叫 sparkline', async () => {
    setUrl('5269');
    render(<WarrantIdentityHarnessEntry />);

    expect(screen.getByTestId('gate-ok').textContent).toBe('gate_ok=false');
    expect(screen.getByTestId('accepted-count').textContent).toBe('accepted=0');
    expect(screen.getByTestId('chart-status').textContent).toBe('status=blocked');
    expect(screen.getByTestId('chart-symbol').textContent).toBe('chart_symbol=');
    expect(screen.getByTestId('canonical-code').textContent).toBe('canonical_code=');
    expect(screen.getByRole('alert').textContent).toContain('權證');
    await waitFor(() => expect(invoke).not.toHaveBeenCalled());
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('5269');
  });

  it('54530 + 權證名 → ok、canonical/chart symbol 054530', async () => {
    setUrl('54530');
    render(<WarrantIdentityHarnessEntry />);

    expect(screen.getByTestId('canonical-code').textContent).toBe('canonical_code=054530');
    await waitFor(() =>
      expect(screen.getByTestId('chart-status').textContent).toBe('status=ok'),
    );
    expect(screen.getByTestId('chart-symbol').textContent).toBe('chart_symbol=054530');
    expect(screen.getByTestId('chart-first').textContent).toContain('0.6');
    expect(screen.getByTestId('chart-last').textContent).toContain('0.71');
    expect(invoke).toHaveBeenCalledWith('checkup-sparkline', { body: { codes: ['054530'] } });
  });
});
