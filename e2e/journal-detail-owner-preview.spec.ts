import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * 導師點自己的週記卡片時 URL 會帶 ?preview=1：
 *   Journals.tsx L289 → `/app/journal/${id}?preview=1` (when previewExpertId set)
 *
 * 這時 JournalDetail 應該：
 *   1. 走 owner fallback RPC（get_owned_journal_bundle）
 *   2. 不再出現 UnavailableContent
 *   3. 正常渲染 signal 內容
 *   4. 預覽診斷區塊顯示 "Owner Fallback RPC"
 */

const OWNER_USER_ID = 'owner-user-id';
const OWNER_EXPERT_ID = 'expert-owner-uuid';
const OWNER_SLUG = 'laoshi-preview';
const SIGNAL_ID = 'signal-preview-001';

const bundleSignal = {
  id: SIGNAL_ID,
  instrument: '2330 台積電',
  action: 'BUY',
  price_hint: 1000,
  quantity: 2,
  quantity_unit: '張',
  currency: 'TWD',
  reason_summary: '本週操作說明（預覽用）',
  reason_detail: null,
  risk_notes: null,
  learning_points: null,
  published_at: new Date().toISOString(),
  expert_id: OWNER_EXPERT_ID,
  experts: {
    name: '老周',
    slug: OWNER_SLUG,
    role: 'mentor',
    avatar_url: null,
  },
};

test.use({ viewport: { width: 1280, height: 900 } });

test.describe('JournalDetail owner preview', () => {
  test('?preview=1 走 owner RPC，不顯示 UnavailableContent 且能渲染內容', async ({ page }) => {
    await seedSession(page, { id: OWNER_USER_ID, email: 'owner@example.com' });

    let rpcCalls = 0;
    let rlsSignalGets = 0;

    await installRoutes(page, {
      rest: {
        profiles: () => [{
          display_name: '老周',
          expert_slug: OWNER_SLUG,
          avatar_url: null,
          line_user_id: null,
          is_tester: false,
          merged_into_user_id: null,
        }],
        user_roles: () => [],
        experts: ({ url }) => {
          // usePreviewMode 會查 experts by slug；也可能其他地方查
          const slug = url.searchParams.get('slug');
          if (slug?.includes(OWNER_SLUG)) {
            return [{ id: OWNER_EXPERT_ID, name: '老周', role: 'mentor', slug: OWNER_SLUG }];
          }
          return [];
        },
        expert_signals: ({ method }) => {
          if (method === 'GET') {
            rlsSignalGets += 1;
            // RLS 讀不到（模擬訂閱過期 / 未訂閱情境）
            return [];
          }
          return [];
        },
        get_owned_journal_bundle: ({ body }) => {
          rpcCalls += 1;
          expect(body?._signal_id).toBe(SIGNAL_ID);
          return {
            signal: bundleSignal,
            weekSignals: [bundleSignal],
          };
        },
        // 訂閱 timeline 相關表回空即可
        subscription_timeline: () => [],
        subscriptions: () => [],
      },
      functions: {},
    });

    // 先設 sessionStorage 讓 usePreviewMode 也認得 preview slug（模擬「訂閱者預覽」按鈕）
    await page.addInitScript((slug) => {
      try { sessionStorage.setItem('previewExpertSlug', slug); } catch {}
    }, OWNER_SLUG);

    await page.goto(`/app/journal/${SIGNAL_ID}?preview=1`);

    // 應該渲染出週記內容
    await expect(page.getByTestId('journal-detail-instrument').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('2330')).toBeVisible();

    // 不應該再出現 UnavailableContent
    await expect(page.getByText('這篇週記目前無法顯示')).toHaveCount(0);
    await expect(page.getByTestId('unavailable-goto-subscriptions')).toHaveCount(0);

    // 預覽診斷區塊應存在且標示為 Owner Fallback RPC
    const diag = page.getByTestId('journal-preview-diagnostics');
    await expect(diag).toBeVisible();
    await expect(diag.getByText('Owner Fallback RPC')).toBeVisible();

    // 確認 RPC 有被觸發、且 RLS 已先嘗試過
    expect(rpcCalls).toBeGreaterThanOrEqual(1);
    expect(rlsSignalGets).toBeGreaterThanOrEqual(1);
  });

  test('沒有 ?preview=1 且 RLS 拉不到時仍顯示 UnavailableContent（回歸對照組）', async ({ page }) => {
    await seedSession(page, { id: 'random-user', email: 'sub@example.com' });

    await installRoutes(page, {
      rest: {
        profiles: () => [{
          display_name: '訪客',
          expert_slug: null,
          avatar_url: null,
          line_user_id: null,
          is_tester: false,
          merged_into_user_id: null,
        }],
        user_roles: () => [],
        expert_signals: () => [],
        get_owned_journal_bundle: () => {
          throw new Error('RPC 不應該在非 owner / 非 preview 情境被呼叫');
        },
      },
    });

    await page.goto(`/app/journal/${SIGNAL_ID}`);
    await expect(page.getByText('這篇週記目前無法顯示')).toBeVisible({ timeout: 10_000 });
  });
});
