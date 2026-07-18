import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * 補強：teaching learning_points 含多媒體與多段 rich HTML 時，
 * SafeRichHtml 應該：
 *   1. 安全渲染允許的標籤（p / strong / ul / ol / img / h3 / blockquote / a）
 *   2. 對 iframe / video / script 等禁用標籤靜默剝除（不炸頁、不觸發 ErrorBoundary）
 *   3. 教學區塊 data-lp-empty="0"，不顯示 jd-learning-empty 缺失卡
 *   4. 無 console/pageerror
 */

const USER_ID = 'teaching-media-user';
const EXPERT_ID = 'expert-media-uuid';
const EXPERT_SLUG = 'laoshi-media';
const SIGNAL_ID = 'signal-teaching-media';

// 混合允許與禁用的標籤：iframe、video、script 應被 DOMPurify 剝除
const RICH_HTML = `
<h3>本週教學：三段式進場</h3>
<p>先看<strong>週線結構</strong>，再驗證<em>日線量能</em>，最後對照 <a href="https://example.com/ref" target="_blank" rel="noopener">參考連結</a>。</p>
<ul>
  <li>條件一：MA5 &gt; MA20</li>
  <li>條件二：量能放大 1.5x</li>
  <li>條件三：法人連買 3 日</li>
</ul>
<ol><li>第一段：試單 1/3</li><li>第二段：突破加碼</li><li>第三段：回測不破加滿</li></ol>
<blockquote>紀律永遠比預測重要。</blockquote>
<p><img src="https://example.com/rich-chart.png" alt="教學圖表" /></p>
<figure><img src="https://example.com/rich-annot.png" alt="標註圖" /><figcaption>紅框為進場位置</figcaption></figure>
<p>影片範例（將被安全剝除）：</p>
<iframe src="https://www.youtube.com/embed/should-be-stripped" width="560" height="315"></iframe>
<video src="https://example.com/should-be-stripped.mp4" controls></video>
<script>window.__pwned = true;</script>
<p>結論：<code>SL = 進場價 * 0.95</code>，嚴守停損。</p>
`.trim();

const signal = {
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
  learning_points: RICH_HTML,
  published_at: '2026-07-14T09:00:00Z',
  expert_id: EXPERT_ID,
  experts: {
    name: '老周', slug: EXPERT_SLUG, role: 'mentor', avatar_url: null, currency: 'TWD',
  },
};

test.use({ viewport: { width: 1280, height: 1200 } });

test('teaching learning_points 含 iframe/video + 多段 rich HTML → SafeRichHtml 安全渲染，禁用標籤剝除', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await seedSession(page, { id: USER_ID, email: 'teach@example.com' });
  await installRoutes(page, {
    rest: {
      profiles: () => [{
        display_name: '老周', expert_slug: EXPERT_SLUG, avatar_url: null,
        line_user_id: null, is_tester: false, merged_into_user_id: null,
      }],
      user_roles: () => [{ role: 'expert' }],
      experts: () => [{ id: EXPERT_ID, name: '老周', role: 'mentor', slug: EXPERT_SLUG, currency: 'TWD', avatar_url: null }],
      expert_signals: () => [signal],
      stock_names: () => [],
      subscription_timeline: () => [],
      subscriptions: () => [],
      get_owned_journal_bundle: () => ({ signal, weekSignals: [signal] }),
    },
  });

  await page.goto(`/app/journal/${SIGNAL_ID}`);

  const block = page.getByTestId('jd-learning-points');
  await expect(block).toBeVisible({ timeout: 10_000 });
  await expect(block).toHaveAttribute('data-lp-empty', '0');
  await expect(page.getByTestId('jd-learning-empty')).toHaveCount(0);

  // 允許的多段內容有渲染
  await expect(block.getByRole('heading', { name: '本週教學：三段式進場' })).toBeVisible();
  await expect(block.getByText('週線結構')).toBeVisible();
  await expect(block.getByText(/MA5 > MA20/)).toBeVisible();
  await expect(block.getByText('突破加碼')).toBeVisible();
  await expect(block.getByText('紀律永遠比預測重要。')).toBeVisible();
  await expect(block.getByText('紅框為進場位置')).toBeVisible();
  await expect(block.getByRole('link', { name: '參考連結' })).toHaveAttribute('href', 'https://example.com/ref');

  // 允許的圖片保留
  await expect(block.locator('img[src="https://example.com/rich-chart.png"]')).toHaveCount(1);
  await expect(block.locator('img[src="https://example.com/rich-annot.png"]')).toHaveCount(1);

  // 禁用標籤剝除、且 script 未執行
  await expect(block.locator('iframe')).toHaveCount(0);
  await expect(block.locator('video')).toHaveCount(0);
  await expect(block.locator('script')).toHaveCount(0);
  const pwned = await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned === true);
  expect(pwned).toBe(false);

  // 不觸發 fallback / ErrorBoundary
  await expect(page.getByText('這篇週記目前無法顯示')).toHaveCount(0);
  await expect(page.getByText('訊號內容暫時無法顯示')).toHaveCount(0);
  await expect(page.getByText('教學重點尚未填寫或內容為空')).toHaveCount(0);

  // teaching 短路：不顯示價/量
  await expect(page.getByTestId('jd-price')).toHaveCount(0);
  await expect(page.getByTestId('jd-qty')).toHaveCount(0);

  expect(pageErrors, `pageerror: ${pageErrors.join('\n')}`).toHaveLength(0);
  const fatal = consoleErrors.filter((t) => !/DevTools|Warning: |favicon|net::ERR_/i.test(t));
  expect(fatal, `console.error: ${fatal.join('\n')}`).toHaveLength(0);
});
