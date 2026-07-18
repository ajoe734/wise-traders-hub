import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * SignalDetail 預覽模式 schema 回歸：
 *   1. 頂層 select 只能透過 experts(...,currency) 取 currency，
 *      **絕不能**直接把 `currency` 放在 expert_signals 的 top-level select
 *      → 否則 PostgREST 會回 `column expert_signals.currency does not exist`。
 *   2. 沒有 console error / pageerror 提到該欄位不存在。
 */

const SIGNAL_ID = 'signal-preview-schema-001';
const EXPERT_ID = 'expert-schema-001';
const EXPERT_SLUG = 'schema-master';

const signalRow = {
  id: SIGNAL_ID,
  instrument: 'AAPL Apple',
  action: 'buy',
  price_hint: 210,
  quantity: 10,
  quantity_unit: '股',
  reason_summary: 'schema regression content',
  reason_detail: null,
  risk_notes: null,
  learning_points: null,
  published_at: new Date().toISOString(),
  experts: {
    name: 'Schema Master',
    slug: EXPERT_SLUG,
    role: 'mentor',
    avatar_url: null,
    currency: 'USD',
  },
};

test.use({ viewport: { width: 1280, height: 900 } });

test('SignalDetail 預覽：不會 select expert_signals.currency，也無 schema error', async ({ page }) => {
  const USER_ID = 'admin-user-schema';
  await seedSession(page, { id: USER_ID, email: 'admin@example.com' });

  const expertSignalsSelects: string[] = [];

  await installRoutes(page, {
    rest: {
      profiles: () => [{
        display_name: '系統管理員',
        expert_slug: EXPERT_SLUG,
        avatar_url: null,
        line_user_id: null,
        is_tester: false,
        merged_into_user_id: null,
      }],
      user_roles: () => [{ user_id: USER_ID, role: 'company_admin' }],
      experts: () => [{
        id: EXPERT_ID,
        name: 'Schema Master',
        role: 'mentor',
        slug: EXPERT_SLUG,
        currency: 'USD',
      }],
      expert_signals: ({ method, url }) => {
        if (method === 'GET') {
          const sel = url.searchParams.get('select') || '';
          expertSignalsSelects.push(sel);
        }
        return signalRow;
      },
      subscription_timeline: () => [],
      subscriptions: () => [],
    },
  });

  // 捕捉 console / page errors
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // 網路層攔截：任何回應含 "column expert_signals.currency does not exist" 即記錄
  const schemaErrorResponses: string[] = [];
  page.on('response', async (resp) => {
    const u = resp.url();
    if (!u.includes('/rest/v1/')) return;
    try {
      const text = await resp.text();
      if (text.includes('expert_signals.currency does not exist')) {
        schemaErrorResponses.push(`${resp.status()} ${u}`);
      }
    } catch { /* ignore */ }
  });

  await page.goto(`/app/signal/${SIGNAL_ID}?preview=1`);

  // 等內容渲染，確認至少發過一次 expert_signals 查詢
  await expect(page.getByText('AAPL')).toBeVisible({ timeout: 10_000 });
  expect(expertSignalsSelects.length).toBeGreaterThan(0);

  // === 關鍵斷言 ===
  // (a) select 內不得直接帶 `,currency` 或以 currency 起頭的 top-level 欄位
  //     （currency 只能出現在 experts(...) 巢狀內）
  for (const sel of expertSignalsSelects) {
    // 去掉巢狀 experts(...) 內容後檢查 top-level fields
    const topLevel = sel.replace(/experts\s*\([^)]*\)/g, '');
    const fields = topLevel.split(',').map((s) => s.trim()).filter(Boolean);
    expect(
      fields,
      `expert_signals top-level select 不得包含 currency：${sel}`,
    ).not.toContain('currency');
  }

  // (b) 沒有 schema 錯誤回應
  expect(schemaErrorResponses).toEqual([]);

  // (c) 沒有 console / page error 提到欄位不存在
  const schemaMsg = /expert_signals\.currency does not exist/i;
  expect(consoleErrors.filter((m) => schemaMsg.test(m))).toEqual([]);
  expect(pageErrors.filter((m) => schemaMsg.test(m))).toEqual([]);
});
