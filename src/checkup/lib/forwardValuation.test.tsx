// 測試 fixture 取自公開資料（僅測試，禁止進產品）：
// 行情 2026-10-02 世芯 3661=3810；FactSet 2026-09-21 FY2027 EPS 中位 186.69（cnyes 6611574）；
// ToAlpha FY2027：聯發科 35.03 倍、創意 71.03 倍（批次日期未核）；前瞻快照 18.9565/21.0554/27.6305 為近一年六次 FY2027 快照之部分值。
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildCustomScenario, buildValuationScenario, EMPTY_CUSTOM, type CustomScenarioInput } from './valuationScenario';
import { buildForwardEvidence, nearYearTtm, periodMismatch, PROBABILITY_UNKNOWN } from './forwardValuation';
import { currentPriceRequirement, ForwardEvidencePanel } from '@/checkup/components/freecheckup/CustomMultiplesEditor';
import { sanitizeCustomInput } from './drawerPrefs';

const WB = { ink: '#292520', inkSub: '#6b645c', inkMute: '#98918a', inkLight: '#b9b4ae', hair: '#ddd8d0', accent: '#b34832', surface: '#fff' };
const basis = (value: number) => ({ value, unit: 'TWD/share' as const, period: '2026Q2 TTM', publishedAt: '2026-08-14', source: '公開財報', kind: 'reported' as const, shareBasis: '一致股數' });
const sample = (date: string, multiple: number) => ({ quarter: date.slice(0, 7), deadline: date, date, close: 1, basis: 1, multiple, growthYoY: null, netMargin: null, cashRatio: null, debtRatio: null, used: true, excluded: null });
const scenario = buildValuationScenario('2026-10-02', [
  { key: 'pe', basis: basis(120), multipleIssue: '同業 0 家', samples: [sample('2025-05-30', 60), sample('2025-11-28', 30), sample('2026-08-31', 40)] },
  { key: 'pb', basis: basis(300), multipleIssue: '同業 0 家' },
  { key: 'ps', notApplicable: '營收口徑不一致' },
]);
const input = (over: Partial<CustomScenarioInput> = {}): CustomScenarioInput => ({
  ...EMPTY_CUSTOM, primaryKey: 'pe', expectedBasis: 186.69, multiple: { low: 20, high: 25 },
  stressBasis: 150, stressMultiple: 15, source: 'ToAlpha FY2027 同業', date: '2026-10-02', assumption: 'ASIC 成長延續', invalidation: '大客戶轉單',
  basisPeriod: 'FY2027', basisSource: 'FactSet 共識中位', basisDate: '2026-09-21', multipleKind: 'forward', ...over,
});

describe('前瞻條件情境（3661 公開 fixture）', () => {
  it('同期間 FY2027 EPS × 前瞻倍數：186.69×20/25', () => {
    const c = buildCustomScenario(scenario, input(), '2026-10-04');
    expect(c.status).toBe('ready');
    expect(c.low).toBeCloseTo(3733.8, 6);
    expect(c.high).toBeCloseTo(4667.25, 6);
  });
  it('現價反推：3810÷25/20＝152.40/190.50', () => {
    expect(currentPriceRequirement(3810, input())).toContain('NT$152.40–NT$190.50');
  });
  it('歷史 TTM 倍數不能乘前瞻 EPS，不產生情境價', () => {
    const c = buildCustomScenario(scenario, input({ multipleKind: 'ttm' }), '2026-10-04');
    expect(c.status).toBe('invalid');
    expect(c.problems.join()).toContain('歷史 TTM 倍數不能乘前瞻分母');
    expect(periodMismatch('pb', 'FY2027', 'ttm')).toBeNull();
  });
  it('缺分母期間/來源/資料日時不套用；舊 v2 資料保留不改寫', () => {
    const legacy = sanitizeCustomInput({ primaryKey: 'pe', expectedBasis: 65, multiple: { low: 20, high: 25 }, source: 'x' });
    expect(legacy.expectedBasis).toBe(65);
    const c = buildCustomScenario(scenario, legacy, '2026-10-04');
    expect(c.status).toBe('invalid');
    expect(c.problems).toEqual(expect.arrayContaining(['請選預期分母期間（年度或未來四季）', '缺預期分母來源']));
  });
  it('資料日晚於今天不接受', () => {
    expect(buildCustomScenario(scenario, input({ basisDate: '2026-12-01' }), '2026-10-04').problems).toContain('分母資料日不可晚於今天');
  });
});

describe('前瞻／同業／近一年證據', () => {
  it('provider 只有 TTM：前瞻分母標缺口，不借用前瞻標籤', () => {
    const ev = buildForwardEvidence(scenario, 'pe', null);
    expect(ev.forwardBasis.status).toBe('missing');
    expect(ev.probability).toBe(PROBABILITY_UNKNOWN);
  });
  it('近一年 TTM 只取估值日前 365 天', () => {
    expect(nearYearTtm(scenario.rows[0], '2026-10-02')).toMatchObject({ low: 30, high: 40, n: 2 });
  });
  it('前瞻快照只稱公開快照；同業缺折溢價理由只列未調整參照', () => {
    const ev = buildForwardEvidence(scenario, 'pe', input({ ownSamples: '18.9565, 21.0554, 27.6305', peerMultiple: 35.03, peerSource: 'ToAlpha 聯發科' }));
    expect(ev.ownForward).toMatchObject({ low: 18.9565, high: 27.6305, n: 3, median: 21.0554 });
    expect(ev.ownForward?.note).toContain('非完整每日分布');
    expect(ev.userPeer?.adjusted).toBe(false);
    expect(ev.userPeer?.text).toContain('未調整參照');
    expect(ev.userPeer?.vsUserLow).toBe('你的倍數下限相對同業 折價 43%');
    const adj = buildForwardEvidence(scenario, 'pe', input({ peerMultiple: 71.03, peerAdjustment: '創意客戶結構不同' }));
    expect(adj.userPeer?.adjusted).toBe(true);
  });
  it('面板渲染：無系統合理價字樣、機率未知', () => {
    render(<ForwardEvidencePanel WB={WB} scenario={scenario} input={input({ ownSamples: '18.9565,21.0554,27.6305' })} />);
    const t = screen.getByTestId('forward-evidence').textContent ?? '';
    expect(t).toContain('FY2027 每股獲利 NT$186.69');
    expect(t).toContain('FactSet 共識中位');
    expect(t).toContain('不乘前瞻分母');
    expect(t).toContain('機率未知');
    expect(t).not.toMatch(/系統合理價|\d+%機率/);
  });
  it('未選尺不渲染', () => {
    const { container } = render(<ForwardEvidencePanel WB={WB} scenario={scenario} input={{ ...EMPTY_CUSTOM }} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('週末取得時間晚於最近交易日', () => {
  const live = (deadline: string) => ({ ...basis(60.69), publishedAt: '2026-10-03', availability: { mode: 'live' as const, dataPeriod: '2026Q2', deadline, fetchedAt: '2026-10-03', note: '資料期＋取得時間' } });
  it('live 且法定期限已過 → 分母可用', () => {
    expect(buildValuationScenario('2026-10-02', [{ key: 'pe', basis: live('2026-08-14') }]).rows[0].basisOk).toBe(true);
  });
  it('live 但法定期限晚於估值日 → 仍拒絕', () => {
    expect(buildValuationScenario('2026-10-02', [{ key: 'pe', basis: live('2026-11-14') }]).rows[0].basisOk).toBe(false);
  });
  it('非 live 的公告日晚於估值日 → 拒絕', () => {
    expect(buildValuationScenario('2026-10-02', [{ key: 'pe', basis: { ...basis(1), publishedAt: '2026-10-03' } }]).rows[0].basisOk).toBe(false);
  });
});
