import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * Regression: master-brcto owner 用 ?preview=1 進入週記詳情頁時，
 *  1. 走 Owner Fallback RPC（get_owned_journal_bundle）
 *  2. 不再出現 `column expert_signals.currency does not exist` 錯誤
 *     （RPC / 前端 select 都不得對 expert_signals.currency 直接查詢）
 *  3. currency 從關聯的 experts.currency 帶入，畫面正常渲染
 */

const OWNER_USER_ID = 'brcto-owner-user-id';
const OWNER_EXPERT_ID = 'brcto-expert-uuid';
const OWNER_SLUG = 'master-brcto';
const SIGNAL_ID = 'signal-brcto-001';

const bundleSignal = {
  id: SIGNAL_ID,
  instrument: 'AAPL 蘋果',
  action: 'BUY',
  price_hint: 210,
  quantity: 10,
  quantity_unit: '股',
  currency: 'USD', // 由 experts.currency 帶入，不是 expert_signals 欄位
  reason_summary: 'brcto 預覽測試',
  reason_detail: null,
  risk_notes: null,
  learning_points: null,
  published_at: new Date().toISOString(),
  expert_id: OWNER_EXPERT_ID,
  experts: {
    name: 'Master BRCTO',
    slug: OWNER_SLUG,
    role: 'mentor',
    avatar_url: null,
    currency: 'USD',
  },
};

test.use({ viewport: { width: 1280, height: 900 } });

test('master-brcto owner ?preview=1：Owner Fallback RPC 成功且不觸發 expert_signals.currency 錯誤', async ({ page }) => {
  await seedSession(page, { id: OWNER_USER_ID, email: 'brcto@example.com' });

  // 收集 console error，稍後斷言不含 currency schema 錯誤
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err?.message ?? err)));

  // 記錄所有對 expert_signals 的請求 → select 內不得含 currency
  const badSelectRequests: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/rest/v1/expert_signals')) {
      const u = new URL(url);
      const select = u.searchParams.get('select') ?? '';
      // currency 可以以 experts(currency,...) 巢狀存在，但不能直接出現在頂層 select
      // 用「非巢狀 currency」判斷：出現裸 currency 但不在括號內
      const stripped = select.replace(/\([^)]*\)/g, '');
      if (/\bcurrency\b/.test(stripped)) {
        badSelectRequests.push(select);
      }
    }
  });

  let rpcCalls = 0;
  let rpcPayload: any = null;
  let rlsSignalGets = 0;

  await installRoutes(page, {
    rest: {
      profiles: () => [{
        display_name: 'BRCTO',
        expert_slug: OWNER_SLUG,
        avatar_url: null,
        line_user_id: null,
        is_tester: false,
        merged_into_user_id: null,
      }],
      user_roles: () => [],
      experts: ({ url }) => {
        const slug = url.searchParams.get('slug');
        if (slug?.includes(OWNER_SLUG)) {
          return [{
            id: OWNER_EXPERT_ID,
            name: 'Master BRCTO',
            role: 'mentor',
            slug: OWNER_SLUG,
            currency: 'USD',
          }];
        }
        return [];
      },
      expert_signals: ({ method }) => {
        if (method === 'GET') {
          rlsSignalGets += 1;
          // RLS 模擬讀不到，強制走 owner fallback RPC
          return [];
        }
        return [];
      },
      get_owned_journal_bundle: ({ body }) => {
        rpcCalls += 1;
        rpcPayload = body;
        expect(body?._signal_id).toBe(SIGNAL_ID);
        return {
          signal: bundleSignal,
          weekSignals: [bundleSignal],
        };
      },
      subscription_timeline: () => [],
      subscriptions: () => [],
    },
    functions: {},
  });

  // 模擬「訂閱者預覽」按鈕：帶 previewExpertSlug=master-brcto
  await page.addInitScript((slug) => {
    try { sessionStorage.setItem('previewExpertSlug', slug); } catch {}
  }, OWNER_SLUG);

  await page.goto(`/app/journal/${SIGNAL_ID}?preview=1`);

  // 內容應正常渲染
  await expect(page.getByTestId('journal-detail-instrument').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('AAPL')).toBeVisible();

  // 不應該出現 UnavailableContent
  await expect(page.getByText('這篇週記目前無法顯示')).toHaveCount(0);

  // 診斷區塊：Owner Fallback RPC
  const diag = page.getByTestId('journal-preview-diagnostics');
  await expect(diag).toBeVisible();
  await expect(diag.getByText('Owner Fallback RPC')).toBeVisible();

  // RPC 有觸發
  expect(rpcCalls).toBeGreaterThanOrEqual(1);
  expect(rlsSignalGets).toBeGreaterThanOrEqual(1);
  expect(rpcPayload?._signal_id).toBe(SIGNAL_ID);

  // 關鍵回歸：不能有任何 GET expert_signals?select=...currency... 的頂層 currency
  expect(
    badSelectRequests,
    `expert_signals select 不得直接含 currency 欄位：\n${badSelectRequests.join('\n')}`,
  ).toEqual([]);

  // 關鍵回歸：console 不能出現 column ... currency does not exist
  const currencyErr = consoleErrors.filter((t) =>
    /column\s+.*expert_signals.*currency.*does not exist/i.test(t) ||
    /expert_signals\.currency/i.test(t)
  );
  expect(
    currencyErr,
    `不應再出現 expert_signals.currency 錯誤：\n${currencyErr.join('\n')}`,
  ).toEqual([]);

  // 診斷區塊本身也不能顯示該錯誤字樣
  await expect(diag).not.toContainText('expert_signals.currency');
  await expect(diag).not.toContainText('does not exist');
});
