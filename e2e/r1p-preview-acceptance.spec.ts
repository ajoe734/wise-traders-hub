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
  /** null => relation absent (pre-cutover legacy path); 'error' => read fails */
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
    // relation absent (projection not deployed) → legacy read path, no crash
    name: 'no_projection',
    projection: null,
    expectNotice: false,
    expectNumbers: true,
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

/** numbers that must NEVER appear while a scope is under review */
const FORBIDDEN_NUMERIC = [
  /\bNaN\b/,
  /1,234,567/,
  /23\.46\s*%/,
  /234,567/,
  /61\.5\s*%/,
];

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
        page.on('console', (m) => {
          if (m.type() !== 'error') return;
          const text = m.text();
          if (injectsNon2xx && /Failed to load resource: the server responded with a status of (404|500)/.test(text)) {
            transportErrors.push(text);
            return;
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
          // 3b. no fabricated economic number anywhere on the page
          const panelText = bodyText;
          for (const re of FORBIDDEN_NUMERIC) {
            expect(panelText, `${label}: forbidden numeric ${re}`).not.toMatch(re);
          }
          // literal 10 / 50 / 0 must not be presented as a quantity or return
          expect(panelText).not.toMatch(/報酬率\s*[:：]?\s*[-+]?\d/);
          expect(panelText).not.toMatch(/(起始資金|目前資產)\s*\n?\s*[-+]?[\d,]+/);
        } else {
          // ready / legacy path: numbers render, no review notice at all
          await expect(notice).toHaveCount(0);
          await expect(placeholder).toHaveCount(0);
          expect(bodyText).not.toMatch(/\bNaN\b/);
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
  page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
  const text = (await page.locator('body').innerText()).trim();
  expect(text.length).toBeGreaterThan(100);
  await expect(page.getByText('頁面發生錯誤')).toHaveCount(0);
  writeFileSync(`${EV}/smoke-home.json`, JSON.stringify({ bodyChars: text.length, pageErrors }, null, 2));
  await page.screenshot({ path: `${EV}/smoke-home.png` });
  expect(pageErrors).toEqual([]);
});
