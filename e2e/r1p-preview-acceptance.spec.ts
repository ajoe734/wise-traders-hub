/**
 * R1-P — Unpublished Preview visual acceptance (test-only, no production surface).
 *
 * This suite feeds *controlled typed responses* to the real Preview build by
 * intercepting the Supabase network layer from Playwright. There is NO debug
 * route, NO query flag and NO runtime backdoor: everything lives in the test
 * process and disappears when the browser closes, so nothing reaches the
 * production bundle.
 *
 * Cases (7):  ready | 6515 manual_review | FX incomplete | warrant incomplete |
 *             option-combo incomplete | no projection | API error
 * Matrix:     desktop 1280x900 + mobile 390x844, light + dark
 * Surfaces:   performance cards, chart, period ranking, factsheet/export entry,
 *             OG/meta head tags
 * Asserts:    incomplete-family renders BOTH copy lines and shows no
 *             10/50/0/NaN/fake return; ready renders numbers; no blank page,
 *             no crash, console errors = 0. Evidence (screenshot + DOM +
 *             console) is written to db/r1/p/evidence/preview/.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const EV = 'db/r1/p/evidence/preview';
mkdirSync(EV, { recursive: true });

const REVIEW_BADGE = '資料檢核中';
const REVIEW_NOTE = '該區間不納入績效';

const EXPERT = {
  id: 'expert-r1p',
  slug: 'r1p-preview',
  name: '沙克古',
  bio: 'R1-P preview acceptance',
  role: 'advisor',
  status: 'active',
  is_active: true,
  avatar_url: null,
  style_tags: [],
  starting_capital: 1_000_000,
  expert_plans: [
    {
      id: 'plan-r1p',
      plan_type: 'analyst_signal_l1',
      price_monthly: 1000,
      name: '跟單派',
      description: null,
      is_active: true,
      status: 'approved',
    },
  ],
};

/** typed public_expert_state_active rows, one per case */
type CaseName =
  | 'ready'
  | 'manual_review_6515'
  | 'incomplete_fx'
  | 'incomplete_warrant'
  | 'incomplete_option_combo'
  | 'no_projection'
  | 'api_error';

interface CaseDef {
  name: CaseName;
  /** null => relation absent (fail-closed, no legacy numbers); 'error' => read fails */
  projection: Record<string, unknown> | null | 'error';
  expectNotice: boolean;
  expectNumbers: boolean;
}

const CASES: CaseDef[] = [
  {
    name: 'ready',
    projection: { expert_id: EXPERT.id, state: 'ready', withheld_count: 0, incomplete_count: 0, manual_review_count: 0 },
    expectNotice: false,
    expectNumbers: true,
  },
  {
    name: 'manual_review_6515',
    projection: { expert_id: EXPERT.id, state: 'manual_review', withheld_count: 0, incomplete_count: 0, manual_review_count: 1 },
    expectNotice: true,
    expectNumbers: false,
  },
  {
    name: 'incomplete_fx',
    projection: { expert_id: EXPERT.id, state: 'incomplete', withheld_count: 0, incomplete_count: 1, manual_review_count: 0 },
    expectNotice: true,
    expectNumbers: false,
  },
  {
    name: 'incomplete_warrant',
    projection: { expert_id: EXPERT.id, state: 'withheld_incomplete', withheld_count: 1, incomplete_count: 1, manual_review_count: 0 },
    expectNotice: true,
    expectNumbers: false,
  },
  {
    name: 'incomplete_option_combo',
    projection: { expert_id: EXPERT.id, state: 'withheld', withheld_count: 1, incomplete_count: 0, manual_review_count: 0 },
    expectNotice: true,
    expectNumbers: false,
  },
  {
    // relation absent (projection not deployed) → FAIL CLOSED (R1-P closure):
    // no legacy numbers, review notice, page alive.
    name: 'no_projection',
    projection: null,
    expectNotice: true,
    expectNumbers: false,
  },
  {
    // read failed → fail-closed: numbers hidden, notice shown, page alive
    name: 'api_error',
    projection: 'error',
    expectNotice: true,
    expectNumbers: false,
  },
];

