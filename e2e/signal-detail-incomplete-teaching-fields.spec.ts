import { test, expect, type Page } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * SignalDetail 韌性回歸：teaching 欄位 / experts embed 資料不完整時
 * 仍要能渲染，並顯示合理 fallback（不觸發 SignalDetailErrorBoundary、
 * 不出現整頁崩潰或 UnavailableContent）。
 *
 * 涵蓋情境：
 *   A. experts embed 為 null（無老師名稱、無 currency、無 role）
 *   B. experts 存在但 currency 缺失 → 從 instrument 推斷（AAPL → USD、2330 → TWD）
 *   C. 所有教學欄位（reason_summary / reason_detail / risk_notes / learning_points）為 null
 *   D. price_hint / quantity / quantity_unit / published_at 都為 null
 */

const EXPERT_SLUG = 'resilience-master';
const USER_ID = 'user-resilience-signal';

type Scenario = {
  name: string;
  signalId: string;
  row: Record<string, unknown>;
  expectVisible: RegExp | string;
  // 是否應以 US$ 顯示（幣別 fallback 判斷用）
  currencyProbe?: 'USD' | 'TWD' | null;
};

const scenarios: Scenario[] = [
  {
    name: 'A. experts embed = null',
    signalId: 'sig-a-null-experts',
    row: {
      id: 'sig-a-null-experts',
      instrument: 'AAPL Apple',
      action: 'buy',
      price_hint: 210,
      quantity: 10,
      quantity_unit: '股',
      reason_summary: '這則訊號的老師 embed 為 null，測試 fallback。',
      reason_detail: null,
      risk_notes: null,
      learning_points: null,
      published_at: new Date().toISOString(),
      experts: null,
    },
    expectVisible: /AAPL/,
    currencyProbe: 'USD', // 靠 instrument 推斷
  },
  {
    name: 'B. experts.currency 缺失（TW 代號應推斷 TWD）',
    signalId: 'sig-b-missing-currency',
    row: {
      id: 'sig-b-missing-currency',
      instrument: '2330 台積電',
      action: 'add',
      price_hint: 900,
      quantity: 1,
      quantity_unit: '張',
      reason_summary: 'currency 欄位為 null，應從 instrument 推斷為 TWD。',
      reason_detail: null,
      risk_notes: null,
      learning_points: null,
      published_at: new Date().toISOString(),
      experts: {
        name: 'Resilience Master',
        slug: EXPERT_SLUG,
        role: 'mentor',
        avatar_url: null,
        currency: null,
      },
    },
    expectVisible: /2330/,
    currencyProbe: 'TWD',
  },
  {
    name: 'C. 所有教學欄位為 null',
    signalId: 'sig-c-empty-teaching',
    row: {
      id: 'sig-c-empty-teaching',
      instrument: 'TSLA Tesla',
      action: 'sell',
      price_hint: 300,
      quantity: 5,
      quantity_unit: '股',
      reason_summary: null,
      reason_detail: null,
      risk_notes: null,
      learning_points: null,
      published_at: new Date().toISOString(),
      experts: {
        name: 'Resilience Master',
        slug: EXPERT_SLUG,
        role: 'mentor',
        avatar_url: null,
        currency: 'USD',
      },
    },
    expectVisible: /TSLA/,
    currencyProbe: 'USD',
  },
  {
    name: 'D. price/quantity/date 全為 null',
    signalId: 'sig-d-null-numerics',
    row: {
      id: 'sig-d-null-numerics',
      instrument: 'NVDA Nvidia',
      action: 'trim',
      price_hint: null,
      quantity: null,
      quantity_unit: '股',
      reason_summary: '數值全 null，應以 — 或 fallback 顯示，不可炸頁。',
      reason_detail: null,
      risk_notes: null,
      learning_points: null,
      published_at: null,
      experts: {
        name: 'Resilience Master',
        slug: EXPERT_SLUG,
        role: 'mentor',
        avatar_url: null,
        currency: 'USD',
      },
    },
    expectVisible: /NVDA/,
    currencyProbe: 'USD',
  },
];

async function setupMocks(page: Page, row: Record<string, unknown>) {
  await seedSession(page, { id: USER_ID, email: 'resilience@example.com' });
  await installRoutes(page, {
    rest: {
      profiles: () => [{
        display_name: '訂閱者',
        expert_slug: EXPERT_SLUG,
        avatar_url: null,
        line_user_id: null,
        is_tester: false,
        merged_into_user_id: null,
      }],
      user_roles: () => [{ user_id: USER_ID, role: 'company_admin' }],
      experts: () => [{
        id: 'expert-resilience',
        name: 'Resilience Master',
        role: 'mentor',
        slug: EXPERT_SLUG,
        currency: 'USD',
      }],
      expert_signals: () => row,
      subscription_timeline: () => [],
      subscriptions: () => [],
    },
  });
}

for (const sc of scenarios) {
  test(`SignalDetail 韌性：${sc.name} 仍能渲染且無崩潰`, async ({ page }) => {
    await setupMocks(page, sc.row);

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`/app/signal/${sc.signalId}?preview=1`);

    // 1) 核心內容渲染（instrument 一定看得到）
    await expect(page.getByText(sc.expectVisible).first()).toBeVisible({ timeout: 10_000 });

    // 2) 錯誤邊界 fallback「訊號內容暫時無法顯示」不能出現
    await expect(page.getByText('訊號內容暫時無法顯示')).toHaveCount(0);

    // 3) UnavailableContent（訂閱牆或 404）不能出現
    await expect(page.getByText(/內容暫時無法顯示|尚未訂閱|找不到此訊號/i)).toHaveCount(0);

    // 4) 沒有 pageerror；console error 允許雜訊，但不可有 undefined / cannot read properties
    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toEqual([]);
    const criticalConsole = consoleErrors.filter((m) =>
      /cannot read propert|is not a function|undefined is not|TypeError/i.test(m),
    );
    expect(criticalConsole, `critical console errors: ${criticalConsole.join(' | ')}`).toEqual([]);

    // 5) 幣別 fallback：US$ 或 NT$ 至少出現一次（代表 resolveDisplayCurrency 有走通）
    if (sc.currencyProbe === 'USD') {
      await expect(page.getByText(/US\$/).first()).toBeVisible();
    } else if (sc.currencyProbe === 'TWD') {
      await expect(page.getByText(/NT\$/).first()).toBeVisible();
    }
  });
}
