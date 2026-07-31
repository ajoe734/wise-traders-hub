/**
 * Group 1.30 — 美股取價與計算管線（drift-detection）
 *
 * 確認以下 edge functions 的美股分流關鍵識別字不漂移：
 *   - stock-price-sync：market gate、detectMarket、fetchUsQuotes 分流、market/currency 欄位回填
 *   - daily-snapshot：nyTradeDate、US 分支跳過 is_limit_up、快照寫入 market 欄位
 *   - daily-performance：Yahoo Finance chart API、美股 symbol 分派、market 欄位讀取
 *   - publish-weekly-journals：detectMarket 回填 expert_signals.market
 *   - _shared/marketDetect.ts：對應規則存在
 *   - _shared/usStockPriceWaterfall.ts：Yahoo L1、Stooq L2 兜底
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

/** 讀整個 edge function 目錄（函式已拆檔時 drift 檢查才不會漏看）。 */
function readFn(name: string) {
  const dir = resolve(process.cwd(), `supabase/functions/${name}`);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(resolve(dir, f), 'utf-8'))
    .join('\n');
}

function readShared(name: string) {
  return readFileSync(
    resolve(process.cwd(), `supabase/functions/_shared/${name}.ts`),
    'utf-8',
  );
}

describe('drift-detection: stock-price-sync 美股分流', () => {
  let src: string;
  beforeAll(() => { src = readFn('stock-price-sync'); });

  it('import detectMarket 與 fetchUsQuotes', () => {
    expect(src).toContain("from '../_shared/marketDetect.ts'");
    expect(src).toContain("from '../_shared/usStockPriceWaterfall.ts'");
    expect(src).toContain('detectMarket');
    expect(src).toContain('fetchUsQuotes');
  });

  it('支援 body.market 分流（TW / US / BOTH）', () => {
    expect(src).toMatch(/marketGate/);
    expect(src).toMatch(/'TW'|"TW"/);
    expect(src).toMatch(/'US'|"US"/);
  });

  it('current_prices upsert 帶入 market 與 currency 欄位', () => {
    expect(src).toContain("market: 'TW'");
    expect(src).toContain("market: 'US'");
    expect(src).toContain("currency: 'TWD'");
    expect(src).toContain("currency: 'USD'");
  });

  it('美股列 limit_up / limit_down 一律為 null', () => {
    // 美股 row builder：limit_up: null, limit_down: null
    expect(src).toMatch(/limit_up:\s*null,\s*limit_down:\s*null/);
  });
});

describe('drift-detection: daily-snapshot 美股分流', () => {
  let src: string;
  beforeAll(() => { src = readFn('daily-snapshot'); });

  it('import nyTradeDate 並用於美股 trade_date', () => {
    expect(src).toContain("from '../_shared/marketDetect.ts'");
    expect(src).toContain('nyTradeDate');
    expect(src).toContain('usTradeDate');
  });

  it('current_prices 查詢欄位包含 market', () => {
    expect(src).toMatch(/select\([^)]*market[^)]*\)/);
  });

  it('美股不計 is_limit_up，也不寫 expert_limit_up_hits', () => {
    // 判定 isLimitUp 前先過 market === 'TW'
    expect(src).toMatch(/market\s*===\s*'TW'\s*&&\s*p\.limit_up/);
    // 過濾 open trades 時，US 直接 return false
    expect(src).toMatch(/t\.market\s*===\s*'US'\)\s*return\s*false/);
  });

  it("upsert daily_price_snapshots 仍以 'symbol,trade_date' 保冪等，且 payload 含 market", () => {
    expect(src).toContain("from('daily_price_snapshots')");
    expect(src).toContain("onConflict: 'symbol,trade_date'");
    expect(src).toMatch(/market,?\s*\}/);
  });
});

describe('drift-detection: daily-performance 美股取價', () => {
  let src: string;
  beforeAll(() => { src = readFn('daily-performance'); });

  it('讀取 trade_records 時包含 market 欄位', () => {
    expect(src).toMatch(/select\([^)]*market[^)]*\)/);
  });

  it('fetchClosingPrice 內建 TW (.TW/.TWO) 與美股 Yahoo 分派', () => {
    expect(src).toContain('fetchClosingPrice');
    expect(src).toContain('finance.yahoo.com');
    expect(src).toContain('.TW');
  });

  it('audit_logs / system_jobs_log 記錄 TW/US 拆分', () => {
    expect(src).toContain('updated_tw');
    expect(src).toContain('updated_us');
  });
});

describe('drift-detection: publish-weekly-journals 標記 market', () => {
  let src: string;
  beforeAll(() => { src = readFn('publish-weekly-journals'); });

  it('引用 marketDetect 並在 expert_signals.update 帶入 market', () => {
    expect(src).toContain('marketDetect');
    expect(src).toMatch(/status:\s*'published',\s*market/);
  });
});

describe('drift-detection: _shared/marketDetect.ts', () => {
  let src: string;
  beforeAll(() => { src = readShared('marketDetect'); });

  it('提供 detectMarket / currencyOf / nyTradeDate / extractSymbol', () => {
    expect(src).toContain('export function detectMarket');
    expect(src).toContain('export function currencyOf');
    expect(src).toContain('export function nyTradeDate');
    expect(src).toContain('export function extractSymbol');
  });

  it('nyTradeDate 使用 America/New_York 時區', () => {
    expect(src).toContain("timeZone: 'America/New_York'");
  });
});

describe('drift-detection: _shared/usStockPriceWaterfall.ts', () => {
  let src: string;
  beforeAll(() => { src = readShared('usStockPriceWaterfall'); });

  it('L1 Yahoo chart API、L2 Stooq CSV 兜底', () => {
    expect(src).toContain('query1.finance.yahoo.com/v8/finance/chart');
    expect(src).toContain('stooq.com/q/l/');
  });

  it('回傳統一 shape 包含 price / source', () => {
    expect(src).toMatch(/source:\s*'yahoo'/);
    expect(src).toMatch(/source:\s*'stooq'/);
  });

  it('export fetchUsQuote 與 fetchUsQuotes', () => {
    expect(src).toContain('export async function fetchUsQuote');
    expect(src).toContain('export async function fetchUsQuotes');
  });
});
