/**
 * exportJournalPdf.resolvePdfQuantityUnit 單一資料源合約測試
 *
 * 憲法（單位單一資料源）：
 *   - us_stock  → 「股」（絕不能是「張」）
 *   - us_future → 「口」
 *   - us_option → 「口」
 *   - crypto    → 「顆」
 *   - tw_stock  → 「張」
 *
 * 回歸守門：上游 quantity_unit 為 null、空字串、或錯誤寫成「張」時，
 * PDF 匯出必須以 asset_class 為權威覆寫。expert.asset_class 缺值時，
 * 以 experts.currency === 'USD' 推導 us_stock。
 */
import { describe, it, expect } from 'vitest';
import { resolvePdfQuantityUnit } from '@/lib/exportJournalPdf';

const baseExperts = {
  name: 'x',
  slug: 'x',
  role: 'analyst',
  avatar_url: null,
};

const mk = (over: Partial<Parameters<typeof resolvePdfQuantityUnit>[0]>) =>
  resolvePdfQuantityUnit({
    id: '1',
    instrument: 'AAPL',
    action: 'buy',
    price_hint: 100,
    quantity: 10,
    quantity_unit: null,
    reason_summary: null,
    reason_detail: null,
    risk_notes: null,
    learning_points: null,
    published_at: new Date().toISOString(),
    experts: baseExperts,
    ...over,
  } as any);

describe('exportJournalPdf · resolvePdfQuantityUnit', () => {
  describe('asset_class 直接指定', () => {
    it('us_stock → 股（不能是張）', () => {
      expect(mk({ asset_class: 'us_stock' })).toBe('股');
    });
    it('us_future → 口', () => {
      expect(mk({ asset_class: 'us_future', instrument: '/ES' })).toBe('口');
    });
    it('us_option → 口', () => {
      expect(mk({ asset_class: 'us_option' })).toBe('口');
    });
    it('crypto → 顆', () => {
      expect(mk({ asset_class: 'crypto', instrument: 'BTC' })).toBe('顆');
    });
    it('tw_stock → 張', () => {
      expect(mk({ asset_class: 'tw_stock', instrument: '2330' })).toBe('張');
    });
  });

  describe('quantity_unit 錯值必須被 asset_class 蓋掉', () => {
    it('us_stock + quantity_unit="張" → 覆寫為 股', () => {
      expect(mk({ asset_class: 'us_stock', quantity_unit: '張' })).toBe('股');
    });
    it('us_future + quantity_unit="張" → 覆寫為 口', () => {
      expect(
        mk({ asset_class: 'us_future', instrument: '/ES', quantity_unit: '張' }),
      ).toBe('口');
    });
    it('crypto + quantity_unit="張" → 覆寫為 顆', () => {
      expect(mk({ asset_class: 'crypto', quantity_unit: '張' })).toBe('顆');
    });
  });

  describe('asset_class 缺值 → 由 experts 推導', () => {
    it('experts.asset_class=us_stock → 股', () => {
      expect(
        mk({ experts: { ...baseExperts, asset_class: 'us_stock' } }),
      ).toBe('股');
    });
    it('experts.asset_class 缺、currency=USD → 推導 us_stock → 股', () => {
      expect(
        mk({ experts: { ...baseExperts, currency: 'USD' } }),
      ).toBe('股');
    });
    it('experts.asset_class=us_future → 口', () => {
      expect(
        mk({
          asset_class: null,
          instrument: '/NQ',
          experts: { ...baseExperts, asset_class: 'us_future' },
        }),
      ).toBe('口');
    });
    it('experts 也缺 → 落到 tw_stock/張（唯一容許的預設）', () => {
      expect(mk({ experts: baseExperts })).toBe('張');
    });
  });

  describe('quantity_unit 為合法值時保留', () => {
    it('us_stock + "股" → 股', () => {
      expect(mk({ asset_class: 'us_stock', quantity_unit: '股' })).toBe('股');
    });
    it('us_future + "口" → 口', () => {
      expect(
        mk({ asset_class: 'us_future', instrument: '/ES', quantity_unit: '口' }),
      ).toBe('口');
    });
  });
});
