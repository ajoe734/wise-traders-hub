/**
 * Group 1.11 — 安全視圖敏感欄位隔離
 *
 * 測試範圍：
 *   fetchExpertLineChannelsPublic / fetchExpertsPublic /
 *   fetchPaymentProvidersSafe / fetchMemberLineBindingsAnalyst
 *   （src/lib/safeViewAccess.ts）：
 *
 *   驗證四個安全視圖的查詢函數正確使用視圖名稱（非底層資料表），
 *   回傳結果不含敏感欄位。
 *   DB 端視圖定義（CREATE VIEW 明確列舉安全欄位）由 drift-detection
 *   確認 migration SQL 中不含對應敏感欄位名稱。
 *
 *   敏感欄位對照：
 *   expert_line_channels_public  → channel_access_token
 *   experts_public               → user_id / created_by / starting_capital
 *   payment_providers_safe       → config
 *   member_line_bindings_analyst → line_user_id
 *
 * 對應測試路徑：
 *   2.5-1：expert_line_channels_public 不含 channel_access_token
 *   2.5-2：experts_public 不含 user_id / created_by / starting_capital
 *   2.5-3：payment_providers_safe 不含 config
 *   2.5-4：member_line_bindings_analyst 不含 line_user_id
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createQueryMock } from '@/test/mocks/supabase';
import {
  fetchExpertLineChannelsPublic,
  fetchExpertsPublic,
  fetchPaymentProvidersSafe,
  fetchMemberLineBindingsAnalyst,
} from '@/lib/safeViewAccess';

// ── fetchExpertLineChannelsPublic ─────────────────────────────────────────────

describe('fetchExpertLineChannelsPublic（LINE 頻道公開視圖）', () => {
  it('查詢使用 expert_line_channels_public 視圖，回傳結果不含 channel_access_token（2.5-1）', async () => {
    const channelMock = createQueryMock({
      data: [
        {
          id: 'ch-1',
          expert_id: 'exp-1',
          channel_id: 'c-1',
          channel_name: '分析師OA',
          line_oa_id: '@test',
          qr_code_url: null,
          is_active: true,
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ],
      error: null,
    });
    const supabase = { from: vi.fn().mockReturnValue(channelMock) };

    const result = await fetchExpertLineChannelsPublic(supabase as any);

    expect(result.error).toBeNull();
    expect(result.channels).toHaveLength(1);
    expect(supabase.from).toHaveBeenCalledWith('expert_line_channels_public');
    expect(result.channels[0]).not.toHaveProperty('channel_access_token');
  });

  it('DB 查詢失敗 → 回傳 error，channels=[]', async () => {
    const channelMock = createQueryMock({ data: null, error: { message: 'view query error' } });
    const supabase = { from: vi.fn().mockReturnValue(channelMock) };

    const result = await fetchExpertLineChannelsPublic(supabase as any);

    expect(result.error).toBe('view query error');
    expect(result.channels).toEqual([]);
  });
});

// ── fetchExpertsPublic ────────────────────────────────────────────────────────

describe('fetchExpertsPublic（專家公開視圖）', () => {
  it('查詢使用 experts_public 視圖，回傳結果不含 user_id / created_by / starting_capital（2.5-2）', async () => {
    const expertMock = createQueryMock({
      data: [
        {
          id: 'exp-1',
          name: '測試專家',
          slug: 'test-expert',
          role: 'advisor',
          status: 'active',
          bio: null,
          description: null,
          avatar_url: null,
          markets: [],
          style_tags: [],
          created_at: '2026-01-01',
        },
      ],
      error: null,
    });
    const supabase = { from: vi.fn().mockReturnValue(expertMock) };

    const result = await fetchExpertsPublic(supabase as any);

    expect(result.error).toBeNull();
    expect(result.experts).toHaveLength(1);
    expect(supabase.from).toHaveBeenCalledWith('experts_public');
    expect(result.experts[0]).not.toHaveProperty('user_id');
    expect(result.experts[0]).not.toHaveProperty('created_by');
    expect(result.experts[0]).not.toHaveProperty('starting_capital');
  });

  it('DB 查詢失敗 → 回傳 error，experts=[]', async () => {
    const expertMock = createQueryMock({ data: null, error: { message: 'view query error' } });
    const supabase = { from: vi.fn().mockReturnValue(expertMock) };

    const result = await fetchExpertsPublic(supabase as any);

    expect(result.error).toBe('view query error');
    expect(result.experts).toEqual([]);
  });
});

// ── fetchPaymentProvidersSafe ─────────────────────────────────────────────────

describe('fetchPaymentProvidersSafe（金流提供者安全視圖）', () => {
  it('查詢使用 payment_providers_safe 視圖，回傳結果不含 config（2.5-3）', async () => {
    const providerMock = createQueryMock({
      data: [
        {
          id: 'pp-1',
          provider_type: 'acpay',
          display_name: 'ACPay',
          is_active: true,
          is_default: true,
          created_at: '2026-01-01',
        },
      ],
      error: null,
    });
    const supabase = { from: vi.fn().mockReturnValue(providerMock) };

    const result = await fetchPaymentProvidersSafe(supabase as any);

    expect(result.error).toBeNull();
    expect(result.providers).toHaveLength(1);
    expect(supabase.from).toHaveBeenCalledWith('payment_providers_safe');
    expect(result.providers[0]).not.toHaveProperty('config');
  });

  it('DB 查詢失敗 → 回傳 error，providers=[]', async () => {
    const providerMock = createQueryMock({ data: null, error: { message: 'view query error' } });
    const supabase = { from: vi.fn().mockReturnValue(providerMock) };

    const result = await fetchPaymentProvidersSafe(supabase as any);

    expect(result.error).toBe('view query error');
    expect(result.providers).toEqual([]);
  });
});

// ── fetchMemberLineBindingsAnalyst ────────────────────────────────────────────

describe('fetchMemberLineBindingsAnalyst（LINE 綁定分析師視圖）', () => {
  it('查詢使用 member_line_bindings_analyst 視圖，回傳結果不含 line_user_id（2.5-4）', async () => {
    const bindingMock = createQueryMock({
      data: [
        {
          id: 'mlb-1',
          user_id: 'user-1',
          expert_id: 'exp-1',
          display_name: '測試會員',
          is_active: true,
          bound_at: '2026-01-01',
        },
      ],
      error: null,
    });
    const supabase = { from: vi.fn().mockReturnValue(bindingMock) };

    const result = await fetchMemberLineBindingsAnalyst(supabase as any);

    expect(result.error).toBeNull();
    expect(result.bindings).toHaveLength(1);
    expect(supabase.from).toHaveBeenCalledWith('member_line_bindings_analyst');
    expect(result.bindings[0]).not.toHaveProperty('line_user_id');
  });

  it('DB 查詢失敗 → 回傳 error，bindings=[]', async () => {
    const bindingMock = createQueryMock({ data: null, error: { message: 'view query error' } });
    const supabase = { from: vi.fn().mockReturnValue(bindingMock) };

    const result = await fetchMemberLineBindingsAnalyst(supabase as any);

    expect(result.error).toBe('view query error');
    expect(result.bindings).toEqual([]);
  });
});

// ── drift-detection ───────────────────────────────────────────────────────────

describe('drift-detection: 安全視圖 SELECT 明確排除敏感欄位，且以 security_invoker 建立', () => {
  it('expert_line_channels_public SELECT 不含 channel_access_token，以 security_invoker 建立（migration 20260412103442）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260412103442_a718f56d-9680-4078-8e47-6f31059d1dc2.sql'),
      'utf-8',
    );
    expect(src).toContain('expert_line_channels_public');
    expect(src).not.toContain('channel_access_token');
    expect(src).toContain('security_invoker = true');
  });

  it('experts_public SELECT 不含 user_id / created_by / starting_capital，以 security_invoker 建立（migration 20260412103442）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260412103442_a718f56d-9680-4078-8e47-6f31059d1dc2.sql'),
      'utf-8',
    );
    expect(src).toContain('experts_public');
    expect(src).not.toContain('user_id');
    expect(src).not.toContain('created_by');
    expect(src).not.toContain('starting_capital');
    expect(src).toContain('security_invoker = true');
  });

  it('payment_providers_safe SELECT 不含 config，以 security_invoker 建立（migration 20260412111310）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260412111310_5d56d8bf-f076-4095-bdc2-16f24896ad0e.sql'),
      'utf-8',
    );
    expect(src).toContain('payment_providers_safe');
    expect(src).not.toContain('config');
    expect(src).toContain('security_invoker = true');
  });

  it('member_line_bindings_analyst SELECT 不含 line_user_id，以 security_invoker 建立（migration 20260412112041）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260412112041_fe6219f3-502f-4609-8a29-f13bb6d73eb6.sql'),
      'utf-8',
    );
    expect(src).toContain('member_line_bindings_analyst');
    expect(src).not.toContain('line_user_id');
    expect(src).toContain('security_invoker = true');
  });
});

describe('drift-detection: production 頁面使用安全視圖（非底層資料表）', () => {
  it('drift: Account.tsx 查詢 LINE 頻道使用 expert_line_channels_public（防止改用底層 expert_line_channels 表）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/pages/app/Account.tsx'),
      'utf-8',
    );
    expect(src).toContain('expert_line_channels_public');
  });

  it('drift: Checkout.tsx 查詢金流提供者使用 payment_providers_safe（防止改用底層 payment_providers 表）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/pages/Checkout.tsx'),
      'utf-8',
    );
    expect(src).toContain('payment_providers_safe');
  });

  it('drift: Analysts.tsx 查詢 LINE 綁定使用 member_line_bindings_analyst（防止改用底層 member_line_bindings 表）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/pages/company/Analysts.tsx'),
      'utf-8',
    );
    expect(src).toContain('member_line_bindings_analyst');
  });
});
