/**
 * Demo seed leak 守門測試
 *
 * 業務憲法（不准被改回去）：
 *   authenticated 模式下，DEMO_SEED_CODES 中的代碼若沒有「使用者來源」標記
 *   （userOrigin=true / tradeLogTouched=true / priceSource in screenshot|manual），
 *   一律剔除。任何欄位值差異（realtime 報價、backfill 補價、小數位漂移）都不該救回 demo seed。
 *
 * 一旦這個檔失守 → 視為「云云事件」迴歸，立刻會把 demo 個股混進付費使用者的持倉看板。
 */
import { describe, it, expect } from 'vitest';
import {
  DEMO_SEED_CODES,
  stripDemoSeedHoldings,
  holdingHasUserOrigin,
  markUserOwnedHolding,
} from '@/pages/_freeCheckup/constants';
import { INIT_HOLDINGS } from '@/checkup/seedData';

describe('stripDemoSeedHoldings — authenticated 模式禁止 demo seed 殘留', () => {
  it('DEMO_SEED_CODES 必須涵蓋 INIT_HOLDINGS 的每一個 code', () => {
    for (const h of INIT_HOLDINGS) {
      expect(DEMO_SEED_CODES.has(String(h.code))).toBe(true);
    }
  });

  it('seed code + realtime 改寫過的 price/value/pnl/pct 仍須被剔除（舊 bug 的核心）', () => {
    const polluted = INIT_HOLDINGS.map((h) => ({
      ...h,
      // 模擬被 realtime 推送改寫
      price: (Number(h.price) || 0) * 1.0123,
      value: (Number(h.value) || 0) + 17,
      pnl: (Number(h.pnl) || 0) - 3,
      pct: (Number(h.pct) || 0) + 0.0007,
      priceSource: 'realtime',
      priceUpdatedAt: new Date().toISOString(),
    }));
    const out = stripDemoSeedHoldings(polluted);
    expect(out.length).toBe(0);
  });

  it('seed code 但帶 userOrigin=true → 必須保留（使用者真的持有）', () => {
    const list = INIT_HOLDINGS.map((h) => ({ ...h, userOrigin: true }));
    const out = stripDemoSeedHoldings(list);
    expect(out.length).toBe(INIT_HOLDINGS.length);
  });

  it('seed code 但 priceSource=screenshot → 必須保留', () => {
    const list = INIT_HOLDINGS.map((h) => ({ ...h, priceSource: 'screenshot' }));
    const out = stripDemoSeedHoldings(list);
    expect(out.length).toBe(INIT_HOLDINGS.length);
  });

  it('seed code 但 priceSource=manual → 必須保留', () => {
    const list = INIT_HOLDINGS.map((h) => ({ ...h, priceSource: 'manual' }));
    const out = stripDemoSeedHoldings(list);
    expect(out.length).toBe(INIT_HOLDINGS.length);
  });

  it('seed code 但 tradeLogTouched=true → 必須保留', () => {
    const list = INIT_HOLDINGS.map((h) => ({ ...h, tradeLogTouched: true }));
    const out = stripDemoSeedHoldings(list);
    expect(out.length).toBe(INIT_HOLDINGS.length);
  });

  it('非 seed code 一律保留（即使沒有 userOrigin）', () => {
    const list = [
      { code: '2330', name: '台積電', qty: 1, price: 1000, cost: 900, value: 1000, pnl: 100, pct: 11.11, type: '股票', priceSource: 'realtime' },
      { code: '00940', name: '不知名 ETF', qty: 1000, price: 10, cost: 10, value: 10000, pnl: 0, pct: 0, type: 'ETF' },
    ];
    const out = stripDemoSeedHoldings(list);
    expect(out.length).toBe(2);
  });

  it('混合：seed (未標記) + seed (已標記) + 非 seed → 只應剩後兩者', () => {
    const list = [
      { code: '1503', name: '士電', qty: 9, price: 205, cost: 229.5, priceSource: 'realtime' }, // seed 無標記 → 殺
      { code: '2308', name: '台達電', qty: 2, price: 2415, cost: 1287.5, priceSource: 'screenshot' }, // seed + screenshot → 保留
      { code: '2330', name: '台積電', qty: 40, price: 2305, cost: 76530, priceSource: 'realtime' }, // 非 seed → 保留
    ];
    const out = stripDemoSeedHoldings(list);
    expect(out.map((h: any) => h.code).sort()).toEqual(['2308', '2330']);
  });

  it('空陣列 / 非陣列 → 回空陣列', () => {
    expect(stripDemoSeedHoldings([])).toEqual([]);
    expect(stripDemoSeedHoldings(null as any)).toEqual([]);
    expect(stripDemoSeedHoldings(undefined as any)).toEqual([]);
  });
});

describe('holdingHasUserOrigin / markUserOwnedHolding', () => {
  it('holdingHasUserOrigin 對四種標記皆判 true', () => {
    expect(holdingHasUserOrigin({ userOrigin: true } as any)).toBe(true);
    expect(holdingHasUserOrigin({ tradeLogTouched: true } as any)).toBe(true);
    expect(holdingHasUserOrigin({ priceSource: 'screenshot' } as any)).toBe(true);
    expect(holdingHasUserOrigin({ priceSource: 'manual' } as any)).toBe(true);
  });

  it('holdingHasUserOrigin 對 realtime/live/未設 → false', () => {
    expect(holdingHasUserOrigin({ priceSource: 'realtime' } as any)).toBe(false);
    expect(holdingHasUserOrigin({ priceSource: 'live' } as any)).toBe(false);
    expect(holdingHasUserOrigin({} as any)).toBe(false);
    expect(holdingHasUserOrigin(null as any)).toBe(false);
  });

  it('markUserOwnedHolding 為冪等', () => {
    const h = { code: '1503', userOrigin: true };
    expect(markUserOwnedHolding(h)).toBe(h);
    const h2 = { code: '1503' };
    const out = markUserOwnedHolding(h2 as any);
    expect((out as any).userOrigin).toBe(true);
  });
});
