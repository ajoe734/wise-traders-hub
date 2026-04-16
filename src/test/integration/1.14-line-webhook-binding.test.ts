/**
 * Group 1.14 — LINE Webhook 身份驗證與綁定碼
 *
 * 測試範圍：
 *
 *   A. X-Line-Signature 驗證（lineWebhookVerifySignature，src/lib/paymentVerify.ts）：
 *      驗證 HMAC-SHA256 Base64 計算正確，已於 Group 1.4 涵蓋演算法本身；
 *      此處補充 null signature 拒絕與正確/錯誤 channelSecret 兩種情境，
 *      以及 drift test 確認 line-webhook/index.ts 確實呼叫此函數。
 *
 *   B. 綁定碼處理邏輯（processLineBindingCode，src/lib/lineBindingProcessor.ts）：
 *      覆蓋五種情境：
 *        3.5-1：正確碼 + 正確 OA → status=success
 *        3.5-2：正確碼但錯誤 OA（ISSUE-009 跨 OA 偵測）→ status=wrong_oa
 *        3.5-3：已過期綁定碼（DB 查無）→ status=invalid_or_expired
 *        3.5-4：不存在的綁定碼（DB 查無）→ status=invalid_or_expired
 *        3.5-5：已使用綁定碼 used=true（DB 查無）→ status=invalid_or_expired
 *
 * 對應測試路徑：
 *   3.4-1 ~ 3.4-3：X-Line-Signature 驗證
 *   3.5-1 ~ 3.5-5：綁定碼有效性驗證
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createQueryMock } from '@/test/mocks/supabase';
import { lineWebhookVerifySignature } from '@/lib/paymentVerify';
import { processLineBindingCode } from '@/lib/lineBindingProcessor';

const EXPERT_ID = 'expert-uuid-1';
const OTHER_EXPERT_ID = 'expert-uuid-2';
const USER_ID = 'user-uuid-1';
const LINE_USER_ID = 'Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const CHANNEL_SECRET = 'test-channel-secret-32bytes!!!!!';
const VALID_CODE = 'ABC123';
const NOW = new Date('2026-04-15T10:00:00Z');
const FUTURE_EXPIRES = '2026-04-15T11:00:00Z'; // 有效（在 NOW 之後）

// helper：建立多資料表 supabase mock（依 from() 呼叫順序回傳不同結果）
function makeSupabase(mocksByCall: ReturnType<typeof createQueryMock>[]) {
  let callIndex = 0;
  return {
    from: vi.fn().mockImplementation(() => {
      const mock = mocksByCall[Math.min(callIndex, mocksByCall.length - 1)];
      callIndex++;
      return mock;
    }),
  };
}

// ── X-Line-Signature 驗證（lineWebhookVerifySignature）────────────────────────

describe('lineWebhookVerifySignature（LINE webhook 身份驗證）', () => {
  it('signature 為 null → 直接回傳 false，不計算 HMAC（3.4-2：缺少 header）', async () => {
    const result = await lineWebhookVerifySignature('{"events":[]}', null, CHANNEL_SECRET);
    expect(result).toBe(false);
  });

  it('正確 channelSecret 對應正確 signature → 驗證通過（3.4-1）', async () => {
    // 先計算出正確 signature，再驗證
    const body = '{"events":[]}';
    // 以 Node.js crypto 計算參考值
    const { createHmac } = await import('crypto');
    const expected = createHmac('sha256', CHANNEL_SECRET).update(body).digest('base64');

    const result = await lineWebhookVerifySignature(body, expected, CHANNEL_SECRET);
    expect(result).toBe(true);
  });

  it('偽造 signature（錯誤值）→ 驗證失敗（3.4-3）', async () => {
    const result = await lineWebhookVerifySignature(
      '{"events":[]}',
      'invalid-fake-signature-base64==',
      CHANNEL_SECRET,
    );
    expect(result).toBe(false);
  });
});

// ── processLineBindingCode（綁定碼業務邏輯）──────────────────────────────────

describe('processLineBindingCode（LINE 綁定碼驗證與綁定）', () => {
  it('正確綁定碼 + 正確 OA + 新綁定（無既有記錄）→ status=success，建立 member_line_bindings（3.5-1）', async () => {
    const bindingCodeRow = {
      id: 'code-id-1',
      code: VALID_CODE,
      expert_id: EXPERT_ID,
      user_id: USER_ID,
      used: false,
      expires_at: FUTURE_EXPIRES,
    };

    const supabase = makeSupabase([
      // Step 1：anyCode 查詢 → 找到，且 expert_id 相同（正確 OA）
      createQueryMock({ data: { expert_id: EXPERT_ID }, error: null }),
      // Step 2：bindingCode 查詢 → 找到有效碼
      createQueryMock({ data: bindingCodeRow, error: null }),
      // Step 3：existingBinding 查詢 → 無既有綁定
      createQueryMock({ data: null, error: null }),
      // Step 3：insert member_line_bindings → 成功
      createQueryMock({ data: [{ id: 'binding-1' }], error: null }),
      // Step 4：update line_binding_codes used=true → 成功
      createQueryMock({ data: null, error: null }),
    ]);

    const result = await processLineBindingCode(
      supabase as any, VALID_CODE, EXPERT_ID, LINE_USER_ID, '測試用戶', NOW,
    );

    expect(result.status).toBe('success');
    expect(result.error).toBeNull();
  });

  it('正確綁定碼 + 正確 OA + 既有綁定 → status=success，更新 member_line_bindings（3.5-1 update path）', async () => {
    const bindingCodeRow = {
      id: 'code-id-1',
      code: VALID_CODE,
      expert_id: EXPERT_ID,
      user_id: USER_ID,
      used: false,
      expires_at: FUTURE_EXPIRES,
    };

    const supabase = makeSupabase([
      // Step 1：anyCode → 找到，expert_id 相同
      createQueryMock({ data: { expert_id: EXPERT_ID }, error: null }),
      // Step 2：bindingCode → 有效
      createQueryMock({ data: bindingCodeRow, error: null }),
      // Step 3：existingBinding → 已有記錄
      createQueryMock({ data: { id: 'existing-binding-1' }, error: null }),
      // Step 3：update member_line_bindings → 成功
      createQueryMock({ data: null, error: null }),
      // Step 4：update line_binding_codes used=true
      createQueryMock({ data: null, error: null }),
    ]);

    const result = await processLineBindingCode(
      supabase as any, VALID_CODE, EXPERT_ID, LINE_USER_ID, '測試用戶', NOW,
    );

    expect(result.status).toBe('success');
    expect(result.error).toBeNull();
  });

  it('綁定碼屬於其他 expert，傳送到錯誤 OA → status=wrong_oa（3.5-2）', async () => {
    const supabase = makeSupabase([
      // Step 1：anyCode → 找到，但 expert_id 是另一個 expert（跨 OA）
      createQueryMock({ data: { expert_id: OTHER_EXPERT_ID }, error: null }),
    ]);

    const result = await processLineBindingCode(
      supabase as any, VALID_CODE, EXPERT_ID, LINE_USER_ID, null, NOW,
    );

    expect(result.status).toBe('wrong_oa');
    expect(result.error).toBe('此驗證碼不屬於本頻道');
  });

  it('綁定碼已過期（DB 查不到：expires_at < now）→ status=invalid_or_expired（3.5-3）', async () => {
    const supabase = makeSupabase([
      // Step 1：anyCode → null（過期碼在 gt expires_at 過濾後不存在）
      createQueryMock({ data: null, error: null }),
      // Step 2：bindingCode → null（同上過濾）
      createQueryMock({ data: null, error: null }),
    ]);

    const result = await processLineBindingCode(
      supabase as any, VALID_CODE, EXPERT_ID, LINE_USER_ID, null, NOW,
    );

    expect(result.status).toBe('invalid_or_expired');
    expect(result.error).toBe('驗證碼無效或已過期');
  });

  it('不存在的綁定碼 → status=invalid_or_expired（3.5-4）', async () => {
    const supabase = makeSupabase([
      // Step 1：anyCode → null（碼不存在）
      createQueryMock({ data: null, error: null }),
      // Step 2：bindingCode → null
      createQueryMock({ data: null, error: null }),
    ]);

    const result = await processLineBindingCode(
      supabase as any, 'ZZZZZZ', EXPERT_ID, LINE_USER_ID, null, NOW,
    );

    expect(result.status).toBe('invalid_or_expired');
  });

  it('綁定碼 used=true（DB 查不到：eq used=false 過濾）→ status=invalid_or_expired（3.5-5）', async () => {
    const supabase = makeSupabase([
      // Step 1：anyCode → null（used=false 條件排除了已使用的碼）
      createQueryMock({ data: null, error: null }),
      // Step 2：bindingCode → null（同上）
      createQueryMock({ data: null, error: null }),
    ]);

    const result = await processLineBindingCode(
      supabase as any, VALID_CODE, EXPERT_ID, LINE_USER_ID, null, NOW,
    );

    expect(result.status).toBe('invalid_or_expired');
  });

  it('member_line_bindings insert DB 錯誤（新綁定）→ status=db_error，區辨系統失敗與業務失敗', async () => {
    const bindingCodeRow = {
      id: 'code-id-1',
      code: VALID_CODE,
      expert_id: EXPERT_ID,
      user_id: USER_ID,
      used: false,
      expires_at: FUTURE_EXPIRES,
    };

    const supabase = makeSupabase([
      // Step 1：anyCode → 正確 expert
      createQueryMock({ data: { expert_id: EXPERT_ID }, error: null }),
      // Step 2：bindingCode → 有效
      createQueryMock({ data: bindingCodeRow, error: null }),
      // Step 3：existingBinding → 無既有
      createQueryMock({ data: null, error: null }),
      // Step 3：insert 失敗
      createQueryMock({ data: null, error: { message: 'DB insert error' } }),
    ]);

    const result = await processLineBindingCode(
      supabase as any, VALID_CODE, EXPERT_ID, LINE_USER_ID, null, NOW,
    );

    expect(result.status).toBe('db_error');
    expect(result.error).toBe('DB insert error');
  });

  it('member_line_bindings update DB 錯誤（既有綁定更新）→ status=db_error', async () => {
    const bindingCodeRow = {
      id: 'code-id-1',
      code: VALID_CODE,
      expert_id: EXPERT_ID,
      user_id: USER_ID,
      used: false,
      expires_at: FUTURE_EXPIRES,
    };

    const supabase = makeSupabase([
      // Step 1：anyCode → 正確 expert
      createQueryMock({ data: { expert_id: EXPERT_ID }, error: null }),
      // Step 2：bindingCode → 有效
      createQueryMock({ data: bindingCodeRow, error: null }),
      // Step 3：existingBinding → 已有記錄
      createQueryMock({ data: { id: 'existing-binding-1' }, error: null }),
      // Step 3：update 失敗
      createQueryMock({ data: null, error: { message: 'DB update error' } }),
    ]);

    const result = await processLineBindingCode(
      supabase as any, VALID_CODE, EXPERT_ID, LINE_USER_ID, null, NOW,
    );

    expect(result.status).toBe('db_error');
    expect(result.error).toBe('DB update error');
  });

  it('綁定成功但 used=true 標記失敗 → status=mark_used_failed（碼仍可被重用的高風險路徑）', async () => {
    const bindingCodeRow = {
      id: 'code-id-1',
      code: VALID_CODE,
      expert_id: EXPERT_ID,
      user_id: USER_ID,
      used: false,
      expires_at: FUTURE_EXPIRES,
    };

    const supabase = makeSupabase([
      // Step 1：anyCode → 正確 expert
      createQueryMock({ data: { expert_id: EXPERT_ID }, error: null }),
      // Step 2：bindingCode → 有效
      createQueryMock({ data: bindingCodeRow, error: null }),
      // Step 3：existingBinding → 無既有
      createQueryMock({ data: null, error: null }),
      // Step 3：insert 成功
      createQueryMock({ data: [{ id: 'binding-1' }], error: null }),
      // Step 4：mark used 失敗
      createQueryMock({ data: null, error: { message: 'mark used failed' } }),
    ]);

    const result = await processLineBindingCode(
      supabase as any, VALID_CODE, EXPERT_ID, LINE_USER_ID, null, NOW,
    );

    expect(result.status).toBe('mark_used_failed');
    expect(result.error).toBe('mark used failed');
  });
});

// ── drift-detection ───────────────────────────────────────────────────────────

describe('drift-detection: line-webhook 使用 lineWebhookVerifySignature', () => {
  it('line-webhook/index.ts import lineWebhookVerifySignature from _shared/paymentVerify.ts（3.4-1）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/line-webhook/index.ts'),
      'utf-8',
    );
    expect(src).toContain('lineWebhookVerifySignature');
    expect(src).toContain('paymentVerify');
  });

  it('line-webhook/index.ts 在處理事件前呼叫 verifySignature，signature 失敗回傳 401（3.4-3）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/line-webhook/index.ts'),
      'utf-8',
    );
    expect(src).toContain('verifySignature');
    expect(src).toContain('401');
  });

  it('line-webhook/index.ts 查詢 line_binding_codes 使用 used=false + gt expires_at 過濾（3.5-3/3.5-5）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/line-webhook/index.ts'),
      'utf-8',
    );
    expect(src).toContain('line_binding_codes');
    expect(src).toContain("eq('used', false)");
    expect(src).toContain("gt('expires_at'");
  });

  it('line-webhook/index.ts 先跨 expert 查詢碼存在性（ISSUE-009 wrong OA 防護）（3.5-2）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/line-webhook/index.ts'),
      'utf-8',
    );
    // anyCode 查詢不含 eq('expert_id') 過濾，以偵測跨 OA
    expect(src).toContain('anyCode');
    expect(src).toContain('expert_id !== expertId');
  });
});
