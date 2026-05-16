/**
 * Supabase mocking helpers for E2E tests.
 *
 * The preview app uses `@supabase/supabase-js` which:
 *   1. Reads/writes session from `localStorage[sb-{ref}-auth-token]`.
 *   2. Talks to REST at `/rest/v1/*` and Edge Functions at `/functions/v1/*`.
 *
 * We bypass the real backend by:
 *   - Seeding localStorage with a fake session BEFORE the page boots
 *     (`addInitScript` runs before any module code).
 *   - Intercepting all network traffic to the Supabase project and replying
 *     with handler-provided JSON.
 */
import type { Page, Route } from '@playwright/test';

const PROJECT_REF = 'yqacmrgdjlenbijclngi';
const SUPABASE_HOST = `https://${PROJECT_REF}.supabase.co`;
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

// JWT that doesn't validate server-side, but supabase-js trusts the local
// session blob until `expires_at` passes. exp = 2099-01-01.
const FAKE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ0ZXN0LXVzZXItaWQiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImV4cCI6NDA3MDkwODgwMH0.' +
  'sig';

export interface FakeUser {
  id: string;
  email: string;
  role?: 'company_admin' | 'analyst' | null;
}

export async function seedSession(page: Page, user: FakeUser) {
  await page.addInitScript(
    ({ key, jwt, user }) => {
      const session = {
        access_token: jwt,
        refresh_token: 'fake-refresh',
        expires_at: 4070908800, // year 2099
        expires_in: 31_536_000,
        token_type: 'bearer',
        user: {
          id: user.id,
          aud: 'authenticated',
          role: 'authenticated',
          email: user.email,
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      };
      window.localStorage.setItem(key, JSON.stringify(session));
    },
    { key: STORAGE_KEY, jwt: FAKE_JWT, user },
  );
}

export interface RouteHandlers {
  // table name → handler returning rows / single object
  rest?: Record<string, (req: { method: string; url: URL; body: any }) => any>;
  // function name → handler returning JSON body
  functions?: Record<string, (req: { body: any }) => any>;
  // optional callback when /rest/v1/{table} hit (for assertions)
  onRest?: (table: string, method: string) => void;
  onFunction?: (name: string) => void;
}

export async function installRoutes(page: Page, handlers: RouteHandlers) {
  // REST
  await page.route(`${SUPABASE_HOST}/rest/v1/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/rest/v1/', '');
    const table = path.split('?')[0].split('/')[0];
    const method = route.request().method();
    handlers.onRest?.(table, method);

    let body: any = null;
    try { body = route.request().postDataJSON(); } catch { /* ignore */ }

    const handler = handlers.rest?.[table];
    if (!handler) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    const result = handler({ method, url, body });
    if (result instanceof Promise) {
      const resolved = await result;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(resolved ?? null),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result ?? null),
    });
  });

  // Functions
  await page.route(`${SUPABASE_HOST}/functions/v1/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.replace('/functions/v1/', '');
    handlers.onFunction?.(name);
    let body: any = null;
    try { body = route.request().postDataJSON(); } catch { /* ignore */ }
    const handler = handlers.functions?.[name];
    const result = handler ? handler({ body }) : { ok: true };
    const resolved = result instanceof Promise ? await result : result;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resolved ?? {}),
    });
  });

  // Auth — block any real auth calls
  await page.route(`${SUPABASE_HOST}/auth/v1/**`, async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}
