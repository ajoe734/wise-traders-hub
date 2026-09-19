/**
 * 真正渲染 HoldingDeleteHarnessEntry：證明九類刪除案例全部走 production
 * holdingExclusions / holdingDeleteService，且 fixture 模式零 supabase、零網路。
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) },
}));

import HoldingDeleteHarnessEntry, { HARNESS_MARKER } from '@/pages/HoldingDeleteHarnessEntry';

const text = (id: string) => screen.getByTestId(id).textContent;
const SCENARIOS = [
  's1-delete', 's2-rollback', 's3-forbidden', 's4-last', 's5-duplicate',
  's6-reload', 's7-replay', 's8-readd', 's9-import',
];

describe('HoldingDeleteHarnessEntry', () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  it('marker / 零 mutation / 零 supabase', async () => {
    render(<HoldingDeleteHarnessEntry />);
    await waitFor(() => expect(text('scenario-total')).toBe(`scenario_total=${SCENARIOS.length}`));
    expect(HARNESS_MARKER).toBe('HOLDING_DELETE_V1');
    expect(text('build-marker')).toBe('build_marker=HOLDING_DELETE_V1');
    expect(text('mutation-calls')).toBe('mutation_calls=0');
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('九類案例全部 pass', async () => {
    render(<HoldingDeleteHarnessEntry />);
    await waitFor(() => expect(text('scenario-pass')).toBe(`scenario_pass=${SCENARIOS.length}`));
    for (const id of SCENARIOS) {
      expect(screen.getByTestId(`scenario-status-${id}`).textContent).toBe('pass');
    }
    expect(text('overall')).toBe('overall=pass');
  });

  it('帳務 fingerprint：tradeRecordWrites=0、cashDelta=0', async () => {
    render(<HoldingDeleteHarnessEntry />);
    await waitFor(() => expect(text('scenario-total')).toBe(`scenario_total=${SCENARIOS.length}`));
    expect(text('trade-record-writes')).toBe('trade_record_writes=0');
    expect(text('cash-delta')).toBe('cash_delta=0');
  });

  it('fixture mode hard-block：fetch / XHR / sendBeacon 全部爆炸', async () => {
    render(<HoldingDeleteHarnessEntry />);
    await waitFor(() => expect(text('scenario-total')).toBe(`scenario_total=${SCENARIOS.length}`));
    expect(() => window.fetch('/any')).toThrow(/blocked network: fetch/);
    expect(() => new XMLHttpRequest().open('GET', '/any')).toThrow(/blocked network: xhr/);
    expect(() => navigator.sendBeacon('/any')).toThrow(/blocked network: sendBeacon/);
  });
});

describe('HoldingDeleteHarnessEntry · route + host gate', () => {
  it('route 無條件註冊且以 guarded() 包裹', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'src/routes/harnessRoutes.tsx'), 'utf8');
    expect(src).toContain('path="/e2e/holding-delete-harness"');
    expect(src).toContain('element={guarded(<HoldingDeleteHarnessEntry />)}');
    expect(src).toContain('lazy(() => import("../pages/HoldingDeleteHarnessEntry"))');
  });

  it('host gate：僅 local / preview host 可達，正式與 lookalike 一律拒絕', async () => {
    const { isHarnessHostAllowed } = await import('@/routes/harnessHostGate');
    for (const h of ['localhost', '127.0.0.1', 'preview--wise-traders-hub.lovable.app',
      '0f5bdae6-cb07-4e2a-88dc-334c90cb5b02.lovableproject.com']) {
      expect(isHarnessHostAllowed(h)).toBe(true);
    }
    for (const h of ['legendflow.tw', 'www.legendflow.tw', 'wise-traders-hub.lovable.app',
      'preview--x.lovable.app.evil.com', 'sub.0f5bdae6.lovableproject.com', '']) {
      expect(isHarnessHostAllowed(h)).toBe(false);
    }
  });

  it('非白名單 host 下 guard 渲染 404，不載入 harness', async () => {
    const { HarnessRouteGuard } = await import('@/routes/harnessRoutes');
    const { MemoryRouter } = await import('react-router-dom');
    render(
      <MemoryRouter>
        <HarnessRouteGuard hostname="legendflow.tw">
          <div data-testid="harness-loaded">loaded</div>
        </HarnessRouteGuard>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '404' })).toBeInTheDocument();
    expect(screen.queryByTestId('harness-loaded')).toBeNull();
  });
});
