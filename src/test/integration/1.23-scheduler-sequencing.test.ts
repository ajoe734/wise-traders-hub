/**
 * Group 1.23 — 排程間時序依賴
 *
 * 測試範圍：
 *
 *   A. calcDailyPnl（src/lib/schedulerCalc.ts）：
 *      持倉未實現損益百分比計算，mirrors daily-performance 公式。
 *      entry_price = 0 → null（零除防護）。
 *
 *   B. isLimitUp（src/lib/schedulerCalc.ts）：
 *      漲停判定純函數，mirrors daily-snapshot:
 *        `p.limit_up != null && p.price != null && p.price >= p.limit_up`
 *
 *   C. extractSymbol（src/lib/schedulerCalc.ts）：
 *      從 instrument 字串（格式 "2330 台積電"）提取股票代碼，
 *      mirrors daily-snapshot: `t.instrument?.split(' ')?.[0]`
 *
 *   D. drift-detection：daily-performance Edge Function
 *      確認關鍵 DB 操作識別字不漂移（5.7-1）。
 *        讀取 trade_records status=open
 *        寫回 current_price / pnl_percent / price_updated_at
 *        audit_logs 記錄 daily_performance_update
 *        fetchClosingPrice 從 Yahoo Finance 取價
 *
 *   E. drift-detection：daily-snapshot Edge Function
 *      確認時序依賴關鍵識別字不漂移（5.7-2/5.7-3）。
 *        讀取 current_prices（依賴 stock-price-sync 先完成）
 *        is_limit_up 比較式 p.price >= p.limit_up
 *        upsert daily_price_snapshots（onConflict symbol,trade_date）
 *        讀取 trade_records status=open 找命中持倉
 *        upsert expert_limit_up_hits（onConflict expert_id,symbol,trade_date）
 *
 *   F. drift-detection：stock-price-sync Edge Function
 *      確認寫入 current_prices 的關鍵識別字不漂移（5.7-1）。
 *        upsert current_prices（onConflict symbol）
 *        import _shared/stockPriceWaterfall.ts（取價邏輯重用）
 *
 * 對應測試路徑：
 *   5.7-1：stock-price-sync 完成後 → current_prices 更新；
 *           daily-performance 以 Yahoo Finance 取價更新 trade_records.current_price
 *           （注意：兩者為獨立取價管道，daily-performance 不讀 current_prices）
 *   5.7-2：daily-snapshot 收盤後執行 → 讀 current_prices → is_limit_up 正確判定 → 寫 daily_price_snapshots
 *   5.7-3：daily-snapshot 完成後 → expert_limit_up_hits 與快照一致（upsert 保冪等）
 *
 * 注意：daily-snapshot 讀取 current_prices 是對 stock-price-sync 完成的時序依賴；
 *       daily-performance 從 Yahoo Finance 取價（非 current_prices），與 stock-price-sync 平行執行。
 *       is_limit_up 判定使用 >= 而非 >（漲停板當天也算命中）。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { calcDailyPnl, isLimitUp, extractSymbol } from '@/lib/schedulerCalc';

// ── Section A: calcDailyPnl ───────────────────────────────────────────────────

describe('calcDailyPnl（每日績效未實現損益計算）', () => {
  it('現價 120、成本 100 → +20%（5.7-1）', () => {
    expect(calcDailyPnl(120, 100)).toBe(20);
  });

  it('現價 80、成本 100 → -20%（5.7-1）', () => {
    expect(calcDailyPnl(80, 100)).toBe(-20);
  });

  it('成本 = 0 → null，不除以零（5.7-1 zero-guard）', () => {
    expect(calcDailyPnl(120, 0)).toBeNull();
  });

  it('現價 5、成本 3 → 66.67%（rounding 驗證：2/3 = 66.666… 四捨五入為 66.67，5.7-1）', () => {
    // Math.round(6666.66...) = 6667 → 66.67
    // 若改為 Math.floor，結果為 66.66（測試失敗）
    expect(calcDailyPnl(5, 3)).toBe(66.67);
  });
});

// ── Section B: isLimitUp ─────────────────────────────────────────────────────

describe('isLimitUp（漲停判定純函數）', () => {
  it('price = limit_up（恰好觸及漲停板）→ true（5.7-2）', () => {
    expect(isLimitUp(100, 100)).toBe(true);
  });

  it('price < limit_up → false（5.7-2）', () => {
    expect(isLimitUp(99, 100)).toBe(false);
  });

  it('price = null → false（缺少收盤價）（5.7-2）', () => {
    expect(isLimitUp(null, 100)).toBe(false);
  });

  it('limit_up = null（無漲停資料）→ false（5.7-2）', () => {
    expect(isLimitUp(100, null)).toBe(false);
  });
});

// ── Section C: extractSymbol ──────────────────────────────────────────────────

describe('extractSymbol（instrument 字串取代碼）', () => {
  it('"2330 台積電" → "2330"（5.7-3）', () => {
    expect(extractSymbol('2330 台積電')).toBe('2330');
  });

  it('"00878 國泰永續高股息" → "00878"（ETF 代碼含多位數，5.7-3）', () => {
    expect(extractSymbol('00878 國泰永續高股息')).toBe('00878');
  });
});

// ── Section D: drift-detection: daily-performance ────────────────────────────

describe('drift-detection: daily-performance Edge Function 每日持倉更新', () => {
  let perfSrc: string;

  beforeAll(() => {
    perfSrc = readFileSync(
      resolve(process.cwd(), 'supabase/functions/daily-performance/index.ts'),
      'utf-8',
    );
  });

  it("讀取 trade_records 中 status='open' 的持倉（5.7-1）", () => {
    expect(perfSrc).toContain("from('trade_records')");
    expect(perfSrc).toContain(".eq('status', 'open')");
  });

  it('更新 trade_records 寫入 current_price / pnl_percent / price_updated_at（5.7-1）', () => {
    expect(perfSrc).toContain('current_price');
    expect(perfSrc).toContain('pnl_percent');
    expect(perfSrc).toContain('price_updated_at');
  });

  it("audit_logs 記錄 'daily_performance_update' 動作（5.7-1）", () => {
    expect(perfSrc).toContain('daily_performance_update');
  });

  it('fetchClosingPrice 從 Yahoo Finance API 取最新收盤價（5.7-1）', () => {
    expect(perfSrc).toContain('fetchClosingPrice');
    expect(perfSrc).toContain('finance.yahoo.com');
  });
});

// ── Section E: drift-detection: daily-snapshot ───────────────────────────────

describe('drift-detection: daily-snapshot Edge Function 每日快照與漲停命中', () => {
  let snapshotSrc: string;

  beforeAll(() => {
    snapshotSrc = readFileSync(
      resolve(process.cwd(), 'supabase/functions/daily-snapshot/index.ts'),
      'utf-8',
    );
  });

  it("讀取 current_prices 作為快照資料來源（依賴 stock-price-sync 先完成，5.7-2）", () => {
    // daily-snapshot 的時序依賴：必須在 stock-price-sync 更新 current_prices 後執行
    expect(snapshotSrc).toContain("from('current_prices')");
  });

  it('is_limit_up 判定使用 p.price >= p.limit_up（漲停板含等於，5.7-2）', () => {
    expect(snapshotSrc).toContain('p.price >= p.limit_up');
  });

  it("upsert daily_price_snapshots 以 'symbol,trade_date' 保冪等（5.7-2）", () => {
    expect(snapshotSrc).toContain("from('daily_price_snapshots')");
    expect(snapshotSrc).toContain("onConflict: 'symbol,trade_date'");
  });

  it("讀取 trade_records status='open' 比對持倉命中漲停（5.7-3）", () => {
    expect(snapshotSrc).toContain("from('trade_records')");
    expect(snapshotSrc).toContain(".eq('status', 'open')");
  });

  it("entry_date <= tradeDate guard 確保只計入已持倉的交易，當日建倉不誤報（5.7-3）", () => {
    // t.entry_date.split('T')[0] <= <台北 trade_date 變數> 使用 <=（含當日）
    // 變數名可能是 tradeDate 或 twTradeDate（美股分流後改名），皆合法；若改為 < 則當日建倉永遠不會被計為漲停命中
    expect(snapshotSrc).toMatch(/t\.entry_date\.split\('T'\)\[0\]\s*<=\s*(tw)?[Tt]radeDate/);
  });

  it("upsert expert_limit_up_hits 以 'expert_id,symbol,trade_date' 保冪等（5.7-3）", () => {
    expect(snapshotSrc).toContain("from('expert_limit_up_hits')");
    expect(snapshotSrc).toContain("onConflict: 'expert_id,symbol,trade_date'");
  });
});

// ── Section F: drift-detection: stock-price-sync ─────────────────────────────

describe('drift-detection: stock-price-sync Edge Function 股價同步', () => {
  let priceSyncSrc: string;

  beforeAll(() => {
    priceSyncSrc = readFileSync(
      resolve(process.cwd(), 'supabase/functions/stock-price-sync/index.ts'),
      'utf-8',
    );
  });

  it("透過 upsert_current_price RPC 寫入（帶 writer tag 'stock-price-sync'，統一 current_prices 冪等寫入路徑，5.7-1）", () => {
    // 2026-06 起 current_prices 寫入統一走 upsert_current_price RPC（server-side onConflict='symbol'），
    // stock-price-sync 不再直接 upsert current_prices 表。
    expect(priceSyncSrc).toContain("rpc('upsert_current_price'");
    expect(priceSyncSrc).toContain("p_writer: 'stock-price-sync'");
  });

  it('import _shared/stockPriceWaterfall.ts 重用 4 層瀑布取價邏輯（5.7-1）', () => {
    expect(priceSyncSrc).toContain('stockPriceWaterfall.ts');
  });
});
