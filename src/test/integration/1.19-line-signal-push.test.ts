/**
 * Group 1.19 — LINE 訊號推播行為
 *
 * 測試範圍：
 *
 *   A. buildFlexMessage（src/lib/linePushLogic.ts）：
 *      為訊號推播建構 LINE Flex Message 的純函數。
 *        publish + buy：type=flex、altText 含動作標籤與標的、body 含「買進」
 *        takedown：altText 含「訊號已收回」、body 含「⚠️ 訊號已收回」
 *        publish + price_hint：altText 格式含「@ 價格」
 *
 *   B. sendToLine（src/lib/linePushLogic.ts）：
 *      LINE 批次推播函數，可注入 fetchFn 以模擬失敗。
 *        4.6-2：第一批 non-200 → 第二批繼續，totalPushed 只計成功批次
 *        4.6-1：全部成功 → totalPushed 等於目標總數
 *
 *   C. drift-detection：
 *      line-push-signal 主要流程確認（4.6-1 ~ 4.6-3）
 *
 * 對應測試路徑：
 *   4.6-1：3 位綁定會員各收到一則推播（subscribedTargets → signal message）
 *   4.6-2：sendToLine 批次推播局部失敗 → 繼續發送後續批次，不中斷整體流程
 *   4.6-3：無任何綁定會員 → 不推播不報錯（early return, reason=no_bindings）
 *   4.6-4：line_pushed_at 更新時間戳（⚠️ 目前 line-push-signal/index.ts
 *          未實作此欄位更新，為已知生產缺口，待日後在 Edge Function 補上）
 *
 * 注意：line_pushed_at 欄位在本 Edge Function 目前不存在寫入邏輯；
 *       批次推播採 for 迴圈，單批 LINE API 失敗只記 console.error，
 *       迴圈不中斷，其餘批次正常繼續。
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildFlexMessage, sendToLine } from '@/lib/linePushLogic';

// ── buildFlexMessage（LINE Flex Message 建構）─────────────────────────────────

describe('buildFlexMessage（LINE 訊號 Flex Message 建構）', () => {
  it('publish + buy → type=flex、altText 含標的名稱、body 含「買進」（4.6-1）', () => {
    const msg = buildFlexMessage(
      { action: 'buy', instrument: '台積電' },
      'publish',
    ) as any;

    expect(msg.type).toBe('flex');
    expect(msg.altText).toContain('台積電');
    expect(msg.altText).toContain('買進');
    const bodyStr = JSON.stringify(msg.contents);
    expect(bodyStr).toContain('買進');
    expect(bodyStr).toContain('台積電');
  });

  it('takedown → type=flex、altText 含「訊號已收回」、body 含警告文字（4.6-2）', () => {
    const msg = buildFlexMessage(
      { action: 'sell', instrument: '聯發科' },
      'takedown',
    ) as any;

    expect(msg.type).toBe('flex');
    expect(msg.altText).toContain('訊號已收回');
    expect(msg.altText).toContain('聯發科');
    const bodyStr = JSON.stringify(msg.contents);
    expect(bodyStr).toContain('⚠️ 訊號已收回');
    expect(bodyStr).toContain('此訊號已被分析師收回，不再有效。');
  });

  it('publish + price_hint → altText 含「@ 價格」格式（4.6-1 邊界）', () => {
    const msg = buildFlexMessage(
      { action: 'buy', instrument: '鴻海', price_hint: '105.5' },
      'publish',
    ) as any;

    expect(msg.altText).toContain('@ 105.5');
    expect(msg.altText).toContain('買進');
    expect(msg.altText).toContain('鴻海');
  });
});

// ── sendToLine（LINE 批次推播容錯行為）───────────────────────────────────────

describe('sendToLine（LINE 批次推播容錯行為）', () => {
  const mockMessage = { type: 'text', text: 'test' };

  it('第一批 non-200 → 第二批仍繼續，totalPushed 只計成功批次（4.6-2）', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, text: async () => 'Blocked by recipient' };
      }
      return { ok: true, text: async () => '' };
    });

    // 501 targets → batch 0: [0..499] (500), batch 1: [500] (1)
    const targets = Array.from({ length: 501 }, (_, i) => `user-${i}`);
    const result = await sendToLine('token', targets, mockMessage, mockFetch as any);

    expect(mockFetch).toHaveBeenCalledTimes(2); // 兩批都被送出（第一批失敗不中斷迴圈）
    expect(result).toBe(1);                      // 只有第二批（1 人）計入 totalPushed
  });

  it('全部批次成功 → totalPushed 等於目標總數（4.6-1）', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });

    const targets = Array.from({ length: 3 }, (_, i) => `user-${i}`);
    const result = await sendToLine('token', targets, mockMessage, mockFetch as any);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toBe(3);
  });
});

// ── drift-detection: line-push-signal 主要流程 ──────────────────────────────

describe('drift-detection: line-push-signal LINE 訊號推播', () => {
  let src: string;

  beforeAll(() => {
    src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/line-push-signal/index.ts'),
      'utf-8',
    );
  });

  it('從 member_line_bindings 查詢 is_active=true 的有效綁定（4.6-1）', () => {
    expect(src).toContain('member_line_bindings');
    expect(src).toContain("'is_active', true");
  });

  it('從 member_subscriptions 以 status=active 過濾有效訂閱（4.6-1）', () => {
    expect(src).toContain('member_subscriptions');
    expect(src).toContain("'status', 'active'");
  });

  it('從 expert_plans 取得該專家所有方案 id 用於訂閱比對（4.6-1）', () => {
    expect(src).toContain('expert_plans');
    expect(src).toContain('expert_id');
  });

  it('無有效綁定時 early return，回傳 reason: no_bindings；有綁定但無有效訂閱回傳 no_active_subscribers；無 LINE channel 回傳 no_channel（4.6-3）', () => {
    expect(src).toContain('no_bindings');
    expect(src).toContain('no_active_subscribers');
    expect(src).toContain('no_channel');
    expect(src).toContain('pushed: false');
    expect(src).toContain('subscribedTargets');
    expect(src).toContain('canceledTargets');
  });

  it('將 subscribedTargets 推播完整訊號 Flex Message（4.6-1）', () => {
    expect(src).toContain('subscribedTargets');
    expect(src).toContain('buildFlexMessage');
  });

  it('將 canceledTargets 推播 buildPromoMessage 推廣訊息（4.6-1 promo path）', () => {
    expect(src).toContain('canceledTargets');
    expect(src).toContain('buildPromoMessage');
  });

  it('sendToLine 批次迴圈單批失敗只記 error 不中斷後續批次（4.6-2）', () => {
    // sendToLine 以 for 迴圈逐批送出；錯誤分支僅 console.error，
    // 不 throw 也不 return，迴圈繼續執行確保其他批次正常發出。
    expect(src).toContain('sendToLine');
    expect(src).toContain('console.error');
    expect(src).toContain('totalPushed += batch.length');
  });

  it('推播完成後回傳 pushed/count/subscribed/canceled 計數（4.6-1）', () => {
    expect(src).toContain('pushed: true');
    expect(src).toContain('count: totalPushed');
    expect(src).toContain('subscribed: subscribedTargets.length');
    expect(src).toContain('canceled: canceledTargets.length');
  });
});
