/**
 * Group 1.37 — us_stock / us_future 單位單一來源 E2E 驗證
 *
 * 保證任何美元資產（含 `/ES` 期貨、AAPL 美股、OCC 選擇權）從
 *   草稿 → 批次週記編輯 → publish payload → DB trigger
 * 全鏈路 quantity_unit 只有「單一權威來源」：
 *   `expert.asset_class` → `getAssetSpec().units` → `sanitizeAssetQuantityUnit()`
 *   且 DB `enforce_unit_consistency` / `handle_signal_trade` 硬擋。
 *
 *   A. 草稿 sanitize：舊資料殘留「張」→ 由 `sanitizeAssetQuantityUnit` 校正
 *   B. 編輯批次驗證：`validateSignalBatch` 用 asset_class 白名單擋不合法單位
 *   C. Publish payload：`buildPublishRows` 匯出前把 quantity_unit 再洗一次
 *   D. DB drift-detection：`enforce_unit_consistency` + `handle_signal_trade`
 *      的 SQL 常數與 asset.ts 保持一致
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  sanitizeAssetQuantityUnit,
  getAssetSpec,
  resolveAssetClass,
  isValidAssetSymbol,
  detectDerivativeFromSymbol,
} from '@/lib/asset';
import {
  validateSignalBatch,
  buildPublishRows,
} from '@/pages/_signalEditor/derive';
import type { CapitalStatus, TradeDraft } from '@/pages/_signalEditor/types';

// ── shared fixtures ─────────────────────────────────────────────────────────

const bennyUsStock = {
  id: 'exp-benny',
  asset_class: 'us_stock',
  currency: 'USD',
  starting_capital: 30_000,
};

const bennyUsFuture = {
  id: 'exp-benny-fut',
  asset_class: 'us_future',
  currency: 'USD',
  starting_capital: 30_000,
};

const usdCapital: CapitalStatus = {
  starting_capital: 30_000,
  realized_pnl_amount: 0,
  open_cost_value: 0,
  open_market_value: 0,
  unrealized_pnl_amount: 0,
  available_cash: 30_000,
  open_positions: [],
  recent_trades: [],
};

function mkTrade(partial: Partial<TradeDraft> & { action: TradeDraft['action'] }): TradeDraft {
  return {
    uid: Math.random().toString(36).slice(2),
    executedAt: '2026-07-21T10:00',
    stockCode: '',
    stockName: '',
    action: partial.action,
    priceHint: '',
    quantity: '',
    quantityUnit: '張',
    reasonSummary: '',
    reasonDetail: '',
    riskNotes: '',
    ...partial,
  };
}

// ── A. 草稿 sanitize：舊資料 quantity_unit 殘留「張」──────────────────────────

describe('A. 草稿載入 sanitizeAssetQuantityUnit：us_stock / us_future / us_option', () => {
  it('us_stock：舊草稿殘留「張」→ 校正回「股」（不換算數量）', () => {
    expect(sanitizeAssetQuantityUnit('張', 'us_stock')).toBe('股');
    expect(sanitizeAssetQuantityUnit('', 'us_stock')).toBe('股');
    expect(sanitizeAssetQuantityUnit(null, 'us_stock')).toBe('股');
    expect(sanitizeAssetQuantityUnit('股', 'us_stock')).toBe('股');
  });

  it('us_future（/ES）：任何殘留單位 → 校正回「口」', () => {
    expect(sanitizeAssetQuantityUnit('張', 'us_future')).toBe('口');
    expect(sanitizeAssetQuantityUnit('股', 'us_future')).toBe('口');
    expect(sanitizeAssetQuantityUnit(undefined, 'us_future')).toBe('口');
    expect(sanitizeAssetQuantityUnit('口', 'us_future')).toBe('口');
  });

  it('us_option：任何殘留單位 → 校正回「口」', () => {
    expect(sanitizeAssetQuantityUnit('股', 'us_option')).toBe('口');
    expect(sanitizeAssetQuantityUnit('張', 'us_option')).toBe('口');
    expect(sanitizeAssetQuantityUnit('口', 'us_option')).toBe('口');
  });

  it('AssetSpec.units 白名單：us_stock=[股]、us_future=[口]、us_option=[口]', () => {
    expect(getAssetSpec('us_stock').units).toEqual(['股']);
    expect(getAssetSpec('us_future').units).toEqual(['口']);
    // 組 = 多腿 combo 價差單位（Phase combo 支援後新增）
    expect(getAssetSpec('us_option').units).toEqual(['口', '組']);
  });

  it('resolveAssetClass：asset_class 優先於 currency，避免舊 USD 誤判為 us_stock 蓋掉 us_future', () => {
    expect(resolveAssetClass(bennyUsStock as any)).toBe('us_stock');
    expect(resolveAssetClass(bennyUsFuture as any)).toBe('us_future');
    // 只有 currency 的舊資料才 fallback
    expect(resolveAssetClass({ currency: 'USD' } as any)).toBe('us_stock');
  });

  it('detectDerivativeFromSymbol：/ES / /NQ / /ESZ5 → us_future', () => {
    expect(detectDerivativeFromSymbol('/ES')).toBe('us_future');
    expect(detectDerivativeFromSymbol('/NQ')).toBe('us_future');
    expect(detectDerivativeFromSymbol('/ESZ5')).toBe('us_future');
    expect(detectDerivativeFromSymbol('AAPL')).toBeNull();
  });
});

// ── B. 編輯批次驗證：不合法單位在 UI 端就被擋 ────────────────────────────────

describe('B. validateSignalBatch：us_stock / us_future 白名單', () => {
  it('us_stock：AAPL 5 股 買進 → PASS', () => {
    const trades = [
      mkTrade({ stockCode: 'AAPL', action: 'buy', priceHint: '200', quantity: '5', quantityUnit: '股' }),
    ];
    expect(
      validateSignalBatch({ expert: bennyUsStock, trades, openPositions: [], capital: usdCapital }),
    ).toBeNull();
  });

  it('us_stock：AAPL 用「張」→ 擋下並提示「美股單位只能用「股」」', () => {
    const trades = [
      mkTrade({ stockCode: 'AAPL', action: 'buy', priceHint: '200', quantity: '5', quantityUnit: '張' }),
    ];
    const err = validateSignalBatch({ expert: bennyUsStock, trades, openPositions: [], capital: usdCapital });
    expect(err).toMatch(/美股單位只能用「股」/);
    expect(err).toMatch(/不能使用「張」/);
  });

  it('us_future：/ES 1 口 買進 → PASS', () => {
    const trades = [
      mkTrade({ stockCode: '/ES', action: 'buy', priceHint: '5000', quantity: '1', quantityUnit: '口' }),
    ];
    expect(
      validateSignalBatch({ expert: bennyUsFuture, trades, openPositions: [], capital: usdCapital }),
    ).toBeNull();
  });

  it('us_future：/ES 用「股」→ 擋下並提示「美股期貨單位只能用「口」」', () => {
    const trades = [
      mkTrade({ stockCode: '/ES', action: 'buy', priceHint: '5000', quantity: '1', quantityUnit: '股' }),
    ];
    const err = validateSignalBatch({ expert: bennyUsFuture, trades, openPositions: [], capital: usdCapital });
    expect(err).toMatch(/美股期貨/);
    expect(err).toMatch(/不能使用「股」/);
  });

  it('us_future：AAPL（非期貨代碼）→ symbolRegex 擋下', () => {
    expect(isValidAssetSymbol('AAPL', 'us_future')).toBe(false);
    expect(isValidAssetSymbol('/ES', 'us_future')).toBe(true);
    expect(isValidAssetSymbol('/ESZ5', 'us_future')).toBe(true);
  });
});

// ── C. Publish payload：buildPublishRows 再洗一次 ──────────────────────────

describe('C. buildPublishRows：發送到 DB 前 quantity_unit 依 assetClass 洗淨', () => {
  it('us_stock：即使 draft 殘留「張」，payload 出去一定是「股」', () => {
    const trades = [
      mkTrade({ stockCode: 'TSLA', action: 'buy', priceHint: '250', quantity: '5', quantityUnit: '張' }),
    ];
    const rows = buildPublishRows({
      expertId: bennyUsStock.id,
      batchId: 'batch-1',
      status: 'published',
      assetClass: 'us_stock',
      isMentor: false,
      teachingTopic: '',
      overallSummary: '',
      learningPoints: '',
      trades,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity_unit).toBe('股');
    // 數量本身不換算
    expect(rows[0].quantity).toBe(5);
    expect(rows[0].instrument).toBe('TSLA');
  });

  it('us_future：即使 draft 是「股」或「張」，payload 一定是「口」', () => {
    const trades = [
      mkTrade({ stockCode: '/ES', action: 'buy', priceHint: '5000', quantity: '1', quantityUnit: '股' }),
      mkTrade({ stockCode: '/NQ', action: 'buy', priceHint: '18000', quantity: '2', quantityUnit: '張' }),
    ];
    const rows = buildPublishRows({
      expertId: bennyUsFuture.id,
      batchId: 'batch-fut',
      status: 'published',
      assetClass: 'us_future',
      isMentor: false,
      teachingTopic: '',
      overallSummary: '',
      learningPoints: '',
      trades,
    });
    expect(rows.every((r: any) => r.quantity_unit === '口')).toBe(true);
    expect(rows.map((r: any) => r.instrument).sort()).toEqual(['/ES', '/NQ']);
  });

  it('hold 且無 quantity：quantity_unit 送 null，避免污染 trigger 白名單', () => {
    const trades = [
      mkTrade({ stockCode: 'AAPL', action: 'hold', quantityUnit: '股' }),
    ];
    const rows = buildPublishRows({
      expertId: bennyUsStock.id,
      batchId: 'batch-hold',
      status: 'published',
      assetClass: 'us_stock',
      isMentor: false,
      teachingTopic: '',
      overallSummary: '',
      learningPoints: '',
      trades,
    });
    expect(rows[0].quantity_unit).toBeNull();
  });
});

// ── D. DB drift-detection：SQL 常數與 asset.ts 對齊 ────────────────────────

describe('D. DB trigger drift-detection：enforce_unit_consistency + handle_signal_trade', () => {
  let unitSrc: string;
  let tradeSrc: string;
  let capSrc: string;
  beforeAll(() => {
    unitSrc = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260721135135_a43e42a1-2522-493f-a87b-d468780d6665.sql'),
      'utf-8',
    );
    tradeSrc = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260722050021_f188faf1-ff79-4812-a252-bf97740d982e.sql'),
      'utf-8',
    );
    capSrc = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260505130656_164cb09c-78f6-4fc5-94ac-0312cf91d8f3.sql'),
      'utf-8',
    );
  });

  it('enforce_unit_consistency：CASE 常數與 AssetSpec.units 完全對齊', () => {
    // us_stock=[股]、us_future=[口]、us_option=[口]、crypto=[顆]、tw_stock=[張,股]
    expect(unitSrc).toMatch(/WHEN 'us_stock'\s+THEN ARRAY\['股'\]/);
    expect(unitSrc).toMatch(/WHEN 'us_future'\s+THEN ARRAY\['口'\]/);
    expect(unitSrc).toMatch(/WHEN 'us_option'\s+THEN ARRAY\['口'\]/);
    expect(unitSrc).toMatch(/WHEN 'crypto'\s+THEN ARRAY\['顆'\]/);
    expect(unitSrc).toMatch(/WHEN 'tw_stock'\s+THEN ARRAY\['張','股'\]/);
  });

  it('enforce_unit_consistency：以 asset_class 為主、currency 只做 fallback', () => {
    expect(unitSrc).toMatch(
      /COALESCE\(asset_class,\s*CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END\)/,
    );
  });

  it('enforce_unit_consistency：違反白名單 → RAISE incompatible_unit_for_asset_class', () => {
    expect(unitSrc).toContain('incompatible_unit_for_asset_class');
    expect(unitSrc).toMatch(/NEW\.quantity_unit\s*=\s*ANY\(v_allowed\)/);
  });

  it('handle_signal_trade：v_unit 從 asset_class 派生，us_stock/us_future/us_option 預設不會是「張」', () => {
    expect(tradeSrc).toMatch(/WHEN 'us_stock'\s+THEN '股'/);
    expect(tradeSrc).toMatch(/WHEN 'us_future'\s+THEN '口'/);
    expect(tradeSrc).toMatch(/WHEN 'us_option'\s+THEN '口'/);
    expect(tradeSrc).toMatch(/WHEN 'crypto'\s+THEN '顆'/);
  });

  it('handle_signal_trade：quantity 正規化只在 tw_stock+「張」時 ×1000，其他資產維持原值', () => {
    expect(tradeSrc).toMatch(/WHEN v_asset_class = 'tw_stock' AND v_unit = '張' THEN COALESCE\(NEW\.quantity, 1\) \* 1000/);
    expect(tradeSrc).toMatch(/ELSE COALESCE\(NEW\.quantity, 1\)/);
    expect(tradeSrc).toContain('trade_records.quantity stores actual base units');
  });

  it('enforce_signal_capital_limit：資金硬擋公式仍然存在（避免 unit 修 fix 誤動資金 trigger）', () => {
    expect(capSrc).toContain('enforce_signal_capital_limit');
    expect(capSrc).toContain('CAPITAL_EXCEEDED');
  });
});
