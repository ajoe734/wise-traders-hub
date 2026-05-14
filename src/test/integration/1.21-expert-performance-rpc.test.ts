/**
 * Group 1.21 — 專家績效指標 RPC（重寫後算法）
 *
 * 新算法重點：
 *   - 砍掉 cumulative_return / total_pnl（白癡的 % 加總）
 *   - max_drawdown 用 pnl_amount 累積 / starting_capital × 100
 *   - profit_factor 用實際金額（profit_sum_$ / loss_sum_$）
 *   - 新增 avg_pnl_pct（等權平均 %）+ avg_pnl_amount（平均單筆金額）
 *   - avg_hold_days 含 open trades（NOW() 當出場）
 *   - return_1y 改用 1 年內已實現金額 / starting_capital × 100
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import {
  calcWinRate,
  calcProfitFactor,
  calcMaxDrawdown,
  calcTotalReturnPct,
  calcAvgPnlPct,
  calcAvgPnlAmount,
  calcAvgHoldDays,
} from '@/lib/performanceCalc';

// ── A: calcWinRate ──
describe('calcWinRate', () => {
  it('10 筆 7 獲利 → 70%', () => expect(calcWinRate(10, 7)).toBe(70));
  it('totalTrades=0 → 0（zero-guard）', () => expect(calcWinRate(0, 0)).toBe(0));
  it('5 筆 0 獲利 → 0%', () => expect(calcWinRate(5, 0)).toBe(0));
});

// ── B: calcProfitFactor（金額版）──
describe('calcProfitFactor', () => {
  it('profit=$70000 / loss=$30000 → 2.33', () =>
    expect(calcProfitFactor(70000, 30000)).toBe(2.33));
  it('無虧損 → 999.99 上限', () => expect(calcProfitFactor(10000, 0)).toBe(999.99));
  it('全為 0 → 0', () => expect(calcProfitFactor(0, 0)).toBe(0));
});

// ── C: calcMaxDrawdown（金額版 → % of starting_capital）──
describe('calcMaxDrawdown', () => {
  it('全部獲利 → 0%', () => {
    const trades = [{ pnl_amount: 10000 }, { pnl_amount: 5000 }];
    expect(calcMaxDrawdown(trades, 1_000_000)).toBe(0);
  });

  it('全部虧損 [-50k,-30k,-20k] / 1M → 10%', () => {
    const trades = [{ pnl_amount: -50000 }, { pnl_amount: -30000 }, { pnl_amount: -20000 }];
    expect(calcMaxDrawdown(trades, 1_000_000)).toBe(10);
  });

  it('先漲後跌 [+100k,-30k,+50k,-80k] / 1M → 8%', () => {
    const trades = [
      { pnl_amount: 100000 },
      { pnl_amount: -30000 },
      { pnl_amount: 50000 },
      { pnl_amount: -80000 },
    ];
    expect(calcMaxDrawdown(trades, 1_000_000)).toBe(8);
  });

  it('startingCapital=0 → 0（zero-guard）', () => {
    expect(calcMaxDrawdown([{ pnl_amount: -1000 }], 0)).toBe(0);
  });
});

// ── D: calcTotalReturnPct ──
describe('calcTotalReturnPct', () => {
  it('realized=186000 + unrealized=46100 / 1M → 23.21%', () => {
    expect(calcTotalReturnPct(186000, 46100, 1_000_000)).toBe(23.21);
  });
  it('startingCapital=0 → 0', () => {
    expect(calcTotalReturnPct(100, 100, 0)).toBe(0);
  });
});

// ── E: calcAvgPnlPct / calcAvgPnlAmount ──
describe('calcAvgPnlPct / calcAvgPnlAmount', () => {
  it('avg of [36.78, 22.78, 28.55] → 29.37', () => {
    expect(calcAvgPnlPct([36.78, 22.78, 28.55])).toBe(29.37);
  });
  it('avg amount 186000/3 → 62000', () => {
    expect(calcAvgPnlAmount(186000, 3)).toBe(62000);
  });
  it('empty → 0', () => {
    expect(calcAvgPnlPct([])).toBe(0);
    expect(calcAvgPnlAmount(0, 0)).toBe(0);
  });
});

// ── F: calcAvgHoldDays（含 open）──
describe('calcAvgHoldDays', () => {
  it('open trade 用 NOW() 當出場', () => {
    const now = new Date('2026-05-14T00:00:00Z');
    const trades = [
      { entry_date: new Date('2026-05-04T00:00:00Z'), exit_date: null }, // 10 days
      { entry_date: new Date('2026-05-09T00:00:00Z'), exit_date: new Date('2026-05-14T00:00:00Z') }, // 5 days
    ];
    expect(calcAvgHoldDays(trades, now)).toBe(7.5);
  });
});

// ── G: drift-detection: calculate_expert_performance RPC ──
describe('drift-detection: calculate_expert_performance RPC', () => {
  let rpcSrc: string;

  beforeAll(() => {
    // 讀最新一份引用 calculate_expert_performance 的 migration
    const migrationsDir = resolve(process.cwd(), 'supabase/migrations');
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const latest = files
      .reverse()
      .find((f) => {
        const c = readFileSync(resolve(migrationsDir, f), 'utf-8');
        return c.includes('calculate_expert_performance') && c.includes('avg_pnl_pct');
      });
    if (!latest) throw new Error('找不到含 calculate_expert_performance + avg_pnl_pct 的最新 migration');
    rpcSrc = readFileSync(resolve(migrationsDir, latest), 'utf-8');
  });

  it("status IN ('closed', 'stopped') 過濾已結算交易", () => {
    expect(rpcSrc).toContain("status IN ('closed', 'stopped')");
  });

  it('win_rate 含 CASE WHEN total_trades > 0 零除防護', () => {
    expect(rpcSrc).toContain('CASE WHEN total_trades > 0');
  });

  it('profit_factor 用金額計算 + 999.99 cap', () => {
    expect(rpcSrc).toContain('v_loss_sum_amt');
    expect(rpcSrc).toContain('999.99');
  });

  it('current_asset 用 LEFT JOIN current_prices 取價瀑布', () => {
    expect(rpcSrc).toContain('LEFT JOIN public.current_prices cp');
    expect(rpcSrc).toContain('COALESCE(cp.price, tr.current_price, tr.entry_price, 0)');
    expect(rpcSrc).toContain("SPLIT_PART(tr.instrument, ' ', 1)");
  });

  it('return_1y 用 INTERVAL 1 year', () => {
    expect(rpcSrc).toContain("INTERVAL '1 year'");
  });

  it('max_drawdown FOR 迴圈用金額 + ORDER BY exit_date ASC NULLS LAST', () => {
    expect(rpcSrc).toContain('ORDER BY exit_date ASC NULLS LAST, created_at ASC');
    expect(rpcSrc).toContain('worst_dd_amt');
  });

  it('jsonb 鍵：新欄位 total_return_pct/avg_pnl_pct/avg_pnl_amount + 砍掉 cumulative_return/total_pnl/avg_pnl', () => {
    expect(rpcSrc).toContain("'total_return_pct'");
    expect(rpcSrc).toContain("'avg_pnl_pct'");
    expect(rpcSrc).toContain("'avg_pnl_amount'");
    expect(rpcSrc).toContain("'realized_pnl_amount'");
    expect(rpcSrc).toContain("'unrealized_pnl_amount'");
    expect(rpcSrc).toContain("'max_drawdown'");
    expect(rpcSrc).toContain("'profit_factor'");
    expect(rpcSrc).not.toContain("'cumulative_return'");
    expect(rpcSrc).not.toContain("'total_pnl'");
    expect(rpcSrc).not.toMatch(/'avg_pnl'(?!_)/);
  });

  it('starting_capital 仍為基準 + 引用 experts 表', () => {
    expect(rpcSrc).toContain('starting_capital');
    expect(rpcSrc).toContain('public.experts');
  });

  it('avg_hold_days 含 open trades（status IN open/closed/stopped）', () => {
    expect(rpcSrc).toContain("status IN ('open', 'closed', 'stopped')");
    expect(rpcSrc).toContain('COALESCE(exit_date, NOW())');
  });
});

// ── H: drift-detection: usePerformance.ts ──
describe('drift-detection: usePerformance.ts', () => {
  let hookSrc: string;

  beforeAll(() => {
    hookSrc = readFileSync(resolve(process.cwd(), 'src/hooks/usePerformance.ts'), 'utf-8');
  });

  it("hook 呼叫 rpc('calculate_expert_performance')", () => {
    expect(hookSrc).toContain("rpc('calculate_expert_performance'");
    expect(hookSrc).toContain('_expert_id');
  });

  it('enabled: !!expertId', () => expect(hookSrc).toContain('!!expertId'));
  it('error path throw', () => expect(hookSrc).toContain('if (error) throw error'));

  it('interface 含新欄位、不再含舊欄位', () => {
    expect(hookSrc).toContain('total_return_pct');
    expect(hookSrc).toContain('avg_pnl_pct');
    expect(hookSrc).toContain('avg_pnl_amount');
    expect(hookSrc).not.toContain('cumulative_return');
    expect(hookSrc).not.toContain('total_pnl');
  });
});
