/**
 * Group 1.15 — Suspended 專家可見性
 *
 * 測試範圍：
 *
 *   A. getVisibilityMode（src/hooks/useExpert.ts）：
 *      依 user 狀態（null / 一般 / is_tester / company_admin / analyst）
 *      回傳正確的能見度模式（'default' / 'tester' / 'privileged'）。
 *
 *   B. filterExpertRows（src/hooks/useExpert.ts）：
 *      驗證三種能見度模式下，active / draft / suspended 的過濾邏輯：
 *        3.7-1：匿名（default）→ 只顯示 active，suspended 被排除
 *        3.7-2：匿名查 suspended 專家的 expert_plans → 整行過濾，plans 亦消失
 *        3.7-3：測試者（tester）→ 顯示 draft，suspended 被排除
 *
 *   C. drift-detection：
 *      DB 端 RLS migration 20260409082938 確認以 active/draft 白名單排除 suspended；
 *      useExpert.ts 定義並使用 filterExpertRows / getVisibilityMode。
 *
 * 對應測試路徑：
 *   3.7-1 ~ 3.7-3：Suspended 專家可見性
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getVisibilityMode, filterExpertRows, mapToPersonWithPlans } from '@/hooks/useExpert';

// ── getVisibilityMode（能見度模式判斷）───────────────────────────────────────

describe('getVisibilityMode（能見度模式判斷）', () => {
  it('user 為 null（匿名訪客）→ 回傳 default', () => {
    expect(getVisibilityMode(null)).toBe('default');
  });

  it('一般會員（roles=[], isTester=false）→ 回傳 default', () => {
    expect(getVisibilityMode({ roles: [], isTester: false })).toBe('default');
  });

  it('is_tester=true 的會員 → 回傳 tester（3.7-3）', () => {
    expect(getVisibilityMode({ roles: [], isTester: true })).toBe('tester');
  });

  it('company_admin 角色 → 回傳 privileged', () => {
    expect(getVisibilityMode({ roles: ['company_admin'], isTester: false })).toBe('privileged');
  });

  it('analyst 角色 → 回傳 privileged', () => {
    expect(getVisibilityMode({ roles: ['analyst'], isTester: false })).toBe('privileged');
  });
});

// ── filterExpertRows（狀態過濾邏輯）──────────────────────────────────────────

describe('filterExpertRows（狀態過濾邏輯）', () => {
  const activeExpert = {
    id: 'e1',
    status: 'active',
    expert_plans: [{ id: 'p1', is_active: true }],
  };
  const draftExpert = {
    id: 'e2',
    status: 'draft',
    expert_plans: [],
  };
  const suspendedExpert = {
    id: 'e3',
    status: 'suspended',
    expert_plans: [{ id: 'p3', is_active: true }],
  };
  const allRows = [activeExpert, draftExpert, suspendedExpert];

  it('default mode：active 專家 → 保留（3.7-1）', () => {
    const result = filterExpertRows([activeExpert], 'default');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e1');
  });

  it('default mode：suspended 專家 → 過濾移除（3.7-1）', () => {
    const result = filterExpertRows([suspendedExpert], 'default');
    expect(result).toHaveLength(0);
  });

  it('default mode：draft 專家 → 過濾移除', () => {
    const result = filterExpertRows([draftExpert], 'default');
    expect(result).toHaveLength(0);
  });

  it('default mode：suspended 專家的 expert_plans 亦消失（整行過濾）（3.7-2）', () => {
    const result = filterExpertRows(allRows, 'default');
    // suspended expert 整行被過濾，其 plans 不出現在結果中
    const returnedIds = result.map((r) => r.id);
    expect(returnedIds).not.toContain('e3');
    const allPlans = result.flatMap((r) => r.expert_plans as { id: string }[]);
    const planIds = allPlans.map((p) => p.id);
    expect(planIds).not.toContain('p3');
  });

  it('tester mode：draft 專家 → 保留（3.7-3）', () => {
    const result = filterExpertRows([draftExpert], 'tester');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e2');
  });

  it('tester mode：active 專家 → 過濾移除（tester 僅預覽 draft）', () => {
    const result = filterExpertRows([activeExpert], 'tester');
    expect(result).toHaveLength(0);
  });

  it('tester mode：suspended 專家 → 過濾移除（3.7-3）', () => {
    const result = filterExpertRows([suspendedExpert], 'tester');
    expect(result).toHaveLength(0);
  });

  it('privileged mode：active / draft / suspended 三種狀態全部保留', () => {
    const result = filterExpertRows(allRows, 'privileged');
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.status)).toEqual(
      expect.arrayContaining(['active', 'draft', 'suspended']),
    );
  });
});

// ── mapToPersonWithPlans（row → PersonWithPlans 映射）────────────────────────

describe('mapToPersonWithPlans（null 欄位 fallback 分支）', () => {
  it('row 的 bio/description/style_tags/markets/strategy_summary 為 null → 回傳空字串與空陣列', () => {
    const row = {
      id: 'e-test', slug: 'test', name: '測試專家', role: 'advisor',
      avatar_url: null, bio: null, description: null, style_tags: null,
      markets: null, strategy_summary: null,
      backtest_1y_return: null, backtest_max_drawdown: null,
      backtest_annual_return: null, starting_capital: null,
      expert_plans: [],
    };
    const result = mapToPersonWithPlans(row);
    expect(result.bio).toBe('');
    expect(result.description).toBe('');
    expect(result.styleTags).toEqual([]);
    expect(result.markets).toEqual([]);
    expect(result.strategySummary).toBe('');
  });

  it('plan 的 description=null / price_yearly=null / features 非陣列 → 回傳空字串、0、空陣列', () => {
    const row = {
      id: 'e-test', slug: 'test', name: '測試專家', role: 'advisor',
      avatar_url: null, bio: null, description: null, style_tags: null,
      markets: null, strategy_summary: null,
      backtest_1y_return: null, backtest_max_drawdown: null,
      backtest_annual_return: null, starting_capital: null,
      expert_plans: [
        {
          id: 'p1', plan_type: 'monthly', name: '基礎方案', is_active: true,
          description: null, price_monthly: 299, price_yearly: null, features: null,
        },
      ],
    };
    const result = mapToPersonWithPlans(row);
    expect(result.plans[0].description).toBe('');
    expect(result.plans[0].priceYearly).toBe(0);
    expect(result.plans[0].features).toEqual([]);
  });
});

// ── drift-detection ───────────────────────────────────────────────────────────

describe('drift-detection: suspended 專家 RLS 與 client-side 過濾', () => {
  it('DB migration 20260409082938：RLS USING 以白名單（active/draft）排除 suspended', () => {
    const src = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260409082938_282e8b86-6c38-425e-9a7c-135a57ee6953.sql',
      ),
      'utf-8',
    );
    // 白名單：active 與（draft AND is_tester），suspended 未列入
    expect(src).toContain("status = 'active'");
    expect(src).toContain('is_tester');
    expect(src).not.toContain("'suspended'");
  });

  it('useExpert.ts 定義 filterExpertRows，以 status 欄位過濾 active / draft（3.7-1 ~ 3.7-3）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/hooks/useExpert.ts'),
      'utf-8',
    );
    expect(src).toContain('filterExpertRows');
    expect(src).toContain("status === 'active'");
    expect(src).toContain("status === 'draft'");
  });

  it('useExpert.ts 定義 getVisibilityMode，依 isTester / roles 回傳 tester / privileged', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/hooks/useExpert.ts'),
      'utf-8',
    );
    expect(src).toContain('getVisibilityMode');
    expect(src).toContain('isTester');
    expect(src).toContain("'tester'");
    expect(src).toContain("'privileged'");
  });

  it('ExpertProfile.tsx inline 能見度檢查：active 或（draft AND isTester），suspended 被排除（3.7-1）', () => {
    // ExpertProfile.tsx 不走 useExpert hook，而是自行查詢 experts 後以 inline 條件判斷；
    // 此 drift test 守護該條件不被移除，確保 suspended 無法透過 profile 頁面曝光。
    const src = readFileSync(
      resolve(process.cwd(), 'src/pages/ExpertProfile.tsx'),
      'utf-8',
    );
    expect(src).toContain("status === 'active'");
    expect(src).toContain("status === 'draft'");
    expect(src).toContain('isTester');
  });

  it('expert_plans RLS migration 20260411134638：公開 SELECT 條件為 is_active = true（未關聯 expert.status）', () => {
    // 此 drift 記錄 DB 端 expert_plans 的實際保護範圍：
    // 任何人皆可直接查詢 is_active=true 的方案，包含 suspended expert 的方案。
    // suspended expert 的 plans 消失，係由 hooks 層 filterExpertRows 的 client-side 過濾保障，
    // 而非 DB-level 欄位關聯。若未來 RLS 加上 expert status join，此測試需同步更新。
    const src = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260411134638_fbc17435-f74d-46cd-b85c-d2d8037c4e4c.sql',
      ),
      'utf-8',
    );
    expect(src).toContain('is_active = true');
    expect(src).not.toContain("status = 'active'");  // 確認無 expert status 關聯
  });
});