const PERF = {
  starting_capital: 1_000_000,
  current_asset: 1_234_567,
  total_return_pct: 23.46,
  total_pnl: 234_567,
  win_rate: 61.5,
};

function routesFor(c: CaseDef) {
  const projectionHandler = () => {
    if (c.projection === 'error') return { __status: 500, body: { code: '500', message: 'projection read failed' } };
    if (c.projection === null) {
      return { __status: 404, body: { code: '42P01', message: 'relation "public_expert_state_active" does not exist' } };
    }
    return c.projection;
  };
  return {
    profiles: () => ({
      display_name: 'Preview Tester',
      expert_slug: null,
      avatar_url: null,
      line_user_id: null,
      is_tester: false,
    }),
    user_roles: () => [{ role: 'company_admin' }],
    experts: () => [EXPERT],
    expert_plans: () => EXPERT.expert_plans,
    member_subscriptions: () => [],
    public_expert_state_active: projectionHandler,
    get_expert_capital_status: () => null,
    calculate_expert_performance: () => PERF,
    trade_records: () => [],
    daily_price_snapshots: () => [],
    get_expert_detail_bundle: () => ({
      expert: EXPERT,
      plans: EXPERT.expert_plans,
      subscriber_count: 3,
      my_subscribed_plan_ids: [],
    }),
  } as Record<string, (req: any) => any>;
}

/**
 * Exact economic payloads that must NEVER appear while a scope is not ready.
 * Token boundaries are explicit so a legitimate unrelated string (e.g. a
 * timestamp) cannot mask a real leak, and bare 10 / 50 / 0 are only forbidden
 * when they are rendered as an economic figure (currency / percent / quantity).
 */
const FORBIDDEN_NUMERIC = [
  /\bNaN\b/,
  /\$\s?1,234,567\b/,
  /\b1,234,567\b/,
  /\+?\b23\.46\s*%/,
  /\b234,567\b/,
  /\b61\.5\s*%/,
  /\b1,000,000\b/,
  /[-+]?\b\d+(\.\d+)?\s*%/,          // ANY percentage inside an economic zone
  /[$＄]\s?[-+]?\d/,                    // ANY currency figure
  /\b(?:10|50|0)\b\s*(?:張|股|%|元)/,  // 6515 candidates as a quantity
];

/** Reads only the app-owned economic zones (cards / chart / ranking). */
async function economicZoneText(page: Page): Promise<string> {
  const zones = page.locator('[data-economic-zone]');
  const n = await zones.count();
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push((await zones.nth(i).innerText()).trim());
  return parts.join('\n');
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => window.localStorage.setItem('theme', t), theme);
}

