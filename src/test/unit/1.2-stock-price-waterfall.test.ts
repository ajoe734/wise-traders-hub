/**
 * Group 1.2 — 取價瀑布條件邏輯
 *
 * 對應測試路徑（核心邏輯分類 STEP_3）：
 *   5.4-1 ~ 5.4-6  4 層瀑布式取價  src/lib/stockPriceWaterfall.ts
 *
 * 瀑布優先順序：z（最後成交）> h（最高，需有成交量）> a（委賣第一檔）> y（昨收）
 *
 * 誠實性設計說明：
 *   [Issue 1] 正式 Edge Function（index.ts）已改為從
 *             supabase/functions/_shared/stockPriceWaterfall.ts import。
 *             本測試使用 src/lib/stockPriceWaterfall.ts（內容相同）。
 *             最後的 drift-detection 測試會比對兩份檔案，確保邏輯未漂移。
 *   [Issue 2] shouldWritePrice() 已從 index.ts 的 inline 條件提取為 export，
 *             測試直接覆蓋 DB 寫入門檻邏輯，不再依賴 extractPrice 的 falsy 副作用。
 *   [Issue 3] 委賣欄位（a）分隔符為底線（underscore），已修正 index.ts 原有的
 *             錯誤 pipe-separated 註解，並透過測試釘死此資料格式契約。
 */

/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractPrice, parsePrice, shouldWritePrice, type MsgItem } from '@/lib/stockPriceWaterfall';

