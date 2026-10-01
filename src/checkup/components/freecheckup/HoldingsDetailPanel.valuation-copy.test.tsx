import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ValuationBandHeadline } from './HoldingsDetailPanel';
import { ValuationRulersView, basisVerificationText } from './ValuationRulers';
import { buildValuationScenario, type ValuationScenario } from '@/checkup/lib/valuationScenario';
import { buildValuationView } from '@/checkup/lib/valuationRulers';

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
    <ValuationRulersView WB={WB} view={view} band={band} defaultBasisOpen status="ready" error={null} stale={false} onRetry={() => {}} />
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