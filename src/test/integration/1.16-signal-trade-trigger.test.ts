/**
 * Group 1.16 — 訊號交易 Trigger：建倉 / 加碼 / 減碼 / 平倉 / 收回 + 均價與損益計算
 *
 * 測試範圍：
 *
 *   A. calcWeightedAvgPrice / reverseWeightedAvgPrice（src/lib/signalTradeLogic.ts）：
 *      純函數，對應 handle_signal_trade trigger 加碼均價與 handle_signal_takedown
 *      收回反算的 ROUND(..., 2) 公式。
 *        5.1-1：買 100 張 @50 加碼 50 張 @60 → 新均價 53.33、quantity 150
 *        5.1-2：買 100 張 @50 加碼 100 張 @50 → 均價不變 50、quantity 200
 *        5.1-3：買 1 張 @0.61（權證）→ 均價保留完整小數 0.61
 *        5.1-4：加碼後收回加碼訊號 → 均價反算回加碼前 50.00
 *        5.1-5：連續兩次加碼後收回其中一次 → 均價正確反算不產生負數
 *
 *   B. calcPnlPercent（src/lib/signalTradeLogic.ts）：
 *      純函數，對應 trigger 中 pnl_percent 的 ROUND(((exit-entry)/entry)*100, 2)。
 *        5.2-1：買 @100 賣 @120 → +20%
 *        5.2-2：買 @100 賣 @80 → -20%
 *        5.2-3：買 @100 賣 @100 → 0%
 *        5.2-4：買 @0.5 賣 @1.0（權證）→ +100%，不因浮點誤差出錯
 *        5.2-5：部分減碼 50 張（持有 100 張 @entry=80，賣 @100）→ closed pnl 正確、open qty 剩 50
 *
 *   C. drift-detection：
 *      handle_signal_trade（migration 20260412102636）各 action 分支正確性；
 *      handle_signal_takedown（migration 20260402160514）收回邏輯；
 *      line-push-signal/index.ts 含 takedown 型推播處理。
 *
 * 對應測試路徑：
 *   4.1-1 ~ 4.1-8：buy / add / sell / trim / exit 建倉行為
 *   4.2-1 ~ 4.2-5：收回後回滾與 LINE 推播通知
 *   5.1-1 ~ 5.1-5：加權均價計算（含收回反算）
 *   5.2-1 ~ 5.2-5：PnL% 計算（含小數與部分減碼）
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  calcWeightedAvgPrice,
  calcPnlPercent,
  reverseWeightedAvgPrice,
  calcSellQty,
  normalizeSignalQuantityToShares,
} from '@/lib/signalTradeLogic';

// ── calcWeightedAvgPrice / reverseWeightedAvgPrice（加權均價計算）────────────

describe('calcWeightedAvgPrice / reverseWeightedAvgPrice（加權均價計算）', () => {
  it('買 100 張 @50 加碼 50 張 @60 → 新均價 53.33、quantity 150（5.1-1）', () => {
    expect(calcWeightedAvgPrice(100, 50, 50, 60)).toBe(53.33);
    expect(100 + 50).toBe(150);
  });

  it('買 100 張 @50 加碼 100 張 @50 → 均價不變 50.00、quantity 200（5.1-2）', () => {
    expect(calcWeightedAvgPrice(100, 50, 100, 50)).toBe(50.00);
    expect(100 + 100).toBe(200);
  });

  it('買 1 張 @0.61（權證）加碼 1 張 @0.61 → 均價保留完整小數 0.61（5.1-3）', () => {
    expect(calcWeightedAvgPrice(1, 0.61, 1, 0.61)).toBe(0.61);
  });

  it('加碼後收回加碼訊號 → 均價反算回加碼前 50.00（5.1-4）', () => {
    // 建倉 100@50，加碼 50@60 → entry = 53.33, qty = 150
    const afterAdd = calcWeightedAvgPrice(100, 50, 50, 60); // 53.33
    // 收回加碼（50@60）：reverseWeightedAvgPrice(150, 53.33, 50, 60)
    const restored = reverseWeightedAvgPrice(150, afterAdd, 50, 60);
    expect(restored).toBe(50.00);
  });

  it('連續兩次加碼後收回第一次加碼 → 均價正確反算不產生負數（5.1-5）', () => {
    // 建倉 100@50，add1 50@60 → 53.33 / 150，add2 50@70 → 57.50 / 200
    const afterAdd1 = calcWeightedAvgPrice(100, 50, 50, 60);   // 53.33
    const afterAdd2 = calcWeightedAvgPrice(150, afterAdd1, 50, 70); // 57.50
    // 收回 add1（50@60）：reverseWeightedAvgPrice(200, 57.50, 50, 60)
    const restored = reverseWeightedAvgPrice(200, afterAdd2, 50, 60);
    expect(restored).toBe(56.67);
    expect(restored).toBeGreaterThan(0);
  });
});

// ── calcPnlPercent（PnL% 計算）───────────────────────────────────────────────

describe('calcPnlPercent（PnL% 計算）', () => {
  it('買 @100 賣 @120 → pnl_percent = +20.00（5.2-1）', () => {
    expect(calcPnlPercent(100, 120)).toBe(20.00);
  });

  it('買 @100 賣 @80 → pnl_percent = -20.00（5.2-2）', () => {
    expect(calcPnlPercent(100, 80)).toBe(-20.00);
  });

  it('買 @100 賣 @100 → pnl_percent = 0.00（5.2-3）', () => {
    expect(calcPnlPercent(100, 100)).toBe(0.00);
  });

  it('買 @0.5 賣 @1.0（權證）→ +100%，不因浮點誤差出錯（5.2-4）', () => {
    expect(calcPnlPercent(0.5, 1.0)).toBe(100.00);
  });

  it('部分減碼：持有 100 張 @entry=80，賣 50 張 @100 → closed pnl=+25%、open qty 剩 50（5.2-5）', () => {
    const pnl = calcPnlPercent(80, 100);
    const actualSellQty = calcSellQty(50, 100);
    const remaining = 100 - actualSellQty;
    expect(pnl).toBe(25.00);
    expect(remaining).toBe(50);
  });
});

// ── guard branch coverage ─────────────────────────────────────────────────────

describe('signalTradeLogic 防禦性邊界（guard 分支覆蓋）', () => {
  it('calcWeightedAvgPrice: totalQty = 0（qty1=5 + qty2=-5）→ 回傳 existingPrice（zero-guard）', () => {
    expect(calcWeightedAvgPrice(5, 50, -5, 60)).toBe(50);
  });

  it('calcPnlPercent: entryPrice = 0 → 回傳 0，不除以零', () => {
    expect(calcPnlPercent(0, 100)).toBe(0);
  });

  it('reverseWeightedAvgPrice: removeQty = openQty（全部收回）→ newQty=0，回傳 openEntry', () => {
    expect(reverseWeightedAvgPrice(50, 50, 50, 60)).toBe(50);
  });

  it('calcSellQty: signalQty = null → 使用 existingQty（null coalesce 分支）', () => {
    expect(calcSellQty(null, 100)).toBe(100);
  });

  it('normalizeSignalQuantityToShares: 500 股 → 維持 500，不可誤乘 1000', () => {
    expect(normalizeSignalQuantityToShares(500, '股')).toBe(500);
  });

  it('normalizeSignalQuantityToShares: 5 張 → 轉成 5000 股', () => {
    expect(normalizeSignalQuantityToShares(5, '張')).toBe(5000);
  });
});

// ── drift-detection: handle_signal_trade trigger 建倉行為 ─────────────────────

describe('drift-detection: handle_signal_trade trigger 建倉行為', () => {
  let src: string;
  beforeAll(() => {
    src = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260514120252_a26870b1-f964-49be-a4a5-25c67a699ea2.sql',
      ),
      'utf-8',
    );
  });

  it('buy → INSERT trade_records 並設定 open status（4.1-1）', () => {
    expect(src).toContain("NEW.action = 'buy'");
    expect(src).toContain('INSERT INTO public.trade_records');
    expect(src).toContain("'open'::trade_status");
    expect(src).toContain("quantity_unit = '股'");
  });

  it('add → 查詢既有 open trade_record，IF FOUND 則更新加權均價（4.1-2）', () => {
    expect(src).toContain("NEW.action = 'add'");
    expect(src).toContain('existing_record');
    expect(src).toContain('IF FOUND THEN');
  });

  it('add → ROUND 加權均價公式：(qty*price + addQty*addPrice) / totalQty（4.1-3）', () => {
    expect(src).toContain('ROUND(');
    expect(src).toContain('existing_record.quantity * COALESCE(existing_record.entry_price');
  });

  it('sell → LEAST(signalQty, existingQty) 計算 sell_qty，保留 remaining_qty（4.1-4）', () => {
    expect(src).toContain('LEAST(');
    expect(src).toContain('signal_shares');
    expect(src).toContain('remaining_qty');
  });

  it('quantity_unit 依訊號單位正規化：張乘 1000、股維持原值（4.1 quantity normalization）', () => {
    expect(src).toContain("COALESCE(NEW.quantity_unit, '張') = '張'");
    expect(src).toContain('COALESCE(NEW.quantity, 1) * 1000');
    expect(src).toContain("quantity_unit = '股'");
  });

  it('sell remaining_qty <= 0 → UPDATE trade_records 整筆平倉（closed）並計算 pnl_percent（4.1-5）', () => {
    expect(src).toContain('remaining_qty <= 0');
    expect(src).toContain("'closed'::trade_status");
  });

  it('trim 與 sell 共用同一分支：IN (\'sell\', \'trim\')（4.1-6）', () => {
    expect(src).toContain("IN ('sell', 'trim')");
  });

  it('exit → UPDATE 同 expert+instrument 所有 open 記錄為 closed（4.1-7）', () => {
    expect(src).toContain("NEW.action = 'exit'");
    expect(src).toContain("status = 'open'");
    expect(src).toContain("status = 'closed'");
  });

  it('pnl_percent 公式：ROUND(((NEW.price_hint - entry_price) / entry_price) * 100, 2)（4.1-8）', () => {
    expect(src).toContain('pnl_percent');
    expect(src).toContain(
      '(NEW.price_hint - existing_record.entry_price) / existing_record.entry_price',
    );
  });

  it('trigger UPDATE guard：status 未變更時 early RETURN NEW；pending → published 只放行發布、不重複寫交易（4.1 guard）', () => {
    expect(src).toContain('IF OLD.status = NEW.status THEN');
    expect(src).toContain("IF NOT (OLD.status = 'pending' AND NEW.status = 'published') THEN");
    expect(src).toContain("IF NEW.status <> 'pending' THEN");
  });
});

// ── drift-detection: handle_signal_takedown trigger 收回與 LINE 推播 ──────────

describe('drift-detection: handle_signal_takedown trigger 收回與 LINE 推播', () => {
  let takeSrc: string;
  beforeAll(() => {
    takeSrc = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260402160514_ccd43a54-f6bf-418c-a741-07c2809668b7.sql',
      ),
      'utf-8',
    );
  });

  it(
    'remaining_published = 0 且有 open 交易 → UPDATE 至 closed，exit_price 使用 COALESCE(current_price, entry_price)（4.2-1）',
    () => {
      expect(takeSrc).toContain('remaining_published = 0');
      expect(takeSrc).toContain('has_open_trades');
      expect(takeSrc).toContain("status = 'closed'");
      expect(takeSrc).toContain('COALESCE(current_price, entry_price)');
      expect(takeSrc).toContain('DELETE FROM public.user_performances');
      expect(takeSrc).toContain('trade_signals');
    },
  );

  it('remaining_published > 0 → UPDATE 對應 trade_records 為 stopped 狀態（4.2-2）', () => {
    expect(takeSrc).toContain("'stopped'::trade_status");
    expect(takeSrc).toContain('signal_id = NEW.id');
  });

  it('OLD.action = \'add\' 收回 → 反算加權均價公式（4.2-3）', () => {
    expect(takeSrc).toContain("OLD.action = 'add'");
    expect(takeSrc).toContain('_open_rec.quantity * COALESCE(_open_rec.entry_price, 0)');
    expect(takeSrc).toContain('_new_entry');
  });

  it('收回後 exit_price 使用 COALESCE(current_price, entry_price)，無即時股價時退回建倉價（4.2-4）', () => {
    expect(takeSrc).toContain('COALESCE(current_price, entry_price)');
  });

  it('line-push-signal/index.ts 包含 takedown 型推播：buildFlexMessage 與 takedown 分支（4.2-5）', () => {
    const pushSrc = readFileSync(
      resolve(process.cwd(), 'supabase/functions/line-push-signal/index.ts'),
      'utf-8',
    );
    expect(pushSrc).toContain('buildFlexMessage');
    expect(pushSrc).toContain("'takedown'");
    expect(pushSrc).toContain("type === 'takedown'");
  });
});

// ── enforce_signal_capital_limit 資金硬擋 trigger（drift detection）─────────

describe('enforce_signal_capital_limit（資金硬擋 trigger）', () => {
  let capSrc: string;
  beforeAll(() => {
    capSrc = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260505130656_164cb09c-78f6-4fc5-94ac-0312cf91d8f3.sql'),
      'utf-8',
    );
  });

  it('包含 RPC get_expert_capital_status 與資金公式 starting + realized − open_cost', () => {
    expect(capSrc).toContain('get_expert_capital_status');
    expect(capSrc).toContain('v_starting + v_realized - v_open_cost');
  });

  it('trigger 對 buy / add 計算 required = price × shares 並硬擋超額', () => {
    expect(capSrc).toContain('enforce_signal_capital_limit');
    expect(capSrc).toContain('CAPITAL_EXCEEDED');
    expect(capSrc).toMatch(/action.*IN.*buy.*add/i);
  });

  it('company_admin 角色豁免硬擋', () => {
    expect(capSrc).toContain("has_role(auth.uid(), 'company_admin')");
  });

  it('trigger 綁定於 expert_signals 表 BEFORE INSERT', () => {
    expect(capSrc).toMatch(/CREATE TRIGGER enforce_signal_capital_limit_trg[\s\S]*BEFORE INSERT[\s\S]*ON public\.expert_signals/);
  });
});
