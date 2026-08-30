/**
 * F1 — 登入/註冊漏斗 mock e2e
 *
 * 對應 traffic_events.event_name：
 *   - auth_login_submit / auth_login_success / auth_login_failure
 *   - auth_signup_submit / auth_signup_success / auth_signup_failure
 */
import { test, expect, type Route, type Page } from '@playwright/test';

const SUPABASE_HOST = 'https://yqacmrgdjlenbijclngi.supabase.co';

interface Captured { event_name?: string; event_props?: Record<string, unknown> | null }

async function installCollector(page: Page): Promise<Captured[]> {
  const sink: Captured[] = [];
  await page.route(`${SUPABASE_HOST}/functions/v1/traffic-ingest`, (route: Route) => {
    try {
      const body = route.request().postDataJSON();
      // 具名事件已批次化成 body.events[]，必須攤平才看得到 event_name。
      for (const ev of flattenIngestBody(body)) sink.push(ev as Captured);
    } catch { /* ignore */ }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return sink;
}


async function mockAuth(
  page: Page,
  opts: { signin?: { status: number; body: any }; signup?: { status: number; body: any } },
) {
  await page.route(`${SUPABASE_HOST}/auth/v1/**`, (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/token') && opts.signin) {
      return route.fulfill({
        status: opts.signin.status,
        contentType: 'application/json',
        body: JSON.stringify(opts.signin.body),
      });
    }
    if (url.pathname.endsWith('/signup') && opts.signup) {
      return route.fulfill({
        status: opts.signup.status,
        contentType: 'application/json',
        body: JSON.stringify(opts.signup.body),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function waitForEvent(events: Captured[], name: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (events.some((e) => e.event_name === name)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Event ${name} never captured. Got: ${events.map((e) => e.event_name).join(', ')}`);
}

test.describe('Auth funnel', () => {
  test('login failure 應送 submit + failure', async ({ page }) => {
    const events = await installCollector(page);
    await mockAuth(page, {
      signin: {
        status: 400,
        body: { error: 'invalid_grant', error_code: 'invalid_credentials', msg: 'Invalid login credentials' },
      },
    });
    await page.goto('/auth/login');
    await page.getByLabel('電子郵件').fill('nope@test.io');
    await page.getByLabel('密碼').fill('wrongpass');
    await page.getByRole('button', { name: '登入', exact: true }).click();

    await waitForEvent(events, 'auth_login_submit');
    await waitForEvent(events, 'auth_login_failure');
    expect(events.some((e) => e.event_name === 'auth_login_success')).toBe(false);
  });

  test('signup failure 應送 submit + failure', async ({ page }) => {
    const events = await installCollector(page);
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
    await page.getByRole('button', { name: '建立帳號' }).click();

    await waitForEvent(events, 'auth_signup_submit');
    await waitForEvent(events, 'auth_signup_failure');
    expect(events.some((e) => e.event_name === 'auth_signup_success')).toBe(false);
  });

  test('LINE 登入按鈕應送 auth_login_submit{method:line}', async ({ page }) => {
    const events = await installCollector(page);
    // Prevent actual navigation away — keep page alive so the flush timer fires.
    await page.addInitScript(() => {
      try {
        const proto = Object.getPrototypeOf(window.location);
        Object.defineProperty(proto, 'href', { set: () => {}, get: () => 'http://localhost:8080/auth/login', configurable: true });
      } catch { /* ignore */ }
    });
    await page.goto('/auth/login');
    await page.getByRole('button', { name: /LINE 快速登入/ }).click();

    await waitForEvent(events, 'auth_login_submit');
    const login = events.find((e) => e.event_name === 'auth_login_submit');
    expect(login?.event_props).toMatchObject({ method: 'line' });
  });
});
