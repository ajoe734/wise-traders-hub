import { test, expect } from '@playwright/test';
import { installRoutes, seedSession } from './helpers/supabase-mock';
const host = 'https://yqacmrgdjlenbijclngi.supabase.co';
const expert = { id: 'expert-test', name: 'brcto', slug: 'master-brcto', role: 'mentor', status: 'active', markets: ['TW'], style_tags: [] };
const plan = { id: 'plan-test', expert_id: expert.id, name: '週記方案', plan_type: 'mentor_weekly_journal', price_monthly: 799, price_yearly: 7990, is_active: true, features: [] };
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'brcto-test@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
for (const platform of [undefined, 'ig', 'fb', 'yt', 'line']) {
  test(`${platform ?? '未標平台'} short link → signup → login → remittance attribution`, async ({ page }) => {
    const referrals: any[] = []; let order: any = null;
    await installRoutes(page, { rest: {
      get_expert_detail_bundle: () => ({ expert: { ...expert, expert_plans: [plan] }, plans: [plan], subscriber_count: 0, my_subscribed_plan_ids: [] }),
      experts: () => expert, expert_plans: () => plan,
      profiles: () => ({ display_name: 'Test member', is_tester: false }), user_roles: () => [],
      referral_attributions: ({ method, body }) => { if (method === 'POST') referrals.push(body); return method === 'GET' ? referrals : null; },
      payment_providers_safe: () => [{ id: 'remit', display_name: '匯款', provider_type: 'remittance', is_active: true, is_default: true, env: 'prod' }],
      member_subscriptions: () => [],
    }, functions: { 'create-expert-remittance': ({ body }) => { order = body; return { orderId: 'test-order', ok: true }; } } });
    await page.route(`${host}/auth/v1/signup`, route => route.fulfill({ json: { user, session: null } }));
    await page.route(`${host}/auth/v1/token**`, route => route.fulfill({ json: {
      access_token: `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', exp: 4070908800 })).toString('base64url')}.test-signature`,
      refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 4070908800, user,
    } }));
    await page.goto(`/s/master-brcto?utm_campaign=brcto_journal${platform ? `&utm_content=${platform}` : ''}`);
    await expect(page).toHaveURL(/\/expert\/master-brcto\?utm_campaign=brcto_journal/);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('lf_attr_v1') ?? '{}').utm_campaign)).toBe('brcto_journal');
    await page.goto('/auth/register');
    await page.getByLabel('姓名', { exact: true }).fill('Test member');
    await page.getByLabel('電子郵件', { exact: true }).fill(user.email);
    await page.locator('#password').fill('MockPassword123!'); await page.locator('#confirmPassword').fill('MockPassword123!');
    await page.getByRole('button', { name: '建立帳號', exact: true }).click();
    await expect(page).not.toHaveURL(/\/auth\/register/);
    await page.goto('/auth/login');
    await page.getByLabel('電子郵件', { exact: true }).fill(user.email);
    await page.getByLabel('密碼', { exact: true }).fill('MockPassword123!');
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await expect.poll(() => referrals.length).toBe(1);
    expect(referrals[0]).toMatchObject({ user_id: user.id, utm_campaign: 'brcto_journal', utm_content: platform ?? null });
    await page.goto('/checkout/master-brcto/plan-test');
    await page.getByRole('button', { name: /確認付款/ }).click();
    const consent = page.getByRole('dialog');
    await consent.getByRole('checkbox').check();
    await consent.getByRole('button', { name: '同意並前往付款' }).click();
    await expect.poll(() => order?.attribution?.utm_campaign).toBe('brcto_journal');
    expect(order.attribution.utm_content).toBe(platform);
    expect(order.attribution.visitor_id).toBe(referrals[0].visitor_id);
    await expect(page).toHaveURL(/\/account\/remittance/);
  });
}

test('platform report shows paginated isolated totals and failure state', async ({ page }) => {
  await seedSession(page, { ...user, role: 'company_admin' });
  let fail = false;
  const now = new Date().toISOString();
  await installRoutes(page, { rest: {
    profiles: ({ url }) => url.searchParams.get('select') === 'user_id,created_at' ? [] : { display_name: 'Admin', is_tester: false },
    user_roles: () => [{ role: 'company_admin' }],
    traffic_visits: () => fail ? { __status: 500, body: { message: 'test unavailable' } } : ['ig', 'fb', 'yt', 'line', null].map((content, i) => ({ visitor_id: `v${i}`, utm_campaign: 'brcto_journal', utm_content: content, first_seen_at: now })),
    referral_attributions: () => [],
    conversions: () => [{ id: 'paid-test', utm_campaign: 'brcto_journal', utm_content: 'ig', gross_amount: 799, occurred_at: now }],
    get_traffic_overview: () => ({ kpi: {}, daily: [], channels: [], campaigns: [] }),
  } });
  await page.goto('/company/traffic');
  await page.getByRole('tab', { name: '流量來源', exact: true }).click();
  const report = page.getByRole('region', { name: '自媒體分平台' });
  await expect(report.getByRole('row', { name: 'IG 1 0 1 799', exact: true })).toBeVisible();
  for (const label of ['FB', 'YouTube', 'LINE', '未標平台']) await expect(report.getByRole('row', { name: `${label} 1 0 0 0`, exact: true })).toBeVisible();
  for (const width of [1280, 560, 390, 380]) {
    await page.setViewportSize({ width, height: 1800 });
    await report.screenshot({ path: `/tmp/browser/brcto-platform-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  fail = true; await report.getByRole('button', { name: '重新整理' }).click();
  await expect(report.getByRole('alert')).toHaveText('平台統計讀取失敗，請重新整理。', { timeout: 15000 });
});