/**
 * 真正渲染 SignalArithmeticHarnessEntry：證明 harness 掛的是 production
 * applySignalMathVector / computeCashSim，且 fixture 模式零 supabase、零網路。
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) },
}));

import SignalArithmeticHarnessEntry, { HARNESS_MARKER } from '@/pages/SignalArithmeticHarnessEntry';
import contract from '@/lib/signalMath.contract.json';

const text = (id: string) => screen.getByTestId(id).textContent;

describe('SignalArithmeticHarnessEntry', () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  it('marker / contract 版本 / 零 mutation', () => {
    render(<SignalArithmeticHarnessEntry />);
    expect(HARNESS_MARKER).toBe('SIGNAL_ARITHMETIC_V1');
    expect(text('build-marker')).toBe('build_marker=SIGNAL_ARITHMETIC_V1');
    expect(text('contract-version')).toBe('contract_version=SIGNAL_MATH_CONTRACT_V1');
    expect(text('mutation-calls')).toBe('mutation_calls=0');
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('12 筆 contract vectors 全部 pass', () => {
    render(<SignalArithmeticHarnessEntry />);
    const total = contract.vectors.length;
    expect(text('vector-total')).toBe(`vector_total=${total}`);
    expect(text('vector-pass')).toBe(`vector_pass=${total}`);
    expect(text('vector-fail')).toBe('vector_fail=0');
    for (const v of contract.vectors) {
      expect(text(`vector-status-${v.id}`)).toBe('pass');
    }
  });

  it('反例 1：00708L 2 張 @77.7 → 扣 155,400（非 155,400,000）', () => {
    render(<SignalArithmeticHarnessEntry />);
    expect(text('case-status-c1-00708L-lot-unit')).toBe('pass');
    expect(text('case-c1-00708L-lot-unit-remaining')).toBe('remaining=844600');
    expect(text('case-c1-00708L-lot-unit-legacy')).toBe('legacy_wrong=-154400000');
  });

  it('反例 2：6706 平倉以出場價 143 回收 143,000（非成本 123,000）', () => {
    render(<SignalArithmeticHarnessEntry />);
    expect(text('case-status-c2-6706-exit-uses-exit-price')).toBe('pass');
    expect(text('case-c2-6706-exit-uses-exit-price-remaining')).toBe('remaining=643000');
    expect(text('case-c2-6706-exit-uses-exit-price-legacy')).toBe('legacy_wrong=623000');
  });

  it('反例 3：3006 @238 賣出回收 238,000（含已實現 +64,000）', () => {
    render(<SignalArithmeticHarnessEntry />);
    expect(text('case-status-c3-3006-orphan-realized')).toBe('pass');
    expect(text('case-c3-3006-orphan-realized-remaining')).toBe('remaining=438000');
  });

  it('三個反例與整體結果皆 pass', () => {
    render(<SignalArithmeticHarnessEntry />);
    expect(text('case-total')).toBe('case_total=3');
    expect(text('case-pass')).toBe('case_pass=3');
    expect(text('overall')).toBe('overall=pass');
  });

  it('fixture mode hard-block：fetch / XHR / sendBeacon 全部爆炸且被計數', () => {
    render(<SignalArithmeticHarnessEntry />);
    expect(() => window.fetch('/any')).toThrow(/blocked network: fetch/);
    expect(() => new XMLHttpRequest().open('GET', '/any')).toThrow(/blocked network: xhr/);
    expect(() => navigator.sendBeacon('/any')).toThrow(/blocked network: sendBeacon/);
  });
});

describe('SignalArithmeticHarnessEntry · route + host gate', () => {
  it('route 無條件註冊且以 guarded() 包裹', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'src/routes/harnessRoutes.tsx'), 'utf8');
    expect(src).toContain('path="/e2e/signal-arithmetic-harness"');
    expect(src).toContain('element={guarded(<SignalArithmeticHarnessEntry />)}');
    expect(src).toContain('lazy(() => import("../pages/SignalArithmeticHarnessEntry"))');
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
