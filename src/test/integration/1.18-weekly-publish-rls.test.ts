/**
 * Group 1.18 — 週記發布排程與 RLS
 *
 * 測試範圍：
 *
 *   A. buildPromoMessage（src/lib/weeklyPublishLogic.ts）：
 *      為已取消訂閱者建立推廣 Flex Message 的純函數。
 *        4.5-1 promo：有 performance 資料 → type=flex、altText 含 signalCount、body 含績效欄位
 *        邊界：performance = null → 仍回傳合法 flex message 含「立即重新訂閱！」
 *        邊界：signalCount 與 expertName 正確反映在 altText 中
 *
 *   B. classifyLineTargets（src/lib/weeklyPublishLogic.ts）：
 *      依訂閱狀態分類 LINE 推播目標（subscribedTargets / canceledTargets）。
 *        4.5-3：無 canceled_at 的有效訂閱者 → subscribedTargets
 *        4.5-4 promo：有 canceled_at 的有效訂閱者 → canceledTargets
 *        4.5-4：有綁定但無有效訂閱 → 兩者都不含
 *        4.5-4：訂閱方案非此專家方案 → 排除
 *
 *   C. drift-detection：
 *      publish-weekly-journals 主要流程確認（4.5-1 ~ 4.5-4）
 *
 * 對應測試路徑：
 *   4.5-1：排程觸發有待發布訊號 → expert_signals status pending → published
 *   4.5-2：排程觸發無待發布訊號 → 無操作不報錯（published:0, pushed:0）
 *   4.5-3：訂閱者收到完整週記推播（subscribedTargets）
 *   4.5-4：非訂閱者 / 已取消者不在 subscribedTargets，或收推廣訊息
 *
 * 注意：expert_journals 資料表在本專案不存在；
 *       publish-weekly-journals 實際操作 expert_signals（pending → published），
 *       LINE 推播直接發出，不寫入 notifications 資料表。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buildPromoMessage,
  classifyLineTargets,
  type ActiveSubscription,
} from '@/lib/weeklyPublishLogic';

// ── buildPromoMessage（推廣 Flex Message 建構）────────────────────────────────

describe('buildPromoMessage（已取消訂閱者推廣 Flex Message）', () => {
  it('有 performance 資料 → type=flex、altText 含 signalCount、body 含勝率與累計報酬（4.5-1 promo path）', () => {
    const msg = buildPromoMessage(
      '測試專家',
      { win_rate: 70, total_return_pct: 25.5, return_1y: 20.1, total_trades: 10 },
      3,
    ) as any;

    expect(msg.type).toBe('flex');
    expect(msg.altText).toContain('3');
    const bodyStr = JSON.stringify(msg.contents);
    expect(bodyStr).toContain('70.0%');
    expect(bodyStr).toContain('25.5%');
    expect(bodyStr).toContain('立即重新訂閱！');
  });

  it('performance = null → 仍回傳合法 flex message，含「立即重新訂閱！」CTA（邊界）', () => {
    const msg = buildPromoMessage('測試專家', null, 5) as any;

    expect(msg.type).toBe('flex');
    expect(msg.altText).toContain('5');
    expect(JSON.stringify(msg.contents)).toContain('立即重新訂閱！');
  });

  it('signalCount 與 expertName 正確反映在 altText 中（邊界）', () => {
    const msg = buildPromoMessage('專家A', null, 7) as any;
    expect(msg.altText).toContain('7');
    expect(msg.altText).toContain('專家A');
  });

  it('performance 有效但各欄位為 null → 累計報酬、近一年報酬、勝率皆為 "-"、totalTrades 為 0', () => {
    const msg = buildPromoMessage(
      '測試專家',
      { win_rate: null, total_return_pct: null, return_1y: null, total_trades: null },
      2,
    ) as any;
    const bodyStr = JSON.stringify(msg.contents);
    expect(msg.type).toBe('flex');
    // null fallback → '-'
    expect(bodyStr).toContain('"-"');
  });
});

// ── classifyLineTargets（LINE 推播目標分類）──────────────────────────────────

describe('classifyLineTargets（LINE 推播目標分類）', () => {
  const planA = 'plan-A';
  const planB = 'plan-B';
  const expertPlanIds = new Set([planA]);

  it('無 canceled_at 的有效訂閱者 → 在 subscribedTargets 中（4.5-3）', () => {
    const bindings = [{ user_id: 'user-1', line_user_id: 'L001' }];
    const activeSubs: ActiveSubscription[] = [
      { user_id: 'user-1', plan_id: planA, canceled_at: null },
    ];

    const { subscribedTargets, canceledTargets } = classifyLineTargets(
      bindings,
      activeSubs,
      expertPlanIds,
    );

    expect(subscribedTargets).toContain('L001');
    expect(canceledTargets).not.toContain('L001');
  });

  it('有 canceled_at 的有效訂閱者 → 在 canceledTargets 中，不在 subscribedTargets（4.5-4 promo path）', () => {
    const bindings = [{ user_id: 'user-2', line_user_id: 'L002' }];
    const activeSubs: ActiveSubscription[] = [
      { user_id: 'user-2', plan_id: planA, canceled_at: '2026-03-15T00:00:00.000Z' },
    ];

    const { subscribedTargets, canceledTargets } = classifyLineTargets(
      bindings,
      activeSubs,
      expertPlanIds,
    );

    expect(canceledTargets).toContain('L002');
    expect(subscribedTargets).not.toContain('L002');
  });

  it('有綁定但無有效訂閱 → 不在任何 targets 中（4.5-4）', () => {
    const bindings = [{ user_id: 'user-3', line_user_id: 'L003' }];
    const activeSubs: ActiveSubscription[] = [];

    const { subscribedTargets, canceledTargets } = classifyLineTargets(
      bindings,
      activeSubs,
      expertPlanIds,
    );

    expect(subscribedTargets).not.toContain('L003');
    expect(canceledTargets).not.toContain('L003');
  });

  it('訂閱方案非此專家方案（planB 而非 planA）→ 排除（4.5-4）', () => {
    const bindings = [{ user_id: 'user-4', line_user_id: 'L004' }];
    const activeSubs: ActiveSubscription[] = [
      { user_id: 'user-4', plan_id: planB, canceled_at: null },
    ];

    const { subscribedTargets, canceledTargets } = classifyLineTargets(
      bindings,
      activeSubs,
      expertPlanIds,
    );

    expect(subscribedTargets).not.toContain('L004');
    expect(canceledTargets).not.toContain('L004');
  });
});

// ── drift-detection: publish-weekly-journals 主要流程 ──────────────────────

describe('drift-detection: publish-weekly-journals 週記發布排程', () => {
  let src: string;

  beforeAll(() => {
    src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/publish-weekly-journals/index.ts'),
      'utf-8',
    );
  });

  it('從 expert_signals 查詢 status=pending 的待發布訊號（4.5-1）', () => {
    expect(src).toContain('expert_signals');
    expect(src).toContain("'pending'");
  });

  it('將待發布訊號批次更新為 status=published（4.5-1）', () => {
    expect(src).toContain("status: 'published'");
  });

  it("無待發布訊號時 early return，回傳 { published: 0, pushed: 0 }（4.5-2）", () => {
    expect(src).toContain('published: 0');
    expect(src).toContain('pushed: 0');
  });

  it('以 canceled_at 區分訂閱中與已取消的 LINE 推播目標（4.5-3/4.5-4）', () => {
    expect(src).toContain('canceled_at');
    expect(src).toContain('subscribedTargets');
    expect(src).toContain('canceledTargets');
  });

  it('從 member_line_bindings 讀取 is_active=true 的有效綁定（4.5-3/4.5-4 guard）', () => {
    expect(src).toContain('member_line_bindings');
    expect(src).toContain("'is_active', true");
  });

  it('查詢 member_subscriptions 時以 status=active 和 expires_at 條件篩選有效訂閱（4.5-3/4.5-4 pre-filter）', () => {
    expect(src).toContain("'status', 'active'");
    expect(src).toContain(".gt('expires_at'");
  });

  it('Deno 函數保有 buildPromoMessage 推廣訊息建構函數（4.5-1 promo）', () => {
    expect(src).toContain('buildPromoMessage');
  });
});

// ── drift-detection: Journals.tsx / JournalDetail.tsx 週記瀏覽路徑 ──────────

describe('drift-detection: Journals.tsx / JournalDetail.tsx 週記瀏覽路徑', () => {
  let journalsSrc: string;
  let detailSrc: string;

  beforeAll(() => {
    journalsSrc = readFileSync(
      resolve(process.cwd(), 'src/pages/app/Journals.tsx'),
      'utf-8',
    );
    detailSrc = readFileSync(
      resolve(process.cwd(), 'src/pages/app/JournalDetail.tsx'),
      'utf-8',
    );
  });

  it('Journals.tsx 訂閱前置檢查使用 has_active_subscription RPC（4.5-3）', () => {
    expect(journalsSrc).toContain('has_active_subscription');
  });

  // A4：expert_signals 讀取已收斂到 journalRepository，頁面不得再自刻查詢；
  // status=published 過濾改由倉庫保證（見 journal-repository-parity.test.ts）。
  it('Journals.tsx 透過 journalRepository 讀取，且倉庫鎖住 status=published（4.5-3）', () => {
    expect(journalsSrc).toContain('journalRepository');
    expect(journalsSrc).toContain('forSubscriber');
    const repoSrc = readFileSync(
      resolve(process.cwd(), 'src/lib/journalRepository.ts'),
      'utf-8',
    );
    expect(repoSrc).toContain('expert_signals');
    expect(repoSrc).toContain("'published'");
  });

  it('JournalDetail.tsx 透過 journalRepository.forOwnerPreview 取得週記詳情（4.5-3/4.5-4）', () => {
    expect(detailSrc).toContain('journalRepository');
    expect(detailSrc).toContain('forOwnerPreview');
  });

  it('Journals.tsx 與 JournalDetail.tsx 均掛上 SubscriptionTimeline（訂閱有效期間視覺化）', () => {
    expect(journalsSrc).toContain('SubscriptionTimeline');
    expect(journalsSrc).toContain('useSubscriptionTimeline');
    expect(detailSrc).toContain('SubscriptionTimeline');
    expect(detailSrc).toContain('useSubscriptionTimeline');
    // 詳情頁需傳 highlightAt 以標示本篇位置
    expect(detailSrc).toContain('highlightAt');
  });
});