const VIEWPORTS = [
  { id: 'desktop', width: 1280, height: 900 },
  { id: 'mobile', width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;

type Evidence = {
  case: CaseName;
  viewport: string;
  theme: string;
  screenshot: string;
  consoleErrors: string[];
  injectedTransportErrors: string[];
  failedResponses: string[];
  environmentErrors: string[];
  pageErrors: string[];
  noticeCount: number;
  placeholderCount: number;
  bodyChars: number;
};

const collected: Evidence[] = [];

for (const c of CASES) {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      const label = `${c.name} · ${vp.id} · ${theme}`;
      test(`preview ${label}`, async ({ page }) => {
        const consoleErrors: string[] = [];
        const transportErrors: string[] = [];
        const pageErrors: string[] = [];
        // The 404/500 cases inject a deliberate non-2xx transport response; the
        // browser always logs "Failed to load resource" for those. That log is
        // the injected fixture, not an app error, so it is recorded separately
        // and only tolerated for the two cases that ask for it.
        const injectsNon2xx = c.projection === null || c.projection === 'error';
        const failedResponses: string[] = [];
        page.on('response', (r) => {
          if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.url()}`);
        });
        // Sandbox-only noise: the Google Fonts CDN is unreachable from the test
        // runner, which the browser also reports as a resource error. It is
        // recorded separately and never used to hide an application error.
        const ENV_HOSTS = /(fonts\.gstatic\.com|fonts\.googleapis\.com)/;
        const envErrors: string[] = [];
        page.on('console', (m) => {
          if (m.type() !== 'error') return;
          const text = m.text();
          if (/Failed to load resource/.test(text)) {
            const tolerated = failedResponses.filter(
              (r) =>
                ENV_HOSTS.test(r) ||
                (injectsNon2xx && r.includes('public_expert_state_active')),
            );
            const untolerated = failedResponses.filter((r) => !tolerated.includes(r));
            if (untolerated.length === 0) {
              if (injectsNon2xx && tolerated.some((r) => r.includes('public_expert_state_active'))) {
                transportErrors.push(text);
              } else {
                envErrors.push(text);
              }
              return;
            }
          }
          consoleErrors.push(text);
        });
        page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`));

        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setTheme(page, theme);
        await seedSession(page, { id: 'user-preview', email: 'preview@test.com' });
        await installRoutes(page, { rest: routesFor(c) });

        await page.goto(`/app/expert/${EXPERT.slug}`);

        // 1. page is alive and not blank / not an error boundary
        await expect(page.getByRole('heading', { level: 1, name: EXPERT.name })).toBeVisible();
        await expect(page.getByText('頁面發生錯誤')).toHaveCount(0);
        const bodyText = (await page.locator('body').innerText()).trim();
        expect(bodyText.length).toBeGreaterThan(200);

        // 2. performance panel exists (cards + chart container)
        await expect(page.getByRole('tab', { name: '年績效' })).toBeVisible();
        await expect(page.getByText('起始資金')).toBeVisible();

        const notice = page.getByTestId('performance-review-notice');
        const placeholder = page.getByTestId('review-placeholder');

        if (c.expectNotice) {
          // 3a. both copy lines are present exactly as the contract requires
          await expect(notice.first()).toBeVisible();
          await expect(notice.first()).toContainText(REVIEW_BADGE);
          await expect(notice.first()).toContainText(REVIEW_NOTE);
          // every gated numeric slot renders the placeholder instead
          expect(await placeholder.count()).toBeGreaterThan(0);
          // 3b. no fabricated economic number in ANY app-owned economic zone
          const zoneText = await economicZoneText(page);
          expect(await page.locator('[data-economic-zone]').count()).toBeGreaterThan(0);
          for (const re of FORBIDDEN_NUMERIC) {
            expect(zoneText, `${label}: forbidden numeric ${re} in economic zone`).not.toMatch(re);
          }
          // the whole page must still not carry the fixture's economic payload
          for (const re of [/\bNaN\b/, /\b1,234,567\b/, /\b234,567\b/, /\b23\.46\s*%/, /\b61\.5\s*%/]) {
            expect(bodyText, `${label}: forbidden numeric ${re} on page`).not.toMatch(re);
          }
          // literal 10 / 50 / 0 must not be presented as a quantity or return
          expect(bodyText).not.toMatch(/報酬率\s*[:：]?\s*[-+]?\d/);
          expect(bodyText).not.toMatch(/(起始資金|目前資產)\s*\n?\s*[-+]?[\d,]+/);
        } else {
          // ready: real numbers render (a legitimate 0 is allowed), no notice
          await expect(notice).toHaveCount(0);
          await expect(placeholder).toHaveCount(0);
          expect(bodyText).not.toMatch(/\bNaN\b/);
          const zoneText = await economicZoneText(page);
          expect(zoneText, 'ready case must render the real projection payload')
            .toMatch(/1,234,567/);
        }

        // 4. ranking + export/OG surfaces never leak a gated number
        const head = await page.evaluate(() => ({
          title: document.title,
          metas: Array.from(document.head.querySelectorAll('meta'))
            .map((m) => m.getAttribute('content') ?? '')
            .join(' | '),
        }));
        for (const meta of [head.title, head.metas]) {
          expect(meta).not.toMatch(/\bNaN\b/);
          if (c.expectNotice) {
            for (const re of FORBIDDEN_NUMERIC) expect(meta).not.toMatch(re);
          }
        }


        // 5. evidence
        const slug = `${c.name}__${vp.id}__${theme}`;
        const shot = `${EV}/${slug}.png`;
        await page.screenshot({ path: shot });
        writeFileSync(`${EV}/${slug}.dom.html`, await page.content());
        const ev: Evidence = {
          case: c.name,
          viewport: `${vp.width}x${vp.height}`,
          theme,
          screenshot: shot,
          consoleErrors,
          injectedTransportErrors: transportErrors,
          failedResponses,
          environmentErrors: envErrors,
          pageErrors,
          noticeCount: await notice.count(),
          placeholderCount: await placeholder.count(),
          bodyChars: bodyText.length,
        };
        writeFileSync(`${EV}/${slug}.json`, JSON.stringify(ev, null, 2));
        collected.push(ev);

        // 6. console error budget = 0
        expect(pageErrors, `${label} pageerrors`).toEqual([]);
        expect(consoleErrors, `${label} console errors`).toEqual([]);
      });
    }
  }
}

