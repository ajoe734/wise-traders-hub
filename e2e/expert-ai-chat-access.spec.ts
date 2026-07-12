import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * ExpertDetail「問老師 AI」分頁存取權限回歸測試
 *
 * 覆蓋三種帳號情境：
 *  1. 公司管理員：無訂閱亦應開放 AI 對話（isCompanyAdmin 分支）。
 *  2. 一般會員未訂閱：顯示鎖定卡片 + 導流 CTA。
 *  3. 一般會員已訂閱：正常進入 AI 對話介面。
 */

const EXPERT = {
  id: 'expert-1',
  slug: 'ai-access-master',
  name: 'AI 存取大師',
  bio: 'AI 分頁權限測試',
  role: 'mentor',
  status: 'active',
  is_active: true,
  avatar_url: null,
  style_tags: [],
  starting_capital: 1_000_000,
};

const PLAN = {
  id: 'plan-mentor-1',
  plan_type: 'mentor_weekly_journal',
  price_monthly: 1200,
  name: '修煉派',
  description: null,
  is_active: true,
  status: 'approved',
  expert_id: EXPERT.id,
};

interface Ctx {
  roles: Array<{ role: string }>;
  activeSubs: any[]; // member_subscriptions rows
  subHistory: Array<{ status: string; expires_at: string | null }>;
}

function buildRoutes(ctx: Ctx) {
  return {
    profiles: () => ({
      display_name: 'Tester',
      expert_slug: null,
      avatar_url: null,
      line_user_id: null,
      is_tester: false,
    }),
    user_roles: () => ctx.roles,
    experts: () => [{ id: EXPERT.id, slug: EXPERT.slug, ...EXPERT }],
    expert_plans: () => [PLAN],
    member_subscriptions: () => ctx.activeSubs,
    get_expert_capital_status: () => null,
    calculate_expert_performance: () => null,
    get_expert_detail_bundle: () => ({
      expert: EXPERT,
      plans: [PLAN],
      subscriber_count: 0,
      my_subscribed_plan_ids: ctx.activeSubs.map((s: any) => s.plan_id),
    }),
  } as Record<string, (req: any) => any>;
}

async function openAiTab(page: import('@playwright/test').Page) {
  await page.goto(`/app/expert/${EXPERT.slug}?tab=ai-chat`);
  await expect(page.getByRole('heading', { level: 1, name: EXPERT.name })).toBeVisible();
}

test.describe('/app/expert/:slug 問老師 AI 存取權限', () => {
  test('公司管理員：即使未訂閱也應開放 AI 對話', async ({ page }) => {
    await seedSession(page, { id: 'user-admin', email: 'admin@test.com' });
    await installRoutes(page, {
      rest: buildRoutes({
        roles: [{ role: 'company_admin' }],
        activeSubs: [],
        subHistory: [],
      }),
    });

    await openAiTab(page);

    // 未顯示鎖定卡片
    await expect(page.getByTestId('ai-chat-locked-card')).toHaveCount(0);
    // 顯示開放狀態（header 存取狀態卡文字）
    await expect(page.getByText('綜合判定：已開放 AI 對話')).toBeVisible();
    // 公司管理員 badge 為 default 樣式（有 ✓）— 用 header 區塊確認文字
    await expect(page.getByText(`與 ${EXPERT.name} 的 AI 分身對話`)).toBeVisible();
  });

  test('未訂閱一般會員：顯示鎖定卡片並可點擊導流 CTA', async ({ page }) => {
    await seedSession(page, { id: 'user-free', email: 'free@test.com' });
    await installRoutes(page, {
      rest: buildRoutes({
        roles: [],
        activeSubs: [],
        subHistory: [],
      }),
    });

    await openAiTab(page);

    // 顯示鎖定卡片
    const locked = page.getByTestId('ai-chat-locked-card');
    await expect(locked).toBeVisible();
    // 從未訂閱 → 訂閱後可與 AI 分身對話
    await expect(locked.getByText('訂閱後可與 AI 分身對話')).toBeVisible();
    // 導流 CTA：查看方案並訂閱
    const cta = page.getByTestId('ai-chat-locked-primary-cta');
    await expect(cta).toHaveText(/查看方案並訂閱/);

    // 點擊 CTA → 導到 /expert/:slug 訂閱頁
    await cta.click();
    await expect(page).toHaveURL(new RegExp(`/expert/${EXPERT.slug}$`));
  });

  test('已訂閱會員：正常進入 AI 對話介面', async ({ page }) => {
    await seedSession(page, { id: 'user-sub', email: 'sub@test.com' });
    await installRoutes(page, {
      rest: buildRoutes({
        roles: [],
        activeSubs: [
          {
            plan_id: PLAN.id,
            user_id: 'user-sub',
            status: 'active',
            expires_at: null,
            expert_plans: {
              id: PLAN.id,
              plan_type: PLAN.plan_type,
              expert_id: EXPERT.id,
              experts: {
                id: EXPERT.id,
                slug: EXPERT.slug,
                name: EXPERT.name,
                avatar_url: null,
                role: EXPERT.role,
                status: 'active',
                line_oa_id: null,
                line_channel_name: null,
                qr_code_url: null,
              },
            },
          },
        ],
        subHistory: [{ status: 'active', expires_at: null }],
      }),
    });

    await openAiTab(page);

    // 未顯示鎖定卡片
    await expect(page.getByTestId('ai-chat-locked-card')).toHaveCount(0);
    // 顯示開放狀態 + 對話 header
    await expect(page.getByText('綜合判定：已開放 AI 對話')).toBeVisible();
    await expect(page.getByText(`與 ${EXPERT.name} 的 AI 分身對話`)).toBeVisible();
    // 頁面上方也應出現「已訂閱此專家」卡片
    await expect(page.getByText('已訂閱此專家')).toBeVisible();
  });
});
