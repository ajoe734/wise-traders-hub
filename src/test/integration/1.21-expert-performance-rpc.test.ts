/**
 * Group 1.21 — 專家績效指標 RPC
 *
 * 測試範圍：
 *
 *   A. calcWinRate（src/lib/performanceCalc.ts）：
 *      勝率純函數，零除法防護（mirrors SQL CASE WHEN total_trades > 0）。
 *
 *   B. calcProfitFactor（src/lib/performanceCalc.ts）：
 *      獲利因子純函數，無虧損時回傳 999.99 上限（mirrors SQL 999.99 cap）。
 *
 *   C. calcMaxDrawdown（src/lib/performanceCalc.ts）：
 *      最大回撤純函數，模擬 SQL 內 FOR 迴圈 running-sum peak-tracking 算法。
 *
 *   D. drift-detection：calculate_expert_performance RPC
 *      確認 SQL 邏輯關鍵字符不漂移（5.3-1~5.3-7）。
 *        status IN ('closed', 'stopped')
 *        win_rate CASE WHEN total_trades > 0 零除防護
 *        profit_factor 999.99 上限 CASE
 *        LEFT JOIN current_prices + COALESCE 取價瀑布
 *        INTERVAL '1 year' 一年回報計算
 *        ⚠️ [生產缺口 5.3-7] experts.starting_capital 目前未被 RPC 引用
 *
 *   E. drift-detection：usePerformance.ts Hook
 *      確認 hook 正確呼叫 RPC 並設定 enabled 條件。
 *
 * 對應測試路徑：
 *   5.3-1：10 筆 7 獲利 3 虧損 → 勝率 70%
 *   5.3-2：無任何交易紀錄 → 回傳預設值不報錯（zero-guard）
 *   5.3-3：全部虧損 → 最大回撤 = abs(累積虧損)
 *   5.3-4：有 open 交易 → current_asset 使用 current_prices 即時計算
 *   5.3-5：current_prices 缺少某標的 → LEFT JOIN 不導致整體失敗
 *   5.3-6：profit_factor 分母為 0（無虧損）→ 不除以零，回傳 999.99
 *   5.3-7：⚠️ [生產缺口] starting_capital 為基準計算報酬率目前未實作，
 *           calculate_expert_performance RPC 不引用 experts 表
 *
 * 注意：calculate_expert_performance 不引用 experts 表與 starting_capital 欄位；
 *       cumulative_return 以 pnl_percent 累加為準，非起始資金百分比。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { calcWinRate, calcProfitFactor, calcMaxDrawdown } from '@/lib/performanceCalc';

// ── Section A: calcWinRate ────────────────────────────────────────────────────

describe('calcWinRate（勝率純函數）', () => {
  it('10 筆交易 7 獲利 → 70%（5.3-1）', () => {
    expect(calcWinRate(10, 7)).toBe(70);
  });

  it('totalTrades = 0 → 回傳 0，不除以零（5.3-2）', () => {
    expect(calcWinRate(0, 0)).toBe(0);
  });

  it('5 筆交易 0 獲利 → 0%（5.3-3）', () => {
    expect(calcWinRate(5, 0)).toBe(0);
  });
});

// ── Section B: calcProfitFactor ───────────────────────────────────────────────

describe('calcProfitFactor（獲利因子純函數）', () => {
  it('profit=700、loss=300 → profit_factor = 2.33（5.3-1）', () => {
    expect(calcProfitFactor(700, 300)).toBe(2.33);
  });

  it('profit > 0、loss = 0（無虧損）→ 999.99 上限（5.3-6）', () => {
    expect(calcProfitFactor(100, 0)).toBe(999.99);
  });

  it('profit = 0、loss = 0（無交易）→ 0（5.3-2）', () => {
    expect(calcProfitFactor(0, 0)).toBe(0);
  });
});

// ── Section C: calcMaxDrawdown ────────────────────────────────────────────────

describe('calcMaxDrawdown（最大回撤純函數）', () => {
  it('全部獲利 [+10, +5, +3] → 無回撤，max_drawdown = 0（5.3-1）', () => {
    const trades = [{ pnl_percent: 10 }, { pnl_percent: 5 }, { pnl_percent: 3 }];
    expect(calcMaxDrawdown(trades)).toBe(0);
  });

  it('全部虧損 [-5, -3, -2] → max_drawdown = 10（5.3-3）', () => {
    // running: -5 → -8 → -10；peak=0；worst_dd = 0 - (-10) = 10
    const trades = [{ pnl_percent: -5 }, { pnl_percent: -3 }, { pnl_percent: -2 }];
    expect(calcMaxDrawdown(trades)).toBe(10);
  });

  it('先漲後跌再漲再跌 [+10, -3, +5, -8] → peak tracking 正確，max_drawdown = 8（5.3-1/5.3-3）', () => {
    // running: 10(peak=10) → 7(dd=3) → 12(peak=12) → 4(dd=8) → worst_dd=8
    const trades = [
      { pnl_percent: 10 },
      { pnl_percent: -3 },
      { pnl_percent: 5 },
      { pnl_percent: -8 },
    ];
    expect(calcMaxDrawdown(trades)).toBe(8);
  });
});

// ── Section D: drift-detection: calculate_expert_performance RPC ─────────────

describe('drift-detection: calculate_expert_performance RPC 績效計算邏輯', () => {
  let rpcSrc: string;

  beforeAll(() => {
    rpcSrc = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260505120929_36f655b7-3ad1-4660-a265-f1623c74cc88.sql',
      ),
      'utf-8',
    );
  });

  it("status IN ('closed', 'stopped') 過濾已結算交易（5.3-1/5.3-3）", () => {
    expect(rpcSrc).toContain("status IN ('closed', 'stopped')");
  });

  it('win_rate 含 CASE WHEN total_trades > 0 零除防護（5.3-2）', () => {
    expect(rpcSrc).toContain('CASE WHEN total_trades > 0');
  });

  it('profit_factor 含 CASE WHEN loss_sum > 0 與 999.99 無虧損上限（5.3-6）', () => {
    expect(rpcSrc).toContain('CASE WHEN loss_sum > 0');
    expect(rpcSrc).toContain('999.99');
  });

  it("LEFT JOIN current_prices + COALESCE 取價瀑布 + quantity * 1000 + SPLIT_PART symbol 提取（5.3-4/5.3-5）", () => {
    expect(rpcSrc).toContain('LEFT JOIN public.current_prices cp');
    expect(rpcSrc).toContain('COALESCE(cp.price, tr.current_price, tr.entry_price, 0)');
    // 若 quantity * 1000 乘數改錯或 SPLIT_PART 邏輯變更，current_asset 計算將靜默錯誤
    expect(rpcSrc).toContain('tr.quantity * 1000');
    expect(rpcSrc).toContain("SPLIT_PART(tr.instrument, ' ', 1)");
  });

  it("exit_date >= one_year_ago（NOW() - INTERVAL '1 year'）計算年化回報（5.3-1）", () => {
    expect(rpcSrc).toContain("INTERVAL '1 year'");
    expect(rpcSrc).toContain('exit_date >= one_year_ago');
  });

  it('max_drawdown FOR 迴圈依賴 ORDER BY exit_date ASC NULLS LAST, created_at ASC 確保時序正確（5.3-1/5.3-3）', () => {
    // 排序變動（如移除 created_at tie-break 或改為 DESC）會導致 max_drawdown 計算值不一致
    expect(rpcSrc).toContain('ORDER BY exit_date ASC NULLS LAST, created_at ASC');
  });

  it("RPC jsonb_build_object 含前端依賴鍵 cumulative_return / current_asset 等（5.3-1/5.3-4）", () => {
    // 前端 PerformanceOverviewPanel.tsx / AppHome.tsx 直接存取這些鍵名
    // 若 jsonb_build_object 內的鍵名被重新命名，前端將靜默取得 undefined
    expect(rpcSrc).toContain("'cumulative_return'");
    expect(rpcSrc).toContain("'current_asset'");
    expect(rpcSrc).toContain("'win_rate'");
    expect(rpcSrc).toContain("'max_drawdown'");
    expect(rpcSrc).toContain("'profit_factor'");
  });

  it('✅ [生產缺口 5.3-7 已補] RPC 現以 experts.starting_capital 為基準計算 total_return_pct', () => {
    // 修正後 calculate_expert_performance 已引用 experts 表與 starting_capital
    expect(rpcSrc).toContain('starting_capital');
    expect(rpcSrc).toContain('public.experts');
    expect(rpcSrc).toContain("'total_return_pct'");
    expect(rpcSrc).toContain("'realized_pnl_amount'");
    expect(rpcSrc).toContain("'unrealized_pnl_amount'");
  });
});

// ── Section E: drift-detection: usePerformance.ts ────────────────────────────

describe('drift-detection: usePerformance.ts 績效 Hook', () => {
  let hookSrc: string;

  beforeAll(() => {
    hookSrc = readFileSync(
      resolve(process.cwd(), 'src/hooks/usePerformance.ts'),
      'utf-8',
    );
  });

  it("hook 呼叫 rpc('calculate_expert_performance') 並傳入 _expert_id 參數（5.3-1）", () => {
    expect(hookSrc).toContain("rpc('calculate_expert_performance'");
    expect(hookSrc).toContain('_expert_id');
  });

  it('enabled: !!expertId，expertId 為空時不觸發查詢（5.3-2）', () => {
    expect(hookSrc).toContain('!!expertId');
  });

  it('RPC 回傳 error 時 throw error，不靜默吞錯（error path）', () => {
    expect(hookSrc).toContain('if (error) throw error');
  });
});
