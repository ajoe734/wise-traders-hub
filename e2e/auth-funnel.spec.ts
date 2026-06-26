/**
 * F1 — 登入/註冊漏斗 mock e2e
 *
 * 對應 traffic_events.event_name：
 *   - auth_login_submit / auth_login_success / auth_login_failure
 *   - auth_signup_submit / auth_signup_success / auth_signup_failure
 *
 * 任何修改 AuthContext.login/register、Login.tsx、Register.tsx 都應跑此測試。
 */
import { test, expect, type Route } from '@playwright/test';
import { installFunnelCollector, readFunnelEvents, eventNames } from './helpers/funnel-events';

const SUPABASE_HOST = 'https://yqacmrgdjlenbijclngi.supabase.co';

async function mockTrafficIngest(page) {
  await page.route(`${SUPABASE_HOST}/functions/v1/traffic-ingest`, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

async function mockAuth(
  page,
  options: { signin?: { status: number; body: any }; signup?: { status: number; body: any } },
) {
  await page.route(`${SUPABASE_HOST}/auth/v1/**`, (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/token') && options.signin) {
      return route.fulfill({
        status: options.signin.status,
        contentType: 'application/json',
        body: JSON.stringify(options.signin.body),
      });
    }
    if (url.pathname.endsWith('/signup') && options.signup) {
      return route.fulfill({
        status: options.signup.status,
        contentType: 'application/json',
        body: JSON.stringify(options.signup.body),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test.describe('Auth funnel', () => {
  test.beforeEach(async ({ page }) => {
    await installFunnelCollector(page);
    await mockTrafficIngest(page);
  });

  test('login failure 應送 submit + failure', async ({ page }) => {
    await mockAuth(page, {
      signin: {
        status: 400,
        body: { error: 'invalid_grant', error_code: 'invalid_credentials', msg: 'Invalid login credentials' },
      },
    });
    await page.goto('/auth/login');
    await page.getByLabel('電子郵件').fill('nope@test.io');
    await page.getByLabel('密碼').fill('wrongpass');
    await page.getByRole('button', { name: '登入' }).click();

    // wait for failure toast
    await expect(page.getByText(/帳號或密碼錯誤|登入失敗/).first()).toBeVisible({ timeout: 5000 });

    const names = eventNames(await readFunnelEvents(page));
    expect(names).toContain('auth_login_submit');
    expect(names).toContain('auth_login_failure');
    expect(names).not.toContain('auth_login_success');
  });

  test('signup failure 應送 submit + failure', async ({ page }) => {
    await mockAuth(page, {
      signup: {
        status: 422,
        body: { error: 'weak_password', code: 'weak_password', msg: 'Password is too weak' },
      },
    });
    await page.goto('/auth/register');
    await page.getByLabel('姓名').fill('Tester');
    await page.getByLabel('電子郵件').fill('new@test.io');
    await page.locator('#password').fill('abcdefgh');
    await page.locator('#confirmPassword').fill('abcdefgh');
    await page.getByRole('button', { name: '註冊' }).click();

    await expect(page.getByText(/註冊失敗|密碼太弱/).first()).toBeVisible({ timeout: 5000 });

    const names = eventNames(await readFunnelEvents(page));
    expect(names).toContain('auth_signup_submit');
    expect(names).toContain('auth_signup_failure');
    expect(names).not.toContain('auth_signup_success');
  });

  test('LINE 登入按鈕應送 auth_login_submit{method:line} 並跳轉 line-login-authorize', async ({ page }) => {
    // Block real navigation to LINE authorize endpoint
    await page.route(`${SUPABASE_HOST}/functions/v1/line-login-authorize**`, (route: Route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>OK</body></html>' }),
    );
    await page.goto('/auth/login');
    await page.getByRole('button', { name: /LINE 快速登入/ }).click();
    await page.waitForURL(/line-login-authorize/, { timeout: 5000 });

    const events = await readFunnelEvents(page);
    const login = events.find((e) => e.event_name === 'auth_login_submit');
    expect(login).toBeTruthy();
    expect(login?.event_props).toMatchObject({ method: 'line' });
  });
});
