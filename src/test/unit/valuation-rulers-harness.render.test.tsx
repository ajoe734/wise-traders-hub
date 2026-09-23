/**
 * 真正渲染 ValuationRulersHarnessEntry：證明估值三把尺全部走 production
 * valuationRulers / useValuationSnapshot / ValuationRulersView，
 * 且 fixture 模式零 supabase、零網路、零 mutation。
 */
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) },
}));

import ValuationRulersHarnessEntry, {
  HARNESS_MARKER,
  runValuationScenarios,
  createFakeValuationGateway,
} from '@/pages/ValuationRulersHarnessEntry';

const text = (id: string) => screen.getByTestId(id).textContent;
const SCENARIOS = [
  's1-normal', 's2-no-earnings', 's3-financial', 's4-insufficient',
  's5-winsorize', 's6-zero-dividend', 's7-no-peer', 's8-no-advice',
];

describe('ValuationRulersHarnessEntry', () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  it('marker / 零 mutation / 零 supabase', async () => {
    render(<ValuationRulersHarnessEntry />);
    await waitFor(() => expect(text('scenario-total')).toBe(`scenario_total=${SCENARIOS.length}`));
    expect(HARNESS_MARKER).toBe('VALUATION_RULERS_V1');
    expect(text('build-marker')).toBe('build_marker=VALUATION_RULERS_V1');
    expect(text('mutation-calls')).toBe('mutation_calls=0');
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('八類案例全部 pass', async () => {
    render(<ValuationRulersHarnessEntry />);
    await waitFor(() => expect(text('scenario-pass')).toBe(`scenario_pass=${SCENARIOS.length}`));
    for (const id of SCENARIOS) {
      expect(screen.getByTestId(`scenario-status-${id}`).textContent).toBe('pass');
    }
    expect(text('overall')).toBe('overall=pass');
  });

  it('runValuationScenarios 為純函式，可單獨全過', () => {
    const rows = runValuationScenarios();
    expect(rows.map((r) => r.id)).toEqual(SCENARIOS);
    expect(rows.every((r) => r.ok)).toBe(true);
  });

  it('fixture mode hard-block：fetch / XHR / sendBeacon 全部爆炸', async () => {
    render(<ValuationRulersHarnessEntry />);
    await waitFor(() => expect(text('scenario-total')).toBe(`scenario_total=${SCENARIOS.length}`));
    expect(() => window.fetch('/any')).toThrow(/blocked network: fetch/);
    expect(() => new XMLHttpRequest().open('GET', '/any')).toThrow(/blocked network: xhr/);
    expect(() => navigator.sendBeacon('/any')).toThrow(/blocked network: sendBeacon/);
  });

  it('三斷點皆渲染出三把尺，且 as-of / 來源可見', async () => {
    render(<ValuationRulersHarnessEntry />);
    for (const label of ['desktop-1440', 'laptop-1024', 'mobile-390']) {
      const frame = await screen.findByTestId(`live-frame-${label}`);
      const scope = within(frame);
      await waitFor(() => scope.getByTestId('valuation-rulers'));
      expect(scope.getByTestId('valuation-ruler-pe')).toBeTruthy();
      expect(scope.getByTestId('valuation-ruler-pb')).toBeTruthy();
      expect(scope.getByTestId('valuation-ruler-dividendYield')).toBeTruthy();
      expect(scope.getByTestId('valuation-asof').textContent).toContain('2026/09/18');
      // 顏色不單獨承載意義：每把尺都有文字標籤
      for (const k of ['pe', 'pb', 'dividendYield']) {
        expect(scope.getByTestId(`valuation-band-${k}`).textContent?.trim().length).toBeGreaterThan(0);
      }
      // 金融股提示與同業中位數
      expect(scope.getByTestId('valuation-financial-note')).toBeTruthy();
      expect(scope.getByTestId('valuation-peer-row').textContent).toContain('同業中位數');
      // 不得出現買賣建議
      expect(scope.getByTestId('valuation-summary').textContent || '').not.toMatch(/買|賣|加碼|減碼/);
    }
  });

  it('同業明細可展開／收合', async () => {
    render(<ValuationRulersHarnessEntry />);
    const frame = await screen.findByTestId('live-frame-mobile-390');
    const scope = within(frame);
    await waitFor(() => scope.getByTestId('valuation-peer-expand'));
    expect(scope.queryByTestId('valuation-peer-detail')).toBeNull();
    fireEvent.click(scope.getByTestId('valuation-peer-expand'));
    const detail = scope.getByTestId('valuation-peer-detail').textContent || '';
    expect(detail).toContain('2881');
    expect(detail).toMatch(/2881\s+富邦金/);
    expect(detail).toMatch(/2886\s+兆豐金/);
    fireEvent.click(scope.getByTestId('valuation-peer-expand'));
    expect(scope.queryByTestId('valuation-peer-detail')).toBeNull();
  });

  it('error state 顯示重試按鈕', async () => {
    render(<ValuationRulersHarnessEntry />);
    const frame = await screen.findByTestId('live-frame-error-state');
    await waitFor(() => within(frame).getByTestId('valuation-error'));
    expect(within(frame).getByTestId('valuation-retry')).toBeTruthy();
  });

  it('fake gateway 只允許唯讀 rpc，其它成員一律拋錯（零副作用）', async () => {
    const { gateway, spy } = createFakeValuationGateway('2882');
    await gateway.rpc('valuation_snapshot', { _symbol: '2882' });
    expect(spy.rpcCalls).toEqual(['valuation_snapshot:2882']);
    expect(() => (gateway as any).db.from('trade_records')).toThrow(/blocked db.from/);
    expect(() => (gateway as any).invoke('x')).toThrow(/blocked invoke/);
    expect(() => (gateway as any).http.json('/x')).toThrow(/blocked http.json/);
    expect(spy.mutations).toBe(3);
  });
});

describe('ValuationRulersHarnessEntry · route + host gate', () => {
  it('route 無條件註冊且以 guarded() 包裹', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'src/routes/harnessRoutes.tsx'), 'utf8');
    expect(src).toContain('path="/e2e/valuation-rulers-harness"');
    expect(src).toContain('element={guarded(<ValuationRulersHarnessEntry />)}');
    expect(src).toContain('lazy(() => import("../pages/ValuationRulersHarnessEntry"))');
  });

  it('host gate：僅 local / preview host 可達，正式與 lookalike 一律拒絕', async () => {
    const { isHarnessHostAllowed } = await import('@/routes/harnessHostGate');
    for (const h of ['localhost', '127.0.0.1', 'preview--wise-traders-hub.lovable.app',
      'id-preview--0f5bdae6-cb07-4e2a-88dc-334c90cb5b02.lovable.app',
      '0f5bdae6-cb07-4e2a-88dc-334c90cb5b02.lovableproject.com']) {
      expect(isHarnessHostAllowed(h)).toBe(true);
    }
    for (const h of ['legendflow.tw', 'www.legendflow.tw', 'wise-traders-hub.lovable.app',
      'preview--x.lovable.app.evil.com', 'sub.0f5bdae6.lovableproject.com', '']) {
      expect(isHarnessHostAllowed(h)).toBe(false);
    }
  });
});
