/**
 * Group 1.9 — 分析師資料隔離 RLS
 *
 * 測試範圍：
 *   fetchAnalystSignals / fetchAnalystTradeRecords /
 *   fetchAnalystSubscribers / fetchAnalystTemplates
 *   （src/lib/analystDataAccess.ts）：
 *
 *   驗證 client 端查詢函數正確以 expert_id 過濾資料。
 *   DB 端 RLS（expert_id IN (SELECT id FROM experts WHERE user_id = auth.uid())）
 *   在 Vitest Mock 層無法直接測試，由 drift-detection 確認 migration 中政策存在。
 *
 *   隔離語意：
 *   - 分析師 A 查自己的資料 → mock 回傳資料，驗證 eq('expert_id', expertA) 被呼叫
 *   - 分析師 A 查分析師 B（不同 expertId）→ mock 模擬 RLS 空集，驗證 signals=[]
 *
 * 對應測試路徑：
 *   2.3-1：分析師 A 查自己的 expert_signals → 回傳資料
 *   2.3-2：分析師 A 查分析師 B 的 expert_signals → 空集（RLS mock）
 *   2.3-3：分析師 A 查自己的 trade_records → 回傳資料
 *   2.3-4：分析師 A 查分析師 B 的 trade_records → 空集（RLS mock）
 *   2.3-5：分析師 A 查自己的訂閱者列表 → 回傳資料
 *   2.3-6：分析師 A 查分析師 B 的訂閱者列表 → 空集（RLS mock）
 *   2.3-7：分析師 A 查自己的範本 → 回傳資料
 *   2.3-8：分析師 A 查分析師 B 的範本 → 空集（RLS mock）
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createQueryMock } from '@/test/mocks/supabase';
import {
  fetchAnalystSignals,
  fetchAnalystTradeRecords,
  fetchAnalystSubscribers,
  fetchAnalystTemplates,
} from '@/lib/analystDataAccess';

// ── fetchAnalystSignals ───────────────────────────────────────────────────────

describe('fetchAnalystSignals（分析師訊號查詢）', () => {
  it('分析師 A 查自己的 expert_signals → eq(expert_id, expertA)，回傳資料（2.3-1）', async () => {
    const signalsMock = createQueryMock({
      data: [{ id: 'sig-1', instrument: '2330', action: 'buy', expert_id: 'expert-a' }],
      error: null,
    });
    const supabase = { from: vi.fn().mockReturnValue(signalsMock) };

    const result = await fetchAnalystSignals(supabase as any, 'expert-a');

    expect(result.error).toBeNull();
    expect(result.signals).toHaveLength(1);
    expect(signalsMock.eq).toHaveBeenCalledWith('expert_id', 'expert-a');
  });

  it('分析師 A 查分析師 B → DB 端 RLS 過濾回空集（2.3-2）', async () => {
    const signalsMock = createQueryMock({ data: [], error: null }); // RLS 返回空
    const supabase = { from: vi.fn().mockReturnValue(signalsMock) };

    const result = await fetchAnalystSignals(supabase as any, 'expert-b');

    expect(result.signals).toEqual([]);
    // 確認 eq 被呼叫為 expert-b（查詢本身正確，RLS 在 DB 層過濾）
    expect(signalsMock.eq).toHaveBeenCalledWith('expert_id', 'expert-b');
  });

  it('DB 查詢失敗 → 回傳 error，signals=[]', async () => {
    const signalsMock = createQueryMock({ data: null, error: { message: 'signals error' } });
    const supabase = { from: vi.fn().mockReturnValue(signalsMock) };

    const result = await fetchAnalystSignals(supabase as any, 'expert-a');

    expect(result.error).toBe('signals error');
    expect(result.signals).toEqual([]);
  });
});

// ── fetchAnalystTradeRecords ──────────────────────────────────────────────────

describe('fetchAnalystTradeRecords（分析師交易紀錄查詢）', () => {
  it('分析師 A 查自己的 trade_records → eq(expert_id, expertA)，回傳資料（2.3-3）', async () => {
    const recordsMock = createQueryMock({
      data: [{ id: 'tr-1', instrument: '2330', status: 'open', expert_id: 'expert-a' }],
      error: null,
    });
    const supabase = { from: vi.fn().mockReturnValue(recordsMock) };

    const result = await fetchAnalystTradeRecords(supabase as any, 'expert-a');

    expect(result.error).toBeNull();
    expect(result.records).toHaveLength(1);
    expect(recordsMock.eq).toHaveBeenCalledWith('expert_id', 'expert-a');
  });

  it('分析師 A 查分析師 B → DB 端 RLS 過濾回空集（2.3-4）', async () => {
    const recordsMock = createQueryMock({ data: [], error: null });
    const supabase = { from: vi.fn().mockReturnValue(recordsMock) };

    const result = await fetchAnalystTradeRecords(supabase as any, 'expert-b');

    expect(result.records).toEqual([]);
    expect(recordsMock.eq).toHaveBeenCalledWith('expert_id', 'expert-b');
  });

  it('DB 查詢失敗 → 回傳 error，records=[]', async () => {
    const recordsMock = createQueryMock({ data: null, error: { message: 'trade records error' } });
    const supabase = { from: vi.fn().mockReturnValue(recordsMock) };

    const result = await fetchAnalystTradeRecords(supabase as any, 'expert-a');

    expect(result.error).toBe('trade records error');
    expect(result.records).toEqual([]);
  });
});

// ── fetchAnalystSubscribers ───────────────────────────────────────────────────

describe('fetchAnalystSubscribers（分析師訂閱者列表）', () => {
  it('分析師 A 查自己的訂閱者 → 先查 expert_plans，再查 member_subscriptions（2.3-5）', async () => {
    const plansMock = createQueryMock({
      data: [{ id: 'plan-a1' }, { id: 'plan-a2' }],
      error: null,
    });
    const subsMock = createQueryMock({
      data: [
        { id: 'sub-1', user_id: 'user-x', plan_id: 'plan-a1', status: 'active' },
        { id: 'sub-2', user_id: 'user-y', plan_id: 'plan-a2', status: 'active' },
      ],
      error: null,
    });
    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(plansMock)  // expert_plans
        .mockReturnValueOnce(subsMock),  // member_subscriptions
    };

    const result = await fetchAnalystSubscribers(supabase as any, 'expert-a');

    expect(result.error).toBeNull();
    expect(result.subscriptions).toHaveLength(2);
    expect(plansMock.eq).toHaveBeenCalledWith('expert_id', 'expert-a');
    expect(subsMock.in).toHaveBeenCalledWith('plan_id', ['plan-a1', 'plan-a2']);
  });

  it('分析師 A 查分析師 B → expert_plans 為空，不查 member_subscriptions（2.3-6）', async () => {
    const plansMock = createQueryMock({ data: [], error: null }); // RLS 過濾，B 的 plan 對 A 不可見
    const supabase = { from: vi.fn().mockReturnValue(plansMock) };

    const result = await fetchAnalystSubscribers(supabase as any, 'expert-b');

    expect(result.subscriptions).toEqual([]);
    expect(supabase.from).toHaveBeenCalledTimes(1); // 只查 expert_plans，不繼續查 member_subscriptions
  });

  it('expert_plans 查詢失敗 → 回傳 error，不查 member_subscriptions', async () => {
    const plansMock = createQueryMock({ data: null, error: { message: 'plans error' } });
    const supabase = { from: vi.fn().mockReturnValue(plansMock) };

    const result = await fetchAnalystSubscribers(supabase as any, 'expert-a');

    expect(result.error).toBe('plans error');
    expect(result.subscriptions).toEqual([]);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('expert_plans 回傳 data=null（無方案）→ planIds 為空，不查 member_subscriptions', async () => {
    const plansMock = createQueryMock({ data: null, error: null });
    const supabase = { from: vi.fn().mockReturnValue(plansMock) };

    const result = await fetchAnalystSubscribers(supabase as any, 'expert-a');

    expect(result.subscriptions).toEqual([]);
    expect(result.error).toBeNull();
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('member_subscriptions 查詢失敗 → 回傳 error，subscriptions=[]', async () => {
    const plansMock = createQueryMock({ data: [{ id: 'plan-a1' }], error: null });
    const subsMock = createQueryMock({ data: null, error: { message: 'subs error' } });
    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(plansMock)
        .mockReturnValueOnce(subsMock),
    };

    const result = await fetchAnalystSubscribers(supabase as any, 'expert-a');

    expect(result.error).toBe('subs error');
    expect(result.subscriptions).toEqual([]);
  });
});

// ── fetchAnalystTemplates ─────────────────────────────────────────────────────

describe('fetchAnalystTemplates（分析師範本查詢）', () => {
  it('分析師 A 查自己的範本 → 兩張表均以 eq(expert_id, expertA) 過濾（2.3-7）', async () => {
    const signalTplMock = createQueryMock({
      data: [{ id: 'st-1', instrument: '2330', action: 'buy' }],
      error: null,
    });
    const reasonTplMock = createQueryMock({
      data: [{ id: 'rt-1', content: '基本面強勁' }],
      error: null,
    });
    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(signalTplMock)  // expert_signal_templates
        .mockReturnValueOnce(reasonTplMock), // expert_reason_templates
    };

    const result = await fetchAnalystTemplates(supabase as any, 'expert-a');

    expect(result.error).toBeNull();
    expect(result.signalTemplates).toHaveLength(1);
    expect(result.reasonTemplates).toHaveLength(1);
    expect(signalTplMock.eq).toHaveBeenCalledWith('expert_id', 'expert-a');
    expect(reasonTplMock.eq).toHaveBeenCalledWith('expert_id', 'expert-a');
  });

  it('分析師 A 查分析師 B 的範本 → DB 端 RLS 過濾回空集（2.3-8）', async () => {
    const signalTplMock = createQueryMock({ data: [], error: null });
    const reasonTplMock = createQueryMock({ data: [], error: null });
    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(signalTplMock)
        .mockReturnValueOnce(reasonTplMock),
    };

    const result = await fetchAnalystTemplates(supabase as any, 'expert-b');

    expect(result.signalTemplates).toEqual([]);
    expect(result.reasonTemplates).toEqual([]);
    expect(signalTplMock.eq).toHaveBeenCalledWith('expert_id', 'expert-b');
  });

  it('expert_signal_templates 查詢失敗 → 回傳 error，不查 reason templates', async () => {
    const signalTplMock = createQueryMock({ data: null, error: { message: 'sig tpl error' } });
    const supabase = { from: vi.fn().mockReturnValue(signalTplMock) };

    const result = await fetchAnalystTemplates(supabase as any, 'expert-a');

    expect(result.error).toBe('sig tpl error');
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('expert_reason_templates 查詢失敗 → 回傳 error、signalTemplates 有值（reasonErr 分支）', async () => {
    const signalTplMock = createQueryMock({ data: [{ id: 'st-1' }], error: null });
    const reasonTplMock = createQueryMock({ data: null, error: { message: 'reason tpl error' } });
    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(signalTplMock)
        .mockReturnValueOnce(reasonTplMock),
    };

    const result = await fetchAnalystTemplates(supabase as any, 'expert-a');

    expect(result.error).toBe('reason tpl error');
    expect(result.signalTemplates).toHaveLength(1);
    expect(result.reasonTemplates).toEqual([]);
  });
});

// ── drift-detection ───────────────────────────────────────────────────────────

describe('drift-detection: 分析師資料隔離 RLS 政策存在於 migration SQL', () => {
  it('expert_signals 有 analyst 隔離政策（expert_id IN experts.user_id）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260411145628_528d251c-3418-4513-b987-4cc884ceead2.sql'),
      'utf-8',
    );
    expect(src).toContain('Analysts can view own signals');
    expect(src).toContain('user_id = auth.uid()');
  });

  it('expert_signal_templates 有 analyst 隔離政策', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260304091949_818a67ca-d688-4515-ac07-5006e4daac12.sql'),
      'utf-8',
    );
    expect(src).toContain('expert_signal_templates');
    expect(src).toContain('user_id = auth.uid()');
  });

  it('expert_reason_templates 有 analyst 隔離政策', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260304091202_a7152865-5638-44ff-8010-b8c714d0f72e.sql'),
      'utf-8',
    );
    expect(src).toContain('expert_reason_templates');
    expect(src).toContain('user_id = auth.uid()');
  });

  it('member_subscriptions 有 analyst 可查自己訂閱者的政策（plan_id via expert_plans）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260225013857_f8ddcb3b-2bdc-4b53-a51d-92da134bbf8f.sql'),
      'utf-8',
    );
    expect(src).toContain('Analysts can view own plan subscriptions');
    expect(src).toContain('expert_plans');
  });

  it('drift: Subscribers.tsx 使用 fetchAnalystSubscribers（防止 expert_plans→member_subscriptions 過濾被繞過）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/pages/admin/Subscribers.tsx'),
      'utf-8',
    );
    expect(src).toContain('fetchAnalystSubscribers');
    expect(src).toContain('@/lib/analystDataAccess');
  });

  it('drift: admin/Signals.tsx 使用 fetchAnalystSignals（防止 expert_signals expert_id 過濾被繞過）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/pages/admin/Signals.tsx'),
      'utf-8',
    );
    expect(src).toContain('fetchAnalystSignals');
    expect(src).toContain('@/lib/analystDataAccess');
  });
});
