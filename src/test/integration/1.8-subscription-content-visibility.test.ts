/**
 * Group 1.8 — 訂閱內容 RLS 可見性（has_active_subscription_after + T+7）
 *
 * 測試範圍：
 *   isVisibleAfterSubscription（src/lib/subscriptionVisibility.ts）：
 *     純函數，對應 has_active_subscription_after SQL 中的日期條件：
 *       mentor：published_at + 7 days >= started_at（T+7 寬限期）
 *       analyst：published_at >= started_at（嚴格，無寬限）
 *
 *   fetchSubscriberSignals（src/lib/subscriptionVisibility.ts）：
 *     多步 DB 查詢；依訂閱狀態決定回傳訊號或空集，含三條 DB 錯誤路徑
 *
 *   drift-detection：
 *     has_active_subscription_after migration 保有 T+7 邏輯
 *     expert_signals RLS policy 使用 has_active_subscription_after
 *
 * 對應測試路徑：
 *   2.1-1：有效訂閱 → signals 返回
 *   2.1-2/3/4：未訂閱 / 過期 / 取消 → member_subscriptions 無 active 紀錄 → 空集
 *   2.1-5：方案 A 訂閱 → expert_signals.in() 只含方案 A 的 expert_id
 *   2.1-6：無 userId（匿名）→ 不呼叫 DB，返回空
 *   2.2-1：mentor，發布日 = 訂閱日 → 可見
 *   2.2-2：mentor，發布日 = 訂閱日前 5 天 → 可見（T+7 寬限內）
 *   2.2-3：mentor，發布日 = 訂閱日前 8 天 → 不可見（超過 T+7）
 *   2.2-4：analyst，發布日 = 訂閱日前 1 天 → 不可見（analyst 無 T+7）
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createQueryMock } from '@/test/mocks/supabase';
import {
  isVisibleAfterSubscription,
  fetchSubscriberSignals,
} from '@/lib/subscriptionVisibility';

// ── isVisibleAfterSubscription（T+7 窗口純函數）──────────────────────────────

describe('isVisibleAfterSubscription（T+7 窗口邏輯）', () => {
  it('mentor，發布日 = 訂閱日當天 → 可見（2.2-1）', () => {
    const startedAt  = new Date('2026-04-10T00:00:00.000Z');
    const publishedAt = new Date('2026-04-10T00:00:00.000Z');
    expect(isVisibleAfterSubscription('mentor', publishedAt, startedAt)).toBe(true);
  });

  it('mentor，發布日 = 訂閱日前 5 天 → 可見（T+7 寬限內，2.2-2）', () => {
    const startedAt  = new Date('2026-04-10T00:00:00.000Z');
    const publishedAt = new Date('2026-04-05T00:00:00.000Z');
    expect(isVisibleAfterSubscription('mentor', publishedAt, startedAt)).toBe(true);
  });

  it('mentor，發布日 = 訂閱日前恰好 7 天 → 可見（T+7 邊界，>= 成立）', () => {
    const startedAt  = new Date('2026-04-10T00:00:00.000Z');
    // published + 7d == startedAt → >= 成立 → 可見
    const publishedAt = new Date('2026-04-03T00:00:00.000Z');
    expect(isVisibleAfterSubscription('mentor', publishedAt, startedAt)).toBe(true);
  });

  it('mentor，發布日 = 訂閱日前 8 天 → 不可見（超過 T+7，2.2-3）', () => {
    const startedAt  = new Date('2026-04-10T00:00:00.000Z');
    const publishedAt = new Date('2026-04-02T00:00:00.000Z');
    expect(isVisibleAfterSubscription('mentor', publishedAt, startedAt)).toBe(false);
  });

  it('analyst，發布日 = 訂閱日當天 → 可見（analyst >= 邊界成立）', () => {
    const startedAt  = new Date('2026-04-10T00:00:00.000Z');
    const publishedAt = new Date('2026-04-10T00:00:00.000Z');
    expect(isVisibleAfterSubscription('analyst', publishedAt, startedAt)).toBe(true);
  });

  it('analyst，發布日 = 訂閱日前 1 天 → 不可見（analyst 無 T+7，2.2-4）', () => {
    const startedAt  = new Date('2026-04-10T00:00:00.000Z');
    const publishedAt = new Date('2026-04-09T00:00:00.000Z');
    expect(isVisibleAfterSubscription('analyst', publishedAt, startedAt)).toBe(false);
  });
});

// ── fetchSubscriberSignals（訂閱內容查詢）────────────────────────────────────

describe('fetchSubscriberSignals（依訂閱狀態查詢 expert_signals）', () => {
  it('無 userId（匿名）→ 不呼叫 DB，返回空（2.1-6）', async () => {
    const supabase = { from: vi.fn() };

    const result = await fetchSubscriberSignals(supabase as any, undefined);

    expect(result.signals).toEqual([]);
    expect(result.hasSubscription).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('有效訂閱 → 依序查詢三張表，回傳 signals（2.1-1）', async () => {
    const memberSubsMock = createQueryMock({
      data: [{ plan_id: 'plan-a', expert_plans: { expert_id: 'expert-a' } }],
      error: null,
    });
    const expertsMock = createQueryMock({
      data: [{ id: 'expert-a' }],
      error: null,
    });
    const signalsMock = createQueryMock({
      data: [{ id: 'sig-1', instrument: '2330', action: 'buy', expert_id: 'expert-a' }],
      error: null,
    });
    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(memberSubsMock)
        .mockReturnValueOnce(expertsMock)
        .mockReturnValueOnce(signalsMock),
    };

    const result = await fetchSubscriberSignals(supabase as any, 'user-001');

    expect(result.hasSubscription).toBe(true);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].id).toBe('sig-1');
  });

  it('無有效訂閱（未訂閱 / 過期 / 取消）→ hasSubscription=false，不查詢 expert_signals（2.1-2/3/4）', async () => {
    const memberSubsMock = createQueryMock({ data: [], error: null });
    const supabase = {
      from: vi.fn().mockReturnValue(memberSubsMock),
    };

    const result = await fetchSubscriberSignals(supabase as any, 'user-002');

    expect(result.signals).toEqual([]);
    expect(result.hasSubscription).toBe(false);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('方案 A 訂閱 → expert_signals.in() 只含方案 A 的 expert_id（2.1-5）', async () => {
    const memberSubsMock = createQueryMock({
      data: [{ plan_id: 'plan-a', expert_plans: { expert_id: 'expert-a' } }],
      error: null,
    });
    const expertsMock = createQueryMock({
      data: [{ id: 'expert-a' }],
      error: null,
    });
    const signalsMock = createQueryMock({ data: [], error: null });
    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(memberSubsMock)
        .mockReturnValueOnce(expertsMock)
        .mockReturnValueOnce(signalsMock),
    };

    await fetchSubscriberSignals(supabase as any, 'user-003');

    expect(signalsMock.in).toHaveBeenCalledWith('expert_id', ['expert-a']);
  });

  it('status=active 但 expert_signals 空（RLS 過濾）→ hasSubscription=true，signals=[]', async () => {
    // 模擬 expire-subscriptions 排程尚未跑、DB 仍有 status=active 但 expires_at 已過；
    // client 查詢到訂閱（hasSubscription=true），但 DB 端 RLS 過濾訊號（signals=[]）
    const memberSubsMock = createQueryMock({
      data: [{ plan_id: 'plan-a', expert_plans: { expert_id: 'expert-a' } }],
      error: null,
    });
    const expertsMock = createQueryMock({
      data: [{ id: 'expert-a' }],
      error: null,
    });
    const signalsMock = createQueryMock({ data: [], error: null }); // RLS 返回空
    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(memberSubsMock)
        .mockReturnValueOnce(expertsMock)
        .mockReturnValueOnce(signalsMock),
    };

    const result = await fetchSubscriberSignals(supabase as any, 'user-004');

    expect(result.hasSubscription).toBe(true);
    expect(result.signals).toEqual([]);
  });

  it('member_subscriptions 查詢失敗 → hasSubscription=false，不繼續查詢', async () => {
    const memberSubsMock = createQueryMock({ data: null, error: { message: 'DB error' } });
    const supabase = {
      from: vi.fn().mockReturnValue(memberSubsMock),
    };

    const result = await fetchSubscriberSignals(supabase as any, 'user-005');

    expect(result.signals).toEqual([]);
    expect(result.hasSubscription).toBe(false);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('experts 查詢失敗 → hasSubscription=false，不查詢 expert_signals', async () => {
    const memberSubsMock = createQueryMock({
      data: [{ plan_id: 'plan-a', expert_plans: { expert_id: 'expert-a' } }],
      error: null,
    });
    const expertsMock = createQueryMock({ data: null, error: { message: 'experts error' } });
    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(memberSubsMock)
        .mockReturnValueOnce(expertsMock),
    };

    const result = await fetchSubscriberSignals(supabase as any, 'user-006');

    expect(result.signals).toEqual([]);
    expect(result.hasSubscription).toBe(false);
    expect(supabase.from).toHaveBeenCalledTimes(2);
  });

  it('expert_signals 查詢失敗 → signals=[]，hasSubscription=true（已確認有訂閱）', async () => {
    const memberSubsMock = createQueryMock({
      data: [{ plan_id: 'plan-a', expert_plans: { expert_id: 'expert-a' } }],
      error: null,
    });
    const expertsMock = createQueryMock({
      data: [{ id: 'expert-a' }],
      error: null,
    });
    const signalsMock = createQueryMock({ data: null, error: { message: 'signals error' } });
    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(memberSubsMock)
        .mockReturnValueOnce(expertsMock)
        .mockReturnValueOnce(signalsMock),
    };

    const result = await fetchSubscriberSignals(supabase as any, 'user-007');

    expect(result.signals).toEqual([]);
    expect(result.hasSubscription).toBe(true);
  });
});

// ── drift-detection ───────────────────────────────────────────────────────────

describe('drift-detection: has_active_subscription_after T+7 邏輯存在於 migration SQL', () => {
  it('最新版 has_active_subscription_after 保有 T+7 mentor 邏輯（INTERVAL 7 days）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260412111243_2c84247d-20fc-4ad1-bee0-6bf4b3ecfb4d.sql'),
      'utf-8',
    );
    expect(src).toContain('has_active_subscription_after');
    expect(src).toContain("INTERVAL '7 days'");
    expect(src).toContain("e.role = 'mentor'");
  });

  it('expert_signals RLS policy 使用 has_active_subscription_after 進行可見性過濾', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260411145628_528d251c-3418-4513-b987-4cc884ceead2.sql'),
      'utf-8',
    );
    expect(src).toContain('has_active_subscription_after');
    expect(src).toContain('expert_signals');
  });
});
