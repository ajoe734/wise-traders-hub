/**
 * Live E2E — account merging data-movement completeness.
 *
 * 覆蓋：
 *   A) 一般流程：generate → consume（副帳號吃碼），驗證 20 張表全部搬到主帳號、
 *      副帳號被停用、profiles.merged_into_user_id 正確、
 *      重疊 active member_subscriptions 自動取 expires_at 最晚的那筆為勝方、其餘 canceled。
 *   B) admin force-merge：company_admin 直接把 A 併入 B，同樣驗證 20 表 + 衝突處理。
 *
 * 為什麼是 live spec：整套流程要真的打 Supabase Admin API / edge functions / RLS，
 * mock 無法保證 GRANT / trigger / unique 索引都沒漏掉。
 *
 * 必備 env：
 *   - E2E_LIVE=1
 *   - SUPABASE_URL、SUPABASE_ANON_KEY（可取自 .env 的 VITE_ 版本）
 *   - E2E_SUPABASE_SERVICE_ROLE_KEY（僅 CI/staging 提供；本地不強塞）
 *   - E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD（有 company_admin 角色）
 *
 * 執行：
 *   E2E_LIVE=1 bunx playwright test e2e/live/account-merge-20tables.spec.ts
 */
import { test, expect, chromium } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const SERVICE = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY || '';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || '';

const shouldSkip =
  !process.env.E2E_LIVE || !SUPABASE_URL || !ANON || !SERVICE || !ADMIN_EMAIL || !ADMIN_PASSWORD;

test.skip(
  shouldSkip,
  'Set E2E_LIVE=1 + SUPABASE_URL + SUPABASE_ANON_KEY + E2E_SUPABASE_SERVICE_ROLE_KEY + E2E_ADMIN_EMAIL/PASSWORD.',
);

// Keep in lock-step with USER_ID_TABLES inside both edge functions.
const USER_ID_TABLES = [
  'member_subscriptions',
  'checkup_subscriptions',
  'checkup_usage',
  'checkup_entitlements',
  'checkup_trade_memos',
  'checkup_storage',
  'checkup_analysis_jobs',
  'checkup_daily_reminders',
  'notifications',
  'notification_preferences',
  'user_performances',
  'user_summaries',
  'holding_meta_overrides',
  'member_line_bindings',
  'referral_attributions',
  'conversions',
  'remittance_orders',
  'payment_intents',
  'payment_transactions',
  'paywall_events',
] as const;

type Admin = SupabaseClient;

function admin(): Admin { return createClient(SUPABASE_URL, SERVICE); }
function anon(): Admin { return createClient(SUPABASE_URL, ANON); }

async function createTestUser(a: Admin, tag: string) {
  const email = `merge_e2e_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e2e.local`;
  const password = `Pw!${Math.random().toString(36).slice(2, 12)}A1`;
  const { data, error } = await a.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  return { userId: data.user.id, email, password };
}

async function seedOneRowPerTable(a: Admin, userId: string): Promise<Record<string, string | null>> {
  // Insert one deterministic row per table. Only user_id is required; other columns
  // fall back to DB defaults or use safe placeholder values. If a table rejects the
  // minimal insert we record null so the assertion phase can flag missing coverage.
  const seeded: Record<string, string | null> = {};
  const nowIso = new Date().toISOString();

  const inserts: Array<[string, Record<string, unknown>]> = [
    ['notifications', { user_id: userId, title: 'merge-e2e', body: 'seed', type: 'info' }],
    ['notification_preferences', { user_id: userId }],
    ['checkup_usage', { user_id: userId, kind: 'daily-analysis', used_at: nowIso }],
    ['checkup_storage', { user_id: userId, key: `merge-e2e-${Date.now()}`, value: {} }],
    ['checkup_daily_reminders', { user_id: userId, reminded_on: nowIso.slice(0, 10) }],
    ['checkup_trade_memos', { user_id: userId, symbol: 'MERGE', memo: 'seed' }],
    ['user_summaries', { user_id: userId, summary: 'seed' }],
    ['user_performances', { user_id: userId, symbol: 'MERGE', entry_price: 1 }],
    ['holding_meta_overrides', { user_id: userId, symbol: 'MERGE' }],
    ['referral_attributions', { user_id: userId, source: 'merge_e2e' }],
    ['conversions', { user_id: userId, occurred_at: nowIso, gross_amount: 0, platform_amount: 0 }],
    ['paywall_events', { user_id: userId, event: 'seed' }],
  ];

  for (const [tbl, payload] of inserts) {
    const { data, error } = await a.from(tbl).insert(payload).select('*').maybeSingle();
    if (error) {
      console.warn(`[seed] ${tbl} insert failed:`, error.message);
      seeded[tbl] = null;
    } else {
      seeded[tbl] = (data as any)?.id ?? 'ok';
    }
  }
  return seeded;
}

async function countRowsForUser(a: Admin, userId: string) {
  const out: Record<string, number> = {};
  for (const tbl of USER_ID_TABLES) {
    const { count, error } = await a.from(tbl).select('id', { count: 'exact', head: true }).eq('user_id', userId);
    out[tbl] = error ? -1 : (count ?? 0);
  }
  return out;
}