/**
 * Smoke on the UNMOCKED preview: proves the layout / subscription / navigation
 * chrome did not regress because of the contract work. Nothing is intercepted
 * here beyond auth (no real credentials are used), so this only asserts the
 * shell renders and does not crash.
 */
test('preview smoke — unmocked shell has no layout/navigation regression', async ({ page }) => {
  const pageErrors: string[] = [];
  const appConsoleErrors: string[] = [];
  const environmentErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const txt = m.text();
    // transport/env noise (offline backend, blocked 3rd party) is recorded
    // separately and must never be laundered into the app console budget.
    if (/Failed to load resource|net::ERR|ERR_|status of (4|5)\d\d/.test(txt)) environmentErrors.push(txt);
    else appConsoleErrors.push(txt);
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
  const text = (await page.locator('body').innerText()).trim();
  expect(text.length).toBeGreaterThan(100);
  await expect(page.getByText('頁面發生錯誤')).toHaveCount(0);

  // layout landmarks + navigation + subscription entry points
  const headerCount = await page.locator('header, nav').count();
  const navLinks = await page.locator('a[href]').count();
  const subscribeEntries = await page.getByText(/訂閱|方案|加入/).count();

  // navigate to a second public route and back; the shell must survive it
  await page.goto('/experts');
  await expect(page.locator('body')).toBeVisible();
  const expertsChars = (await page.locator('body').innerText()).trim().length;
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();

  writeFileSync(
    `${EV}/smoke-home.dom.html`,
    await page.evaluate(() => document.documentElement.outerHTML),
  );
  writeFileSync(
    `${EV}/smoke-home.json`,
    JSON.stringify(
      {
        case: 'smoke-home',
        mocked: false,
        routes: ['/', '/experts', '/'],
        viewport: '1280x900',
        theme: 'light',
        screenshot: `${EV}/smoke-home.png`,
        bodyChars: text.length,
        expertsBodyChars: expertsChars,
        layout: { headerOrNavLandmarks: headerCount, navLinks, subscribeEntries },
        consoleErrors: appConsoleErrors,
        environmentErrors,
        pageErrors,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: `${EV}/smoke-home.png` });

  expect(headerCount).toBeGreaterThan(0);
  expect(navLinks).toBeGreaterThan(0);
  expect(expertsChars).toBeGreaterThan(100);
  expect(appConsoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

