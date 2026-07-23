import { describe, it, expect } from 'vitest';
import { pickSignalCurrency, pickSignalCurrencyWithSource } from '../SignalRow';
import { getAssetSpec, type AssetClass } from '@/lib/asset';

const specOf = (a: AssetClass) => getAssetSpec(a).currency;

describe('pickSignalCurrency — 週記管理列表幣別判定', () => {
  // ── 1. 明確 signal.currency (explicit) ─────────────────────────────────────
  describe('明確 signal.currency 優先', () => {
    it('USD 明確覆寫任何 asset_class / 代號', () => {
      expect(pickSignalCurrency({ currency: 'USD', instrument: '2330' }, 'TWD')).toBe('USD');
      expect(pickSignalCurrency({ currency: 'USD', instrument: '2330' }, specOf('tw_stock'))).toBe('USD');
      const r = pickSignalCurrencyWithSource({ currency: 'USD', instrument: '2330' }, 'TWD');
      expect(r).toEqual({ currency: 'USD', source: 'explicit' });
    });

    it('TWD 明確覆寫美股 asset_class 與美股代號', () => {
      expect(pickSignalCurrency({ currency: 'TWD', instrument: 'AAPL' }, 'USD')).toBe('TWD');
      expect(pickSignalCurrency({ currency: 'TWD', instrument: 'AAPL' }, specOf('us_stock'))).toBe('TWD');
      const r = pickSignalCurrencyWithSource({ currency: 'TWD', instrument: 'AAPL' }, 'USD');
      expect(r).toEqual({ currency: 'TWD', source: 'explicit' });
    });

    it('HKD（非支援幣別）忽略，走後續 fallback 鏈', () => {
      // asset_class 美股 → USD
      expect(pickSignalCurrency({ currency: 'HKD', instrument: '0700' }, 'USD')).toBe('USD');
      // 台股 spec + 台股代號 → TWD
      expect(pickSignalCurrency({ currency: 'HKD', instrument: '2330' }, 'TWD')).toBe('TWD');
      // 完全無資訊 → defaultCurrency
      const r = pickSignalCurrencyWithSource({ currency: 'HKD' }, 'TWD', 'TWD');
      expect(r).toEqual({ currency: 'TWD', source: 'default-fallback' });
    });

    it('其他非法值（JPY / EUR / 空字串 / null / undefined / 數字）皆不採用', () => {
      for (const bad of ['JPY', 'EUR', 'CNY', '', null, undefined, 0, 123, {}, []]) {
        const r = pickSignalCurrencyWithSource({ currency: bad, instrument: 'AAPL' }, 'USD');
        expect(r.source).not.toBe('explicit');
        expect(r.currency).toBe('USD');
      }
    });
  });

  // ── 2. asset_class 導出 spec.currency ────────────────────────────────────
  describe('asset_class spec.currency（缺 explicit 時）', () => {
    it.each<[AssetClass, 'USD' | 'TWD']>([
      ['us_stock', 'USD'],
      ['us_option', 'USD'],
      ['us_future', 'USD'],
      ['crypto', 'USD'],
      ['tw_stock', 'TWD'],
    ])('%s → %s', (cls, expected) => {
      const spec = specOf(cls);
      // 用不可推斷的 instrument 避免 fallback 幹擾
      const r = pickSignalCurrencyWithSource({ instrument: '???' }, spec, 'TWD');
      if (expected === 'USD') {
        expect(r).toEqual({ currency: 'USD', source: 'asset-class' });
      } else {
        // tw_stock spec 是 TWD，實作把非 USD 都當「不是 asset-class 訊號」
        // 因此會落到 default-fallback（TWD）
        expect(r.currency).toBe('TWD');
        expect(r.source).toBe('default-fallback');
      }
    });

    it('us_option + 台股代號：asset-class 勝出（USD）', () => {
      const r = pickSignalCurrencyWithSource({ instrument: '2330' }, specOf('us_option'));
      expect(r).toEqual({ currency: 'USD', source: 'asset-class' });
    });

    it('crypto + BTC：asset-class 勝出（USD）', () => {
      const r = pickSignalCurrencyWithSource({ instrument: 'BTC' }, specOf('crypto'));
      expect(r).toEqual({ currency: 'USD', source: 'asset-class' });
    });
  });

  // ── 3. instrument 代號推斷 ────────────────────────────────────────────────
  describe('inferred-instrument（spec 非 USD 且無 explicit）', () => {
    it.each([
      ['AAPL', 'USD'],
      ['TSLA', 'USD'],
      ['INTC', 'USD'],
      ['SPCX', 'USD'],
      ['BRK.B', 'USD'],
      ['META Meta Platforms', 'USD'],
      ['2330', 'TWD'],
      ['2330 台積電', 'TWD'],
      ['00631L', 'TWD'],
      ['006208 富邦台50', 'TWD'],
    ] as const)('instrument=%s → %s', (instrument, expected) => {
      const r = pickSignalCurrencyWithSource({ instrument }, 'TWD', expected === 'USD' ? 'TWD' : 'USD');
      expect(r.currency).toBe(expected);
      expect(r.source).toBe('inferred-instrument');
    });
  });

  // ── 4. default-fallback ──────────────────────────────────────────────────
  describe('default-fallback（前三層都失敗）', () => {
    it('無 currency、instrument 無法推斷 → 回 defaultCurrency', () => {
      expect(pickSignalCurrencyWithSource({}, 'TWD', 'TWD'))
        .toEqual({ currency: 'TWD', source: 'default-fallback' });
      expect(pickSignalCurrencyWithSource({}, 'TWD', 'USD'))
        .toEqual({ currency: 'USD', source: 'default-fallback' });
      expect(pickSignalCurrencyWithSource({ instrument: '比特幣' }, 'TWD', 'USD'))
        .toEqual({ currency: 'USD', source: 'default-fallback' });
    });

    it('defaultCurrency 省略時預設 TWD', () => {
      const r = pickSignalCurrencyWithSource({}, 'TWD');
      expect(r).toEqual({ currency: 'TWD', source: 'default-fallback' });
    });
  });

  // ── 5. 優先序矩陣（explicit > asset-class > inferred > default） ──────────
  describe('優先序矩陣', () => {
    const cases: Array<{
      name: string;
      signal: any;
      spec: 'USD' | 'TWD';
      def: 'USD' | 'TWD';
      expected: { currency: 'USD' | 'TWD'; source: string };
    }> = [
      {
        name: 'explicit USD > asset-class TWD > inferred TWD > default TWD',
        signal: { currency: 'USD', instrument: '2330' },
        spec: 'TWD', def: 'TWD',
        expected: { currency: 'USD', source: 'explicit' },
      },
      {
        name: 'no explicit → asset-class USD 勝過台股代號',
        signal: { instrument: '2330' },
        spec: 'USD', def: 'TWD',
        expected: { currency: 'USD', source: 'asset-class' },
      },
      {
        name: 'no explicit, spec TWD → inferred USD 勝過 default TWD',
        signal: { instrument: 'AAPL' },
        spec: 'TWD', def: 'TWD',
        expected: { currency: 'USD', source: 'inferred-instrument' },
      },
      {
        name: '全部無 → default USD',
        signal: { instrument: '未知' },
        spec: 'TWD', def: 'USD',
        expected: { currency: 'USD', source: 'default-fallback' },
      },
    ];

    for (const c of cases) {
      it(c.name, () => {
        expect(pickSignalCurrencyWithSource(c.signal, c.spec, c.def)).toEqual(c.expected);
      });
    }
  });

  // ── 6. 邊界輸入 ──────────────────────────────────────────────────────────
  describe('邊界輸入', () => {
    it('signal 為 null / undefined 也不 throw', () => {
      expect(() => pickSignalCurrency(null as any, 'TWD')).not.toThrow();
      expect(() => pickSignalCurrency(undefined as any, 'USD')).not.toThrow();
      expect(pickSignalCurrencyWithSource(null as any, 'USD')).toEqual({ currency: 'USD', source: 'asset-class' });
      expect(pickSignalCurrencyWithSource(undefined as any, 'TWD')).toEqual({ currency: 'TWD', source: 'default-fallback' });
    });

    it('instrument 為空字串 / 空白 → 無法推斷', () => {
      expect(pickSignalCurrencyWithSource({ instrument: '' }, 'TWD').source).toBe('default-fallback');
      expect(pickSignalCurrencyWithSource({ instrument: '   ' }, 'TWD').source).toBe('default-fallback');
    });
  });
});
