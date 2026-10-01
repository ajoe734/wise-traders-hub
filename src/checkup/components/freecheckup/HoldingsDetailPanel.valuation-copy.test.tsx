import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ValuationBandHeadline } from './HoldingsDetailPanel';
import { ValuationRulersView, basisVerificationText, expectationGap, impliedMultiple } from './ValuationRulers';
import { buildValuationScenario, type ValuationScenario } from '@/checkup/lib/valuationScenario';
import { buildValuationView } from '@/checkup/lib/valuationRulers';
import { currentPriceRequirement } from './CustomMultiplesEditor';
import { EMPTY_CUSTOM } from '@/checkup/lib/drawerPrefs';

const WB = { ink: '#292520', inkSub: '#6b645c', inkMute: '#98918a', inkLight: '#b9b4ae', hair: '#ddd8d0', accent: '#b34832', surface: '#fff' };
const view = buildValuationView({ symbol: 'fixture', asOf: '2026-09-23', source: '公開資料', pe: null, pb: null, dividendYield: null, industry: null, history: { pe: [], pb: [], dividendYield: [] }, peerScope: null, peerIndustry: null, peers: [], trend: [] });

function scenario(source: 'official' | 'fallback' | 'unknown', preferredUnknown: boolean): ValuationScenario {
  const value = buildValuationScenario('2026-10-01', (['pe', 'pb', 'ps'] as const).map((key) => ({
    key,
    basis: { value: 1, unit: 'TWD/share' as const, period: '2026Q2', publishedAt: '2026-10-01', source: '公開財報', kind: 'reported' as const, shareBasis: '一致股數' },
    multipleIssue: '樣本不足',
  })));
  value.shareVerification = { source, preferredUnknown };
  return value;
}

function renderBoth(band: ValuationScenario) {
  render(<>
    <ValuationBandHeadline WB={WB} band={band} loading={false} error={false} stale={false} />
    <ValuationRulersView WB={WB} view={view} band={band} currentPrice={100} defaultBasisOpen status="ready" error={null} stale={false} onRetry={() => {}} />
  </>);
  return {
    headline: screen.getByTestId('valuation-band-headline').textContent ?? '',
    details: screen.getByTestId('valuation-summary').textContent ?? '',
  };
}

describe('財報分母與股數核對來源文案', () => {
  it('官方 TWSE／TPEx 名錄成功時，兩處都顯示已核實', () => {
    const text = basisVerificationText(scenario('official', false));
    expect(text).toBe('財報分母 3/3 已核實');
    const rendered = renderBoth(scenario('official', false));
    expect(rendered.headline).toContain(text);
    expect(rendered.details).toContain(text);
  });

  it('FinMind 後備且特別股未知時，兩處都保守揭露', () => {
    const text = '財報分母 3/3 已計算；股數採 FinMind 後備核對，特別股待官方確認';
    const rendered = renderBoth(scenario('fallback', true));
    expect(rendered.headline).toContain(text);
    expect(rendered.details).toContain(text);
    expect(rendered.headline + rendered.details).not.toContain('已核實');
  });

  it('來源未知時，兩處只說已計算', () => {
    const text = '財報分母 3/3 已計算';
    const rendered = renderBoth(scenario('unknown', false));
    expect(rendered.headline).toContain(text);
    expect(rendered.details).toContain(text);
    expect(rendered.headline + rendered.details).not.toMatch(/已核實|官方名錄|後備核對/);
  });
});

describe('選尺與現價要求', () => {
  it('上方只顯示付費使用者可採取的白話引導', () => {
    render(<ValuationBandHeadline WB={WB} band={scenario('official', false)} loading={false} error={false} stale={false} />);
    expect(screen.getByTestId('valuation-reference-summary').textContent).toBe('先看現價要多少獲利，再選一把尺試算自己的價格。');
    expect(screen.getByTestId('valuation-reference-summary').textContent).not.toMatch(/不能互相取交集|三尺回答不同問題/);
  });

  it('逐尺計算現價隱含倍數，不把歷史範圍稱為高低估', () => {
    const band = scenario('official', false);
    expect(impliedMultiple(100, band.rows[0])).toBe(100);
    expect(expectationGap(25, 10, 20)).toBe('高於歷史範圍 25% 的倍數期待差距');
    render(<ValuationRulersView WB={WB} view={view} band={band} currentPrice={100} status="ready" error={null} stale={false} onRetry={() => {}} />);
    expect(screen.getByTestId('valuation-selection-conclusion').textContent).toContain('尚不能判定合理價');
    expect(screen.getByTestId('valuation-implied-pe').textContent).toContain('現價隱含 100 倍');
    expect(screen.getByTestId('valuation-requirement-pe').textContent).not.toMatch(/高估|低估/);
  });

  it('分母不可用時顯示該尺原因，不籠統寫資料不足', () => {
    const band = buildValuationScenario('2026-10-01', [
      { key: 'pe', notApplicable: 'TTM 盈餘≤0，PE 不適用' },
      { key: 'pb', basis: { value: 40, unit: 'TWD/share', period: '2026Q2', publishedAt: '2026-10-01', source: '公開財報', kind: 'reported', shareBasis: '一致股數' }, multipleIssue: '樣本不足' },
      { key: 'ps', basis: { value: 25, unit: 'TWD/share', period: '2026Q2', publishedAt: '2026-10-01', source: '公開財報', kind: 'reported', shareBasis: '一致股數' }, multipleIssue: '樣本不足' },
    ]);
    render(<ValuationRulersView WB={WB} view={view} band={band} currentPrice={80} status="ready" error={null} stale={false} onRetry={() => {}} />);
    expect(screen.getByTestId('valuation-requirement-pe').textContent).toContain('TTM 盈餘≤0，PE 不適用');
    expect(screen.getByTestId('valuation-implied-pb').textContent).toContain('現價隱含 2 倍');
  });
});

describe('個人情境的現價反推要求', () => {
  const input = (primaryKey: 'pe' | 'pb' | 'ps', low = 20, high = 25) => ({
    ...EMPTY_CUSTOM,
    primaryKey,
    multiple: { low, high },
  });

  it('PE 以同期間年度或 TTM EPS 反推，並核對 2454 範例', () => {
    expect(currentPriceRequirement(4980, input('pe'))).toBe('以你選的 20–25 倍，現在股價 NT$4,980.00 需要每股獲利介於 NT$199.20–NT$249.00（預期年度或 TTM 口徑，須與你填入的預期分母期間一致）。這是現價反推要求，不是合理價。');
  });

  it('PB 使用每股淨值口徑', () => {
    expect(currentPriceRequirement(100, input('pb', 2, 4))).toContain('需要每股淨值介於 NT$25.00–NT$50.00（每股淨值口徑）');
  });

  it('PS 使用同期間年度或 TTM 每股營收口徑', () => {
    expect(currentPriceRequirement(300, input('ps', 3, 6))).toContain('需要每股營收介於 NT$50.00–NT$100.00（預期年度或 TTM 口徑，須與你填入的預期分母期間一致）');
  });

  it.each([
    ['無現價', null, input('pe')],
    ['零現價', 0, input('pe')],
    ['負現價', -1, input('pe')],
    ['零倍數', 4980, input('pe', 0, 25)],
    ['負倍數', 4980, input('pe', -20, 25)],
    ['上下限顛倒', 4980, input('pe', 25, 20)],
    ['未選尺', 4980, { ...EMPTY_CUSTOM, multiple: { low: 20, high: 25 } }],
  ])('%s 時不顯示', (_label, price, value) => {
    expect(currentPriceRequirement(price as number | null, value)).toBeNull();
  });
});