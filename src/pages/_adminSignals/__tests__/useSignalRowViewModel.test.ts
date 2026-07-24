import { describe, it, expect } from 'vitest';
import { buildSignalRowViewModel } from '../useSignalRowViewModel';

const base = {
  isMentor: false,
  isAdvisor: true,
  openInstruments: new Set<string>(),
  addBuySignalIds: new Set<string>(),
  batchInfo: new Map<string, { count: number }>(),
  collapsedBatches: new Set<string>(),
  defaultCurrency: 'TWD' as const,
  defaultAssetClass: 'tw_stock',
};

function vm(signal: any, over: Partial<typeof base> = {}) {
  return buildSignalRowViewModel({ ...base, ...over, signal });
}

describe('buildSignalRowViewModel — 唯一資料入口', () => {
  describe('holdingStatus toneKey 覆蓋 7 種 action', () => {
    const cases: Array<[string, { openHas?: boolean; addBuy?: boolean; expect: { label: string; toneKey: string } }]> = [
      ['teaching', { expect: { label: '教學', toneKey: 'mentor' } }],
      ['hold',     { expect: { label: '觀察', toneKey: 'neutral' } }],
      ['exit',     { expect: { label: '已平倉', toneKey: 'muted' } }],
      ['add',      { expect: { label: '加碼', toneKey: 'info' } }],
      ['buy',      { expect: { label: '持有中', toneKey: 'neutral' } }],
    ];
    it.each(cases)('%s → %o', (action, c) => {
      const v = vm({ id: 'x', action, instrument: 'AAPL' });
      expect(v.holdingStatus).toEqual(c.expect);
    });

    it('sell + openInstruments 含該標的 → 減碼 warn', () => {
      const v = vm({ id: 'x', action: 'sell', instrument: '2330' }, { openInstruments: new Set(['2330']) });
      expect(v.holdingStatus).toEqual({ label: '減碼', toneKey: 'warn' });
    });
    it('sell + openInstruments 不含 → 已平倉 muted', () => {
      const v = vm({ id: 'x', action: 'sell', instrument: '2330' });
      expect(v.holdingStatus.toneKey).toBe('muted');
    });
    it('buy + addBuySignalIds 含 → 加碼 info', () => {
      const v = vm({ id: 'sig-1', action: 'buy', instrument: '2330' }, { addBuySignalIds: new Set(['sig-1']) });
      expect(v.holdingStatus).toEqual({ label: '加碼', toneKey: 'info' });
    });
  });

  describe('currency source 四種來源', () => {
    it('explicit → isInferred=false', () => {
      const v = vm({ id: 'x', action: 'buy', instrument: 'AAPL', currency: 'USD', asset_class: 'us_stock' });
      expect(v.currency).toMatchObject({ code: 'USD', source: 'explicit', isInferred: false });
    });
    it('asset-class → isInferred=true', () => {
      const v = vm({ id: 'x', action: 'buy', instrument: 'SPCX', asset_class: 'us_stock' }, { defaultAssetClass: 'us_stock' });
      expect(v.currency).toMatchObject({ code: 'USD', source: 'asset-class', isInferred: true });
    });
    it('inferred-instrument', () => {
      const v = vm({ id: 'x', action: 'buy', instrument: 'AAPL' }, { defaultAssetClass: null });
      expect(v.currency.source).toBe('inferred-instrument');
    });
    it('default-fallback', () => {
      const v = vm({ id: 'x', action: 'buy', instrument: '比特幣' }, { defaultAssetClass: null });
      expect(v.currency.source).toBe('default-fallback');
    });
  });

  describe('teaching 與 batchBadge', () => {
    it('教學 signal → displayInstrument=null、reasonSummaryPreview 仍計算', () => {
      const v = vm({ id: 'x', action: 'teaching', reason_summary: 'lesson' });
      expect(v.displayInstrument).toBeNull();
      expect(v.isTeaching).toBe(true);
    });
    it('batch count > 1 且已折疊 → batchBadge.collapsed=true', () => {
      const batchInfo = new Map([['b1', { count: 3 }]]);
      const v = vm({ id: 'x', action: 'buy', instrument: '2330', batch_id: 'b1' },
        { batchInfo, collapsedBatches: new Set(['b1']) });
      expect(v.batchBadge).toEqual({ count: 3, collapsed: true });
      expect(v.displayInstrument?.text).toContain('等 3 檔');
    });
    it('batch count = 1 → batchBadge=null', () => {
      const batchInfo = new Map([['b1', { count: 1 }]]);
      const v = vm({ id: 'x', action: 'buy', instrument: '2330', batch_id: 'b1' }, { batchInfo });
      expect(v.batchBadge).toBeNull();
    });
  });

  describe('publishStatus 依 isMentor 產生', () => {
    it('非 mentor → publishStatus=null', () => {
      const v = vm({ id: 'x', action: 'buy', status: 'pending' });
      expect(v.publishStatus).toBeNull();
    });
    it('mentor + pending → 待發布 mentor tone', () => {
      const v = vm({ id: 'x', action: 'buy', status: 'pending' }, { isMentor: true });
      expect(v.publishStatus).toEqual({ label: '待發布', toneKey: 'mentor' });
    });
    it('mentor + published → 已發布 success tone', () => {
      const v = vm({ id: 'x', action: 'buy', status: 'published' }, { isMentor: true });
      expect(v.publishStatus).toEqual({ label: '已發布', toneKey: 'success' });
    });
  });

  it('actions: 非 advisor → canRepush=false', () => {
    const v = vm({ id: 'x', action: 'buy', status: 'published' }, { isAdvisor: false });
    expect(v.actions.canRepush).toBe(false);
  });
});
