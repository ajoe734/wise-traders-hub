/**
 * Group 1.22 — 漲停排行榜 RPC
 *
 * 測試範圍：
 *
 *   A. calcLeaderboardWinRate（src/lib/leaderboardCalc.ts）：
 *      週排行勝率純函數，zero-div 防護，小數點 1 位精度。
 *      mirrors SQL：CASE WHEN COALESCE(p.total_closed, 0) > 0 THEN ROUND(..., 1) ELSE 0 END
 *
 *   B. drift-detection：get_weekly_limit_up_leaderboard RPC
 *      確認 SQL 邏輯關鍵字符不漂移（5.6-1 ~ 5.6-5）。
 *        trade_date BETWEEN _start_date AND _end_date（兩端含邊界）
 *        status IN ('closed','stopped') 計算 win_rate 母數
 *        pnl_percent > 0 計算勝場數
 *        exit_date >= _start_date::timestamptz 計算週報酬率
 *        CASE WHEN COALESCE(p.total_closed, 0) > 0 零除防護
 *        JOIN experts e … AND e.status = 'active'（只顯示活躍專家）
 *        ORDER BY h.cnt DESC, weekly_return DESC + LIMIT 10
 *
 *   C. drift-detection：useWeeklyLeaderboard.ts Hook
 *      確認 hook 呼叫 RPC、傳播錯誤、空結果處理與首位標記。
 *
 * 對應測試路徑：
 *   5.6-1：本週 3 支漲停命中 → limit_up_count = 3（hits CTE COUNT）
 *   5.6-2：本週無任何漲停 → 回傳空陣列（hits CTE 無結果）
 *   5.6-3：weekly_return 加權報酬率計算（exit_date >= _start_date 週期）
 *   5.6-4：win_rate 本週 closed 交易勝率（pnl_percent > 0 / total_closed）
 *   5.6-5：跨週邊界 _start_date/_end_date 參數 → BETWEEN 正確包含邊界日期
 *
 * 注意：RPC 使用 BETWEEN（兩端含邊界），與 cleanup_old_announcements 的 < 比較符不同。
 *       排行榜 LIMIT 10，只回傳漲停最多的前 10 名；同數漲停時以 weekly_return DESC 決勝。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { calcLeaderboardWinRate } from '@/lib/leaderboardCalc';

// ── Section A: calcLeaderboardWinRate ─────────────────────────────────────────

describe('calcLeaderboardWinRate（週排行勝率純函數）', () => {
  it('10 筆 closed、7 獲利 → 70%（5.6-4）', () => {
    expect(calcLeaderboardWinRate(10, 7)).toBe(70);
  });

  it('totalClosed = 0 → 回傳 0，不除以零（5.6-4 zero-guard）', () => {
    expect(calcLeaderboardWinRate(0, 0)).toBe(0);
  });

  it('3 筆全部獲利 → 100%（5.6-4）', () => {
    expect(calcLeaderboardWinRate(3, 3)).toBe(100);
  });

  it('3 筆 2 獲利 → 66.7%（1 位小數 rounding 驗證，5.6-4）', () => {
    // (2/3) * 100 = 66.666… → round1 → 66.7
    // 若 round1 改為 Math.floor 或改為 2 位小數，此測試將失敗
    expect(calcLeaderboardWinRate(3, 2)).toBe(66.7);
  });
});

// ── Section B: drift-detection: get_weekly_limit_up_leaderboard RPC ──────────

describe('drift-detection: get_weekly_limit_up_leaderboard RPC 漲停排行邏輯', () => {
  let rpcSrc: string;

  beforeAll(() => {
    rpcSrc = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260411122030_df1211b9-9a01-4ddb-8e47-df9b058c0a74.sql',
      ),
      'utf-8',
    );
  });

  it('hits CTE 以 trade_date BETWEEN _start_date AND _end_date 計數（5.6-1/5.6-5）', () => {
    // BETWEEN 兩端含邊界確保 _start_date 和 _end_date 當日均計入
    expect(rpcSrc).toContain('trade_date BETWEEN _start_date AND _end_date');
  });

  it("perf CTE 以 status IN ('closed','stopped') 計算有效交易母數（5.6-4）", () => {
    expect(rpcSrc).toContain("status IN ('closed','stopped')");
  });

  it('perf CTE 以 pnl_percent > 0 計算勝場數（5.6-4）', () => {
    expect(rpcSrc).toContain('pnl_percent > 0');
  });

  it('weekly_return 以 exit_date >= _start_date::timestamptz 計入週起已結算交易（無 _end_date 上界，5.6-3）', () => {
    // SQL 的 week_ret 只設下界（>= _start_date），未設 _end_date 上界
    // 意味超過 _end_date 的已結算交易仍計入；此行為由此斷言鎖定
    expect(rpcSrc).toContain('exit_date >= _start_date::timestamptz');
  });

  it('win_rate 含 CASE WHEN COALESCE(p.total_closed, 0) > 0 零除防護（5.6-4）', () => {
    expect(rpcSrc).toContain('CASE WHEN COALESCE(p.total_closed, 0) > 0');
  });

  it("JOIN experts 含 e.status = 'active' 條件，suspended 專家不出現排行（5.6-1）", () => {
    expect(rpcSrc).toContain("e.status = 'active'");
  });

  it('結果依 h.cnt DESC, weekly_return DESC 排序並 LIMIT 10（5.6-1）', () => {
    expect(rpcSrc).toContain('ORDER BY h.cnt DESC, weekly_return DESC');
    expect(rpcSrc).toContain('LIMIT 10');
  });
});

// ── Section C: drift-detection: useWeeklyLeaderboard.ts ──────────────────────

describe('drift-detection: useWeeklyLeaderboard.ts 排行榜 Hook', () => {
  let hookSrc: string;

  beforeAll(() => {
    hookSrc = readFileSync(
      resolve(process.cwd(), 'src/hooks/useWeeklyLeaderboard.ts'),
      'utf-8',
    );
  });

  it("hook 呼叫 rpc('get_weekly_limit_up_leaderboard')（5.6-1）", () => {
    expect(hookSrc).toContain("rpc('get_weekly_limit_up_leaderboard')");
  });

  it('RPC 回傳 error 時 throw error；空結果時回傳 []（5.6-2）', () => {
    expect(hookSrc).toContain('if (error) throw error');
    expect(hookSrc).toContain('data.length === 0');
    expect(hookSrc).toContain('return []');
  });

  it('第一筆 isHighlighted = true（i === 0），rank = i + 1（5.6-1）', () => {
    expect(hookSrc).toContain('isHighlighted: i === 0');
    expect(hookSrc).toContain('rank: i + 1');
  });
});
