import { describe, expect, it } from 'vitest';
import { evaluateMarketDayGate, MARKET_DAY_MIN_ROWS } from '../../../supabase/functions/_shared/valuationSyncGate';

describe('market_day gate（9/23–10/02 停擺防呆）', () => {
  it('當日已有足量資料 → 晚間補跑 cron 跳過，不重複打 FinMind', () => {
    const g = evaluateMarketDayGate(1969, 0);
    expect(g.skip).toBe(true);
    expect(g.reason).toBe('already_full');
    expect(g.lowRows).toBe(false);
    expect(g.empty).toBe(false);
  });

  it('force = true → 即使已滿仍重跑（回補用）', () => {
    const g = evaluateMarketDayGate(1969, 0, MARKET_DAY_MIN_ROWS, true);
    expect(g.skip).toBe(false);
    expect(g.reason).toBeNull();
  });

  it('gate 查詢失敗（existing = null）→ 不阻擋主流程', () => {
    expect(evaluateMarketDayGate(null, 0).skip).toBe(false);
  });

  it('寫入筆數 0 < n < 1500 → lowRows 告警（9/24 起 ~79 筆情境）', () => {
    const g = evaluateMarketDayGate(0, 79);
    expect(g.skip).toBe(false);
    expect(g.lowRows).toBe(true);
    expect(g.empty).toBe(false);
  });

  it('寫入 0 筆 → 視為非交易日，記 log 不告警', () => {
    const g = evaluateMarketDayGate(0, 0);
    expect(g.lowRows).toBe(false);
    expect(g.empty).toBe(true);
  });

  it('寫入足量（>=1500）→ 正常成功，不告警', () => {
    const g = evaluateMarketDayGate(0, 1970);
    expect(g.skip).toBe(false);
    expect(g.lowRows).toBe(false);
    expect(g.empty).toBe(false);
  });

  it('自訂門檻：minRows 可覆寫（body.min_rows）', () => {
    expect(evaluateMarketDayGate(0, 79, 50).lowRows).toBe(false);
    expect(evaluateMarketDayGate(0, 79, 100).lowRows).toBe(true);
  });
});
