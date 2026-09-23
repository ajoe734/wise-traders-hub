/**
 * 投組加權估值指數（PORTFOLIO_VALUATION_V1）純函式測試。
 * 對象：computePortfolioValuation / summarizePortfolioValuation / portfolioPremiumText。
 */
import { describe, it, expect } from 'vitest';
import {
  computePortfolioValuation,
  summarizePortfolioValuation,
  portfolioPremiumText,
  PORTFOLIO_VALUATION_CONTRACT,
  type PortfolioValuationInput,
} from '@/checkup/lib/valuationRulers';

/** 造一組同業，其中位數可預測（樣本 ≥ MIN_PEER_N）。 */
function peers(peValues: number[], pbValues: number[] = [], dyValues: number[] = []) {
  const n = Math.max(peValues.length, pbValues.length, dyValues.length);
  return Array.from({ length: n }, (_, i) => ({
    symbol: `P${i}`,
    pe: peValues[i] ?? null,
    pb: pbValues[i] ?? null,
    dividendYield: dyValues[i] ?? null,
  }));
}

const PEERS_10 = peers([8, 9, 10, 11, 12]); // 中位數 10

describe('computePortfolioValuation', () => {
  it('單檔：加權溢價 = 個股溢價', () => {
    const rows: PortfolioValuationInput[] = [
      { symbol: '1234', weight: 100, pe: 12, pb: null, dividendYield: null, peers: PEERS_10 },
    ];
    const r = computePortfolioValuation(rows);
    expect(r.rulers[0].weightedPremium).toBeCloseTo(0.2, 3); // 12/10 - 1
    expect(r.rulers[0].coverage).toBe(1);
    expect(r.rulers[0].n).toBe(1);
    expect(r.rulers[0].text).toBe('高於同業');
  });

  it('多檔：以市值加權，大市值主導結果', () => {
    const rows: PortfolioValuationInput[] = [
      { symbol: 'A', weight: 900, pe: 10, pb: null, dividendYield: null, peers: PEERS_10 }, // 0%
      { symbol: 'B', weight: 100, pe: 20, pb: null, dividendYield: null, peers: PEERS_10 }, // +100%
    ];
    const r = computePortfolioValuation(rows);
    // (900*0 + 100*1.0) / 1000 = 0.1
    expect(r.rulers[0].weightedPremium).toBeCloseTo(0.1, 3);
    expect(r.rulers[0].coverage).toBe(1);
  });

  it('缺值檔不納入該尺，但該尺權重對納入檔重新正規化', () => {
    const rows: PortfolioValuationInput[] = [
      { symbol: 'A', weight: 500, pe: 12, pb: null, dividendYield: null, peers: PEERS_10 }, // +20%
      { symbol: 'B', weight: 500, pe: null, pb: null, dividendYield: null, peers: PEERS_10 }, // 不適用
    ];
    const r = computePortfolioValuation(rows);
    expect(r.rulers[0].weightedPremium).toBeCloseTo(0.2, 3);
    expect(r.rulers[0].coverage).toBe(0.5);
    expect(r.rulers[0].n).toBe(1);
  });

  it('同業樣本不足（n < MIN_PEER_N）整尺不納入', () => {
    const rows: PortfolioValuationInput[] = [
      { symbol: 'A', weight: 100, pe: 12, pb: null, dividendYield: null, peers: peers([10, 11]) },
    ];
    const r = computePortfolioValuation(rows);
    expect(r.rulers[0].weightedPremium).toBeNull();
    expect(r.rulers[0].coverage).toBe(0);
    expect(r.rulers[0].text).toBe('資料不足');
  });

  it('殖利率方向：溢價為正時文字為「殖利率高於同業」', () => {
    const dyPeers = peers([], [], [1, 2, 3, 4, 5]); // 中位數 3
    const rows: PortfolioValuationInput[] = [
      { symbol: 'A', weight: 100, pe: null, pb: null, dividendYield: 6, peers: dyPeers },
    ];
    const r = computePortfolioValuation(rows);
    expect(r.rulers[2].weightedPremium).toBeCloseTo(1.0, 3); // 6/3 - 1
    expect(r.rulers[2].text).toBe('殖利率高於同業');
  });

  it('weight <= 0 或非台股格式由呼叫端過濾；此處 weight<=0 整檔排除', () => {
    const rows: PortfolioValuationInput[] = [
      { symbol: 'A', weight: 0, pe: 12, pb: null, dividendYield: null, peers: PEERS_10 },
      { symbol: 'B', weight: -5, pe: 12, pb: null, dividendYield: null, peers: PEERS_10 },
    ];
    const r = computePortfolioValuation(rows);
    expect(r.totalWeight).toBe(0);
    expect(r.stockCount).toBe(0);
    expect(r.rulers.every((x) => x.weightedPremium === null)).toBe(true);
  });

  it('空陣列回傳全 null，不丟錯', () => {
    const r = computePortfolioValuation([]);
    expect(r.totalWeight).toBe(0);
    expect(summarizePortfolioValuation(r)).toBeNull();
  });

  it('極端值：個股溢價超過 +200% 會被剪裁（防單檔主導）', () => {
    const rows: PortfolioValuationInput[] = [
      { symbol: 'A', weight: 100, pe: 210, pb: null, dividendYield: null, peers: PEERS_10 }, // +2000% → clip +200%
    ];
    const r = computePortfolioValuation(rows);
    expect(r.rulers[0].weightedPremium).toBe(2.0);
  });

  it('極端值：同業端有極端 PE 時中位數仍穩定（winsorize 在 peer 端）', () => {
    const skewed = peers([8, 9, 10, 11, 5000]); // winsorize 後中位數仍接近 10
    const rows: PortfolioValuationInput[] = [
      { symbol: 'A', weight: 100, pe: 10, pb: null, dividendYield: null, peers: skewed },
    ];
    const r = computePortfolioValuation(rows);
    expect(Math.abs((r.rulers[0].weightedPremium as number) - 0) < 0.25).toBe(true);
  });
});

