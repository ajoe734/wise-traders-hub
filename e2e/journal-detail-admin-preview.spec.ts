import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * 管理員（admin / company_admin）以 ?preview=1 開啟「任何一位老師」的週記詳情：
 *   1. RLS 讀不到 expert_signals（模擬管理員不是訂閱者）
 *   2. Owner Fallback RPC（get_owned_journal_bundle）在 role bypass 下應被觸發並回內容
 *   3. 不應出現 UnavailableContent
 *   4. 預覽診斷區塊應標示 "Owner Fallback RPC"
 *
 * 對照兩個角色：admin / company_admin，兩者皆須通過。
 */

const OTHER_EXPERT_ID = 'expert-not-owned-by-admin';
const OTHER_EXPERT_SLUG = 'master-brcto';
const SIGNAL_ID = 'signal-admin-preview-001';

const bundleSignal = {
  id: SIGNAL_ID,
  instrument: 'AAPL Apple',
  action: 'BUY',
  price_hint: 210,
  quantity: 10,
  quantity_unit: '股',
  currency: 'USD',
  reason_summary: '管理員預覽用內容',
  reason_detail: null,
  risk_notes: null,
  learning_points: null,
  published_at: new Date().toISOString(),
  expert_id: OTHER_EXPERT_ID,
  experts: {
    name: 'BRCTO',
    slug: OTHER_EXPERT_SLUG,
    role: 'mentor',
    avatar_url: null,
    currency: 'USD',
  },
};

test.use({ viewport: { width: 1280, height: 900 } });

for (const role of ['admin', 'company_admin'] as const) {
  test.describe(`JournalDetail admin preview (${role})`, () => {
    test(`${role} 以 ?preview=1 可預覽任何老師週記並命中 Owner Fallback RPC`, async ({ page }) => {
      const ADMIN_USER_ID = `admin-user-${role}`;
      await seedSession(page, { id: ADMIN_USER_ID, email: `${role}@example.com` });

      let rpcCalls = 0;
      let rlsSignalGets = 0;

      await installRoutes(page, {
        rest: {
          profiles: () => [{
            display_name: role === 'admin' ? '系統管理員' : '公司管理員',
            expert_slug: null,
            avatar_url: null,
            line_user_id: null,
            is_tester: false,
            merged_into_user_id: null,
          }],
          user_roles: () => [{ user_id: ADMIN_USER_ID, role }],
          experts: ({ url }) => {
            const slug = url.searchParams.get('slug');
            if (slug?.includes(OTHER_EXPERT_SLUG)) {
              return [{
                id: OTHER_EXPERT_ID,
                name: 'BRCTO',
                role: 'mentor',
                slug: OTHER_EXPERT_SLUG,
                currency: 'USD',
              }];
            }
            return [];
          },
          expert_signals: ({ method }) => {
            if (method === 'GET') {
              rlsSignalGets += 1;
              // 管理員非訂閱者 → RLS 拉不到
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
          subscription_timeline: () => [],
          subscriptions: () => [],
        },
        functions: {},
      });

      // 模擬管理員從後台「以此老師身份預覽」入口進來
      await page.addInitScript((slug) => {
        try { sessionStorage.setItem('previewExpertSlug', slug); } catch {}
      }, OTHER_EXPERT_SLUG);

      await page.goto(`/app/journal/${SIGNAL_ID}?preview=1`);

      // 內容應正常渲染
      await expect(page.getByTestId('journal-detail-instrument').first())
        .toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('AAPL')).toBeVisible();
      // 標題與操作列表都會渲染 reason_summary，鎖定 h1 避免 strict mode 撞名
      await expect(page.getByRole('heading', { name: '管理員預覽用內容' })).toBeVisible();

      // 不應該出現 UnavailableContent
      await expect(page.getByText('這篇週記目前無法顯示')).toHaveCount(0);
      await expect(page.getByTestId('unavailable-goto-subscriptions')).toHaveCount(0);

      // 預覽診斷區塊：Owner Fallback RPC 命中
      const diag = page.getByTestId('journal-preview-diagnostics');
      await expect(diag).toBeVisible();
      await expect(diag.getByText('Owner Fallback RPC')).toBeVisible();

      // RLS 先試過 → RPC 有被觸發
      expect(rlsSignalGets).toBeGreaterThanOrEqual(1);
      expect(rpcCalls).toBeGreaterThanOrEqual(1);
    });
  });
}