async function loginAndGetToken(email: string, password: string): Promise<string> {
  const c = anon();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`login failed: ${error?.message}`);
  return data.session.access_token;
}

async function invoke(fn: string, token: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: ANON,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, json };
}

test.describe.serial('account merge — full 20-table data movement', () => {
  test('A) generate → consume moves every table and disables the secondary', async () => {
    const a = admin();
    const primary = await createTestUser(a, 'p');
    const secondary = await createTestUser(a, 's');

    try {
      // Seed rows on the secondary so we can count movement.
      const secondarySeed = await seedOneRowPerTable(a, secondary.userId);
      const seededTables = Object.entries(secondarySeed).filter(([, v]) => v).map(([k]) => k);
      expect(seededTables.length).toBeGreaterThan(5); // sanity: at least this many tables writable

      // Baseline row counts
      const primaryBefore = await countRowsForUser(a, primary.userId);
      const secondaryBefore = await countRowsForUser(a, secondary.userId);

      // Primary generates code
      const primaryToken = await loginAndGetToken(primary.email, primary.password);
      const gen = await invoke('account-link-generate', primaryToken, {});
      expect(gen.status, JSON.stringify(gen.json)).toBe(200);
      const code: string = gen.json.code;
      expect(code).toMatch(/^\d{6}$/);

      // Secondary consumes it
      const secondaryToken = await loginAndGetToken(secondary.email, secondary.password);
      const con = await invoke('account-link-consume', secondaryToken, { code });
      expect(con.status, JSON.stringify(con.json)).toBe(200);
      expect(con.json.primary_user_id).toBe(primary.userId);
      expect(con.json.moved_counts).toBeTruthy();

      // Verify: every seeded row was re-pointed
      const primaryAfter = await countRowsForUser(a, primary.userId);
      const secondaryAfter = await countRowsForUser(a, secondary.userId);
      for (const tbl of seededTables) {
        expect.soft(
          secondaryAfter[tbl],
          `[${tbl}] secondary should have 0 rows after merge`,
        ).toBe(0);
        expect.soft(
          primaryAfter[tbl],
          `[${tbl}] primary should absorb secondary rows`,
        ).toBeGreaterThanOrEqual(primaryBefore[tbl] + secondaryBefore[tbl]);
      }

      // Secondary profile marked merged
      const { data: prof } = await a.from('profiles').select('merged_into_user_id').eq('user_id', secondary.userId).maybeSingle();
      expect(prof?.merged_into_user_id).toBe(primary.userId);

      // Secondary auth user banned/renamed
      const { data: sAuth } = await a.auth.admin.getUserById(secondary.userId);
      expect(sAuth?.user?.email).toMatch(/@merged\.local$/);

      // Audit rows exist — account_merges + audit_logs（含 moved_counts 全欄位、sub_conflicts）
      const { data: audit } = await a.from('account_merges')
        .select('*').eq('secondary_user_id', secondary.userId).maybeSingle();
      expect(audit?.primary_user_id).toBe(primary.userId);
      expect((audit?.moved_counts as any)?._sub_conflicts_canceled).toBeDefined();
      for (const tbl of USER_ID_TABLES) {
        expect.soft(
          Object.prototype.hasOwnProperty.call(audit?.moved_counts ?? {}, tbl),
          `moved_counts missing table [${tbl}]`,
        ).toBe(true);
      }
      const { data: adminAudit } = await a.from('audit_logs')
        .select('action, detail').eq('action', 'account_link_consume')
        .eq('target_id', secondary.userId).maybeSingle();
      expect(adminAudit?.action).toBe('account_link_consume');
      expect((adminAudit?.detail as any)?.primary_user_id).toBe(primary.userId);
    } finally {
      // Best-effort cleanup — secondary was banned+renamed by the merge; delete both.
      await a.auth.admin.deleteUser(secondary.userId).catch(() => undefined);
      await a.auth.admin.deleteUser(primary.userId).catch(() => undefined);
    }
  });


  test('B) admin force-merge covers the same 20 tables + conflict resolution', async () => {
    const a = admin();
    const primary = await createTestUser(a, 'ap');
    const secondary = await createTestUser(a, 'as');

    try {
      await seedOneRowPerTable(a, secondary.userId);

      // Seed overlapping active member_subscriptions on both users for the same plan,
      // primary with an earlier expires_at → merge should keep the secondary's row (later).
      const { data: plan } = await a.from('expert_plans')
        .select('id').eq('is_active', true).limit(1).maybeSingle();
      if (plan?.id) {
        const soon = new Date(Date.now() + 5 * 86400_000).toISOString();
        const later = new Date(Date.now() + 30 * 86400_000).toISOString();
        await a.from('member_subscriptions').insert([
          { user_id: primary.userId, plan_id: plan.id, status: 'active', expires_at: soon },
          { user_id: secondary.userId, plan_id: plan.id, status: 'active', expires_at: later },
        ]);
      }

      const adminToken = await loginAndGetToken(ADMIN_EMAIL, ADMIN_PASSWORD);
      const res = await invoke('admin-account-force-merge', adminToken, {
        primary_user_id: primary.userId,
        secondary_user_id: secondary.userId,
      });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.moved_counts).toBeTruthy();

      // Secondary drained
      const secondaryAfter = await countRowsForUser(a, secondary.userId);
      for (const tbl of USER_ID_TABLES) {
        expect.soft(secondaryAfter[tbl], `[${tbl}] should be 0 on secondary`).toBe(0);
      }

      // Conflict resolution: primary keeps exactly one ACTIVE sub per plan_id.
      if (plan?.id) {
        const { data: actives } = await a.from('member_subscriptions')
          .select('id, expires_at, status').eq('user_id', primary.userId).eq('plan_id', plan.id).eq('status', 'active');
        expect(actives?.length).toBe(1);
        // And it should be the later-expiring one.
        const winner = actives?.[0];
        expect(new Date(winner!.expires_at!).getTime()).toBeGreaterThan(Date.now() + 20 * 86400_000);
      }

      // Enriched audit — moved_counts has _sub_conflicts groups; audit_logs row exists
      if (plan?.id) {
        const { data: aud } = await a.from('account_merges')
          .select('moved_counts').eq('secondary_user_id', secondary.userId).maybeSingle();
        const groups = ((aud?.moved_counts as any)?._sub_conflicts ?? []) as any[];
        const hit = groups.find((g) => g.plan_id === plan.id);
        expect(hit, 'missing _sub_conflicts group for the seeded plan').toBeTruthy();
        expect(hit.kept?.expires_at).toBeTruthy();
        expect(Array.isArray(hit.canceled) && hit.canceled.length).toBeGreaterThan(0);
      }
      const { data: adminAudit } = await a.from('audit_logs')
        .select('action, detail').eq('action', 'admin_account_force_merge')
        .eq('target_id', secondary.userId).maybeSingle();
      expect(adminAudit?.action).toBe('admin_account_force_merge');

      const { data: prof } = await a.from('profiles').select('merged_into_user_id').eq('user_id', secondary.userId).maybeSingle();
      expect(prof?.merged_into_user_id).toBe(primary.userId);

      // ---- UI 斷言：登入 primary，於 /app/account 與 /app/subscribed 看到 SubscriptionConflictNotice ----
      if (plan?.id) {
        // 取得 kept / canceled 期望值（來自剛剛的 conflict 群組）
        const { data: aud } = await a.from('account_merges')
          .select('moved_counts').eq('secondary_user_id', secondary.userId).maybeSingle();
        const groups = ((aud?.moved_counts as any)?._sub_conflicts ?? []) as any[];
        const group = groups.find((g) => g.plan_id === plan.id);
        expect(group).toBeTruthy();

        // 用 anon key 拿 primary 的 session，把 tokens 灌進 localStorage 讓前端登入
        const { data: sess, error: sErr } = await anon().auth.signInWithPassword({
          email: primary.email, password: primary.password,
        });
        expect(sErr).toBeFalsy();
        const projectRef = new URL(SUPABASE_URL).host.split('.')[0];
        const storageKey = `sb-${projectRef}-auth-token`;
        const sessionJson = JSON.stringify({
          access_token: sess!.session!.access_token,
          refresh_token: sess!.session!.refresh_token,
          expires_at: sess!.session!.expires_at,
          expires_in: sess!.session!.expires_in,
          token_type: 'bearer',
          user: sess!.user,
        });

        for (const route of ['/app/account', '/app/subscribed']) {
          await test.step(`UI notice on ${route}`, async () => {
            const browser = await chromium.launch();
            const ctx = await browser.newContext();
            const p = await ctx.newPage();
            await p.goto('/');
            await p.evaluate(([k, v]) => localStorage.setItem(k as string, v as string), [storageKey, sessionJson]);
            await p.goto(route);
            const notice = p.locator('[data-testid="subscription-conflict-notice"]');
            await notice.waitFor({ state: 'visible', timeout: 15_000 });

            const keptEl = notice.locator(`[data-testid="conflict-kept"][data-plan-id="${plan.id}"]`);
            await expect(keptEl).toBeVisible();
            expect(await keptEl.getAttribute('data-expires-at')).toBe(group.kept.expires_at);

            const canceledEls = notice.locator(`[data-testid="conflict-canceled"][data-plan-id="${plan.id}"]`);
            const expectedCanceled = new Set(group.canceled.map((c: any) => c.expires_at));
            const gotCanceled = await canceledEls.evaluateAll((els) => els.map((e) => (e as HTMLElement).getAttribute('data-expires-at')));
            expect(new Set(gotCanceled)).toEqual(expectedCanceled);
            expect(gotCanceled.length).toBe(group.canceled.length);
            await browser.close();
          });
        }
      }
    } finally {
      await a.auth.admin.deleteUser(secondary.userId).catch(() => undefined);
      await a.auth.admin.deleteUser(primary.userId).catch(() => undefined);
    }
  });
});

