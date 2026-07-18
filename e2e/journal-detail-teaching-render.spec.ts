import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * 回歸：7/14 那筆純 teaching 週記
 *   - action='teaching'、instrument/price/quantity 皆 null
 *   - 內容全部塞在 learning_points（含 <img>）
 *
 * 斷言：
 *   1. TradeItem 預設展開，教學重點區塊可見
 *   2. SafeRichHtml 有成功渲染 learning_points（含 <img> 與段落文字）
 *   3. 不出現 UnavailableContent、ErrorBoundary、空狀態提示
 *   4. 頁面無 console error
 *   5. `jd-learning-empty` 缺失提示卡不應出現（因為此筆有內容）
 */

const USER_ID = 'teaching-user-id';
const EXPERT_ID = 'expert-teaching-uuid';
const EXPERT_SLUG = 'laoshi-teaching';
const SIGNAL_ID = 'signal-teaching-0714';

const LEARNING_HTML = `
<p>本週教學重點：<strong>均線多頭排列</strong>的辨識方式。</p>
<p>下圖為範例走勢圖：</p>
<p><img src="https://example.com/chart-0714.png" alt="0714 教學圖" /></p>
<ul><li>條件一：MA5 &gt; MA10 &gt; MA20</li><li>條件二：量能同步放大</li></ul>
`.trim();

const teachingSignal = {
  id: SIGNAL_ID,
  instrument: '',
  action: 'teaching',
  price_hint: null,
  quantity: null,
  quantity_unit: null,
  currency: 'TWD',
  reason_summary: null,
  reason_detail: null,
  risk_notes: null,
  learning_points: LEARNING_HTML,
  published_at: '2026-07-14T09:00:00Z',
  expert_id: EXPERT_ID,
  experts: {
    name: '老周',
    slug: EXPERT_SLUG,
    role: 'mentor',
    avatar_url: null,
    currency: 'TWD',
  },
};

test.use({ viewport: { width: 1280, height: 900 } });

test.describe('JournalDetail teaching learning_points 渲染', () => {
  test('7/14 teaching 內容展開、SafeRichHtml 渲染圖文，無錯誤或 fallback', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await seedSession(page, { id: USER_ID, email: 'teach@example.com' });

    await installRoutes(page, {
      rest: {
        profiles: () => [{
          display_name: '老周',
          expert_slug: EXPERT_SLUG,
          avatar_url: null,
          line_user_id: null,
          is_tester: false,
          merged_into_user_id: null,
        }],
        user_roles: () => [{ role: 'expert' }],
        experts: () => [{
          id: EXPERT_ID, name: '老周', role: 'mentor', slug: EXPERT_SLUG, currency: 'TWD', avatar_url: null,
        }],
        // RLS 直接讀得到（owner 走 RLS 路徑）
        expert_signals: ({ method }) => {
          if (method === 'GET') return [teachingSignal];
          return [];
        },
        stock_names: () => [],
        subscription_timeline: () => [],
        subscriptions: () => [],
        // 若走 owner RPC fallback 也回一樣的內容
        get_owned_journal_bundle: () => ({
          signal: teachingSignal,
          weekSignals: [teachingSignal],
        }),
      },
      functions: {},
    });

    await page.goto(`/app/journal/${SIGNAL_ID}`);

    // 1. teaching 條目與教學重點區塊可見
    const teachingBlock = page.getByTestId('jd-learning-points');
    await expect(teachingBlock).toBeVisible({ timeout: 10_000 });
    await expect(teachingBlock).toHaveAttribute('data-lp-empty', '0');

    // 2. SafeRichHtml 有成功渲染文字與圖片
    await expect(teachingBlock.getByText('均線多頭排列')).toBeVisible();
    await expect(teachingBlock.getByText(/MA5 > MA10 > MA20/)).toBeVisible();
    const img = teachingBlock.locator('img[src="https://example.com/chart-0714.png"]');
    await expect(img).toHaveCount(1);
    await expect(img).toBeVisible();

    // 3. 不出現任何 fallback / 錯誤 / 缺失提示
    await expect(page.getByTestId('jd-learning-empty')).toHaveCount(0);
    await expect(page.getByText('這篇週記目前無法顯示')).toHaveCount(0);
    await expect(page.getByText('教學重點尚未填寫或內容為空')).toHaveCount(0);
    await expect(page.getByText(/Something went wrong|發生錯誤/i)).toHaveCount(0);

    // 4. 標題區塊「教學筆記」佔位有顯示（因為 instrument 為空）
    await expect(page.getByText('教學筆記').first()).toBeVisible();

    // 5. 不應該渲染出「價 / 量」欄位（teaching 短路）
    await expect(page.getByTestId('jd-price')).toHaveCount(0);
    await expect(page.getByTestId('jd-qty')).toHaveCount(0);

    // 6. 無 console/page error
    expect(pageErrors, `pageerror: ${pageErrors.join('\n')}`).toHaveLength(0);
    const fatal = consoleErrors.filter(
      (t) => !/Download the React DevTools|Warning: |favicon|net::ERR_/i.test(t),
    );
    expect(fatal, `console.error: ${fatal.join('\n')}`).toHaveLength(0);
  });

  test('learning_points 為空字串時顯示缺失提示，仍不觸發錯誤', async ({ page }) => {
    await seedSession(page, { id: USER_ID, email: 'teach@example.com' });

    const emptySignal = { ...teachingSignal, learning_points: '' };

    await installRoutes(page, {
      rest: {
        profiles: () => [{
          display_name: '老周', expert_slug: EXPERT_SLUG, avatar_url: null,
          line_user_id: null, is_tester: false, merged_into_user_id: null,
        }],
        user_roles: () => [{ role: 'expert' }],
        experts: () => [{ id: EXPERT_ID, name: '老周', role: 'mentor', slug: EXPERT_SLUG, currency: 'TWD', avatar_url: null }],
        expert_signals: () => [emptySignal],
        stock_names: () => [],
        subscription_timeline: () => [],
        subscriptions: () => [],
        get_owned_journal_bundle: () => ({ signal: emptySignal, weekSignals: [emptySignal] }),
      },
    });

    await page.goto(`/app/journal/${SIGNAL_ID}`);

    const block = page.getByTestId('jd-learning-points');
    await expect(block).toBeVisible({ timeout: 10_000 });
    await expect(block).toHaveAttribute('data-lp-empty', '1');
    await expect(page.getByTestId('jd-learning-empty')).toBeVisible();
    await expect(page.getByText('教學重點尚未填寫或內容為空')).toBeVisible();
  });
});