// ---------------------------------------------------------------------------
// 測試輔助：建立最小化 MsgItem fixture
// ---------------------------------------------------------------------------
function makeItem(overrides: Partial<MsgItem> = {}): MsgItem {
  return {
    c: 'TEST',
    n: '測試股',
    z: '-',
    a: '-',
    b: '-',
    y: '-',
    o: '-',
    h: '-',
    l: '-',
    v: '0',
    u: '-',
    w: '-',
    ex: 'tse',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parsePrice — 字串轉數字的邊界行為
// ---------------------------------------------------------------------------
describe('parsePrice()', () => {
  it('有效數字字串 → 回傳 number', () => {
    expect(parsePrice('100')).toBe(100);
    expect(parsePrice('0.61')).toBe(0.61);
  });

  it('"0" 字串 → 回傳 0（非 null）', () => {
    expect(parsePrice('0')).toBe(0);
  });

  it('"-" 字串 → 回傳 null', () => {
    expect(parsePrice('-')).toBeNull();
  });

  it('空字串 → 回傳 null', () => {
    expect(parsePrice('')).toBeNull();
  });

  it('undefined → 回傳 null', () => {
    expect(parsePrice(undefined)).toBeNull();
  });

  it('非數字字串 → 回傳 null', () => {
    expect(parsePrice('abc')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// [Issue 2] shouldWritePrice — DB 寫入門檻（從 index.ts 的 inline 條件提取）
// ---------------------------------------------------------------------------
describe('shouldWritePrice() — DB 寫入門檻', () => {
  it('price > 0 → true，應寫入', () => {
    expect(shouldWritePrice(100)).toBe(true);
    expect(shouldWritePrice(0.01)).toBe(true);
  });

  it('price = 0 → false，不寫入（避免零價資料污染 current_prices）', () => {
    expect(shouldWritePrice(0)).toBe(false);
  });

  it('price = null → false，不寫入', () => {
    expect(shouldWritePrice(null)).toBe(false);
  });

  it('price < 0 → false，不寫入（負數為無效報價）', () => {
    expect(shouldWritePrice(-1)).toBe(false);
  });

  it('mutation 防護：price >= 0 條件（會讓 0 通過）與 price > 0 結果不同', () => {
    // 若有人把條件改成 price >= 0，price=0 會被寫入 DB
    // 這個測試確保只有 > 0 才通過
    const withStrictGate = shouldWritePrice(0);       // 應為 false
    const wouldPassWithLooseGate = (0 >= 0);          // 若改成 >= 0 會是 true
    expect(withStrictGate).toBe(false);
    expect(wouldPassWithLooseGate).toBe(true);        // 兩者結果不同，mutation 可被偵測
  });
});

// ---------------------------------------------------------------------------
// extractPrice — 4 層瀑布
// ---------------------------------------------------------------------------
describe('5.4 取價瀑布 — extractPrice()', () => {
  it('5.4-1：z > 0 → 直接回傳最後成交價，忽略其餘欄位', () => {
    const item = makeItem({ z: '100', h: '105', v: '1000', a: '102_103', y: '99' });
    expect(extractPrice(item)).toBe(100);
  });

  it('5.4-2：z = 0、最高價有值且成交量 > 0 → fallback 最高價', () => {
    const item = makeItem({ z: '0', h: '105', v: '1000', a: '102_103', y: '99' });
    expect(extractPrice(item)).toBe(105);
  });

  it('5.4-2a：z = 0、最高價有值但成交量 = 0 → 跳過最高價，fallback 委賣第一檔', () => {
    const item = makeItem({ z: '0', h: '105', v: '0', a: '106_107_108', y: '99' });
    expect(extractPrice(item)).toBe(106);
  });

  it('5.4-3：z = 0、最高價 = 0、委賣有值 → fallback 委賣第一檔', () => {
    const item = makeItem({ z: '0', h: '0', v: '0', a: '103_104', y: '99' });
    expect(extractPrice(item)).toBe(103);
  });

  it('5.4-4：z / h / a 全為 0、昨收有值 → fallback 昨收', () => {
    const item = makeItem({ z: '0', h: '0', v: '0', a: '0', y: '99' });
    expect(extractPrice(item)).toBe(99);
  });

  it('5.4-5：全部為 "-"（無效值）→ extractPrice 回傳 null，shouldWritePrice 攔截', () => {
    const item = makeItem({ z: '-', h: '-', v: '', a: '-', y: '-' });
    const price = extractPrice(item);
    expect(price).toBeNull();
    // 用 shouldWritePrice 驗證，而非依賴 falsy 副作用
    expect(shouldWritePrice(price)).toBe(false);
  });

  it('5.4-6：z = "-"（null，非 0）→ 正確 fallback 至最高價，不誤判為 z = 0', () => {
    const item = makeItem({ z: '-', h: '105', v: '500', a: '106', y: '99' });
    expect(extractPrice(item)).toBe(105);
  });

  it('[Issue 3] 委賣分隔符確認為底線（underscore）：僅取第一檔，後續檔位忽略', () => {
    // 資料契約釘死：a 欄位格式為 "price1_price2_price3"，split('_')[0] 取第一檔
    const item = makeItem({ z: '0', h: '0', v: '0', a: '101_102_103', y: '99' });
    expect(extractPrice(item)).toBe(101); // 取第一檔，不是 102 或 103

    // 確認第二檔不影響結果（若誤取 [1] 則回傳 150）
    const item2 = makeItem({ z: '0', h: '0', v: '0', a: '99_150_200', y: '88' });
    expect(extractPrice(item2)).toBe(99); // 取 99，不是 150
  });

  it('邊界：z 為小數（權證）→ 正確回傳，不被截斷', () => {
    const item = makeItem({ z: '0.61', h: '-', v: '100', a: '-', y: '0.55' });
    expect(extractPrice(item)).toBe(0.61);
  });
});

// ---------------------------------------------------------------------------
// [Issue 1 + 2] Drift Detection — 邏輯一致性 & 正式版 gate 使用驗證
// ---------------------------------------------------------------------------
describe('Drift Detection', () => {
  it('[Issue 1] src/lib/stockPriceWaterfall.ts 與 _shared/ 內容完全相同', () => {
    const root       = process.cwd();
    const libPath    = resolve(root, 'src/lib/stockPriceWaterfall.ts');
    const sharedPath = resolve(root, 'supabase/functions/_shared/stockPriceWaterfall.ts');

    const libContent    = readFileSync(libPath, 'utf-8');
    const sharedContent = readFileSync(sharedPath, 'utf-8');

    expect(libContent).toBe(sharedContent);
  });

  it('[Issue 2] index.ts 落庫 gate 使用 shouldWritePrice()，而非 inline 條件', () => {
    const indexPath    = resolve(process.cwd(), 'supabase/functions/stock-price-sync/index.ts');
    const indexContent = readFileSync(indexPath, 'utf-8');

    // 正式版必須呼叫 shouldWritePrice(price)
    expect(indexContent).toContain('shouldWritePrice(price)');

    // 不得出現任何 inline bypass 寫法
    expect(indexContent).not.toMatch(/if\s*\(\s*price\s*&&\s*price\s*>\s*0\s*\)/);
    expect(indexContent).not.toMatch(/if\s*\(\s*price\s*!=\s*null\s*\)/);
    expect(indexContent).not.toMatch(/if\s*\(\s*price\s*>=\s*0\s*\)/);
  });
});