describe('summarizePortfolioValuation', () => {
  it('輸出含每尺數字＋文字＋涵蓋率', () => {
    const rows: PortfolioValuationInput[] = [
      { symbol: 'A', weight: 700, pe: 11, pb: null, dividendYield: null, peers: PEERS_10 },
      { symbol: 'B', weight: 300, pe: 9, pb: null, dividendYield: null, peers: PEERS_10 },
    ];
    const r = computePortfolioValuation(rows);
    const s = summarizePortfolioValuation(r);
    expect(s).toContain('本益比');
    expect(s).toContain('涵蓋 100% 市值');
  });

  it('有效尺為 0 時回 null', () => {
    const r = computePortfolioValuation([
      { symbol: 'A', weight: 100, pe: null, pb: null, dividendYield: null, peers: [] },
    ]);
    expect(summarizePortfolioValuation(r)).toBeNull();
  });
});

describe('portfolioPremiumText 中性語意', () => {
  it('|溢折價| < 10% → 與同業相當', () => {
    expect(portfolioPremiumText('pe', 0.05)).toBe('與同業相當');
    expect(portfolioPremiumText('pb', -0.099)).toBe('與同業相當');
  });
  it('PE/PB 正負 → 高於/低於同業（不含買賣建議字眼）', () => {
    expect(portfolioPremiumText('pe', 0.2)).toBe('高於同業');
    expect(portfolioPremiumText('pb', -0.2)).toBe('低於同業');
    for (const t of [portfolioPremiumText('pe', 0.2), portfolioPremiumText('pb', -0.2), portfolioPremiumText('dividendYield', 0.2)]) {
      expect(t).not.toMatch(/買|賣|加碼|減碼/);
    }
  });
  it('null → 資料不足', () => {
    expect(portfolioPremiumText('pe', null)).toBe('資料不足');
  });
});

describe('contract 常數', () => {
  it('PORTFOLIO_VALUATION_CONTRACT 固定字串', () => {
    expect(PORTFOLIO_VALUATION_CONTRACT).toBe('PORTFOLIO_VALUATION_V1');
  });
});
