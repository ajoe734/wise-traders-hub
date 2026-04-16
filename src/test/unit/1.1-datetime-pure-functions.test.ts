/**
 * Group 1.1 — 純函數日期/時間計算
 *
 * 對應測試路徑（核心邏輯分類 STEP_3）：
 *   4.4-1 ~ 4.4-6  發布時間窗口  src/lib/publishingWindow.ts
 *   1.5-2 ~ 1.5-4  退款月數計算  src/lib/refundCalc.ts（從 Account.tsx 提取）
 *
 * 所有測試皆為純函數，無外部依賴，使用 vi.setSystemTime() 固定時間。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isPublishingWindowOpen } from '@/lib/publishingWindow';
import { calcRefund, type RefundInput } from '@/lib/refundCalc';

// ---------------------------------------------------------------------------
// 4.4 發布時間窗口
// ---------------------------------------------------------------------------

describe('4.4 發布時間窗口 — isPublishingWindowOpen()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // UTC 時間換算說明：台灣 UTC+8，因此 UTC 06:00 = TW 14:00
  it('4.4-1：週三 14:00 TW → 應允許發布', () => {
    // 2024-01-10 (週三) UTC 06:00:00 = TW 14:00:00
    vi.setSystemTime(new Date('2024-01-10T06:00:00Z'));
    const result = isPublishingWindowOpen();
    expect(result.open).toBe(true);
  });

  it('4.4-2：週六 10:00 TW → 應阻擋（週末）', () => {
    // 2024-01-13 (週六) UTC 02:00:00 = TW 10:00:00
    vi.setSystemTime(new Date('2024-01-13T02:00:00Z'));
    const result = isPublishingWindowOpen();
    expect(result.open).toBe(false);
    expect(result.reason).toMatch(/週末/);
  });

  it('4.4-3：週五 19:59 TW（邊界前 1 分鐘）→ 應允許發布', () => {
    // 2024-01-12 (週五) UTC 11:59:00 = TW 19:59:00
    vi.setSystemTime(new Date('2024-01-12T11:59:00Z'));
    const result = isPublishingWindowOpen();
    expect(result.open).toBe(true);
  });

  it('4.4-4：週五 20:00 TW（精確邊界）→ 應阻擋（hhmm >= 2000）', () => {
    // 2024-01-12 (週五) UTC 12:00:00 = TW 20:00:00
    // 條件是 hhmm >= 2000，所以 20:00 整應為關閉
    vi.setSystemTime(new Date('2024-01-12T12:00:00Z'));
    const result = isPublishingWindowOpen();
    expect(result.open).toBe(false);
    expect(result.reason).toMatch(/週五 20:00/);
  });

  it('4.4-4b：週五 20:01 TW（邊界後 1 分鐘）→ 應阻擋', () => {
    // 2024-01-12 (週五) UTC 12:01:00 = TW 20:01:00
    vi.setSystemTime(new Date('2024-01-12T12:01:00Z'));
    const result = isPublishingWindowOpen();
    expect(result.open).toBe(false);
    expect(result.reason).toMatch(/週五 20:00/);
  });

  it('4.4-5：週一 07:59 TW（開放前 1 分鐘）→ 應阻擋', () => {
    // 2024-01-07 (週日) UTC 23:59:00 = 2024-01-08 (週一) TW 07:59:00
    vi.setSystemTime(new Date('2024-01-07T23:59:00Z'));
    const result = isPublishingWindowOpen();
    expect(result.open).toBe(false);
    expect(result.reason).toMatch(/週一 08:00/);
  });

  it('4.4-6：週一 08:00 TW（剛好開放）→ 應允許發布', () => {
    // 2024-01-08 (週一) UTC 00:00:00 = TW 08:00:00
    vi.setSystemTime(new Date('2024-01-08T00:00:00Z'));
    const result = isPublishingWindowOpen();
    expect(result.open).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1.5 退款月數計算（年繳取消）
// ---------------------------------------------------------------------------

describe('1.5 退款計算 — calcRefund()', () => {
  // 年繳方案基礎 fixture：12,000 元/年 → 月均 1,000
  const yearlyPlan: RefundInput['plan'] = {
    price_monthly: 1100, // 月繳價（與退款計算無直接關係）
    price_yearly: 12000, // 年繳價 → monthlyPrice = floor(12000/12) = 1000
  };

  // 訂閱開始時間（2024-01-15，超過 180 天前的某訂閱起始）
  const startedAt = '2024-01-15T00:00:00.000Z';
  // 到期日（2025-01-15，確保超過 180 天）
  const expiresAt = '2025-01-15T00:00:00.000Z';

  it('1.5-2：年繳取消 — 已使用 N 月，正確計算退款月數', () => {
    // now = 2024-03-15 → nextMonthStart = 2024-04-01
    // expiresAt = 2025-01-15
    // differenceInMonths(2025-01-15, 2024-04-01) = 9
    // refundAmount = 1000 × 9 = 9000
    const sub: RefundInput = { started_at: startedAt, expires_at: expiresAt, plan: yearlyPlan };
    const now = new Date('2024-03-15T00:00:00.000Z');
    const result = calcRefund(sub, now);
    expect(result.isYearly).toBe(true);
    expect(result.remainingMonths).toBe(9);
    expect(result.refundAmount).toBe(9000);
    expect(result.monthlyPrice).toBe(1000);
    expect(result.originalAmount).toBe(12000);
  });

  it('1.5-3：年繳取消 — 月底邊界，月份差異正確（不因月份長度漂移）', () => {
    // 比較 now=1月31日 vs now=2月1日，退款月數應差 1 個月
    const sub: RefundInput = { started_at: startedAt, expires_at: expiresAt, plan: yearlyPlan };

    // now = 2024-01-31 → nextMonthStart = 2024-02-01
    // differenceInMonths(2025-01-15, 2024-02-01) = 11 → refund = 11000
    const result1 = calcRefund(sub, new Date('2024-01-31T00:00:00.000Z'));
    expect(result1.remainingMonths).toBe(11);

    // now = 2024-02-01 → nextMonthStart = 2024-03-01
    // differenceInMonths(2025-01-15, 2024-03-01) = 10 → refund = 10000
    const result2 = calcRefund(sub, new Date('2024-02-01T00:00:00.000Z'));
    expect(result2.remainingMonths).toBe(10);

    // 月底 vs 月初整整差 1 個月（不因 1 月 31 天 / 2 月 28 天不同而多算或少算）
    expect(result1.remainingMonths - result2.remainingMonths).toBe(1);
  });

  it('1.5-4：閏年 2 月底（2024-02-29）→ 退款月數計算正確，不產生整數溢位', () => {
    // 閏年特殊日期：2024-02-29 存在
    // now = 2024-02-29 → nextMonthStart = 2024-03-01
    // expiresAt = 2024-08-29（訂閱僅 6 個月，先重設到期日確保 isYearly 判定）
    // 使用原本的 expiresAt 2025-01-15
    // differenceInMonths(2025-01-15, 2024-03-01) = 10 → refund = 10000
    const sub: RefundInput = { started_at: startedAt, expires_at: expiresAt, plan: yearlyPlan };
    const now = new Date('2024-02-29T00:00:00.000Z'); // 閏年 2 月底
    const result = calcRefund(sub, now);
    expect(result.isYearly).toBe(true);
    expect(result.remainingMonths).toBe(10);
    expect(result.refundAmount).toBe(10000);
    // 確認 monthlyPrice 使用 floor 避免小數
    expect(Number.isInteger(result.monthlyPrice)).toBe(true);
    expect(Number.isInteger(result.refundAmount)).toBe(true);
  });

  it('Math.floor 驗證：不能整除時取下整，非 round/ceil', () => {
    // price_yearly: 11000 → 11000 / 12 = 916.666...
    // Math.floor = 916，Math.round = 917，Math.ceil = 917
    // refundAmount = monthlyPrice × remainingMonths 必須用 floor 的 916
    const sub: RefundInput = {
      started_at: startedAt,
      expires_at: expiresAt,
      plan: { price_monthly: 1000, price_yearly: 11000 },
    };
    const result = calcRefund(sub, new Date('2024-03-15T00:00:00.000Z'));
    // 9 個月 × 916 = 8244（若用 round/ceil 會是 9 × 917 = 8253）
    expect(result.monthlyPrice).toBe(916);
    expect(result.refundAmount).toBe(8244);
  });

  it('邊界：月繳方案 → refundAmount 固定為 0', () => {
    const sub: RefundInput = {
      started_at: startedAt,
      expires_at: null,
      plan: { price_monthly: 599, price_yearly: null },
    };
    const result = calcRefund(sub, new Date('2024-03-15T00:00:00.000Z'));
    expect(result.isYearly).toBe(false);
    expect(result.refundAmount).toBe(0);
    expect(result.originalAmount).toBe(599);
  });

  it('邊界：到期日與下月開始相同 → remainingMonths = 0，不退費', () => {
    // now = 2024-03-15 → nextMonthStart = 2024-04-01
    // expiresAt = 2024-04-01（剛好等於 nextMonthStart）
    // differenceInMonths(2024-04-01, 2024-04-01) = 0
    const sub: RefundInput = {
      started_at: '2023-04-01T00:00:00.000Z',
      expires_at: '2024-04-01T00:00:00.000Z',
      plan: yearlyPlan,
    };
    const result = calcRefund(sub, new Date('2024-03-15T00:00:00.000Z'));
    expect(result.remainingMonths).toBe(0);
    expect(result.refundAmount).toBe(0);
  });
});
