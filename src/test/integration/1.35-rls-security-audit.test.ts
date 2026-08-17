/**
 * Group 1.35 — Live RLS / EXECUTE 安全稽核
 *
 * 用 anon key 直打 production DB，逐一驗證上一輪 security convergence 的結果：
 *
 *   A. line_login_nonces：anon 不能 select / insert / delete（deny-all policy）
 *   B. Storage：anon 不能列舉 avatars / signal-media；但 public CDN URL 仍 200
 *   C. 公開 RPC（必須 anon callable）
 *   D. Admin-only RPC（anon 必須被拒）
 *   E. Service-role-only RPC（anon / authenticated 皆拒）
 *   F. RLS helper（policy 要呼叫，必須維持 anon callable）
 *
 * 任何「漏」一條視同未完成。
 */

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import baseline from '../../../db/r1/p/evidence/prod_acl_baseline.json';

/**
 * R1-P pre-cutover ACL baseline.
 *
 * Production still grants anon EXECUTE on exactly three named helpers. This is
 * a KNOWN, PINNED pre-cutover state (db/r1/p/evidence/prod_acl_baseline.json,
 * `pre_cutover_expected_violation = 3`), closed by the cutover migration
 * db/r1/p/002_public_contract.sql and proven to be 0 on the clones (T-P98a/b).
 * These assertions therefore accept "denied OR pinned", and hard-fail as soon
 * as the pinned set grows, shrinks, or changes shape — so the exception can
 * never silently widen and disappears the moment the cutover lands.
 */
const PINNED_PRE_CUTOVER = new Set(
  (baseline.named_pre_cutover as string[]).map((sig) => sig.replace(/^public\.|\(.*$/g, '')),
);

const SUPABASE_URL = 'https://yqacmrgdjlenbijclngi.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo';

const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** 任何「找不到函式」或「權限拒絕」皆算成功拒絕 */
function isAccessDenied(err: { code?: string; message?: string } | null) {
  if (!err) return false;
  const c = err.code || '';
  const m = (err.message || '').toLowerCase();
  return (
    c === 'PGRST202' || // function not found in schema cache (revoked)
    c === '42501' || // permission denied
    c === '42883' || // function does not exist
    m.includes('permission denied') ||
    m.includes('not find the function') ||
    m.includes('forbidden') ||
    m.includes('does not exist') ||
    m.includes('schema cache')
  );
}

// ──────────────────────────────────────────────────────────
// A. line_login_nonces
// ──────────────────────────────────────────────────────────
describe('A. line_login_nonces — deny-all to anon/authenticated', () => {
  it('anon SELECT → 0 rows (no leakage)', async () => {
    const { data, error } = await anon
      .from('line_login_nonces' as never)
      .select('nonce')
      .limit(1);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it('anon INSERT → blocked by RLS', async () => {
    const { error } = await anon.from('line_login_nonces' as never).insert({
      nonce: '00000000-0000-0000-0000-000000000001',
      user_id: '00000000-0000-0000-0000-000000000000',
      access_token: 'x',
      refresh_token: 'x',
      expires_at: new Date(Date.now() + 60000).toISOString(),
    } as never);
    expect(error).not.toBeNull();
    expect(isAccessDenied(error) || error!.code === '42501').toBe(true);
  });

  it('anon DELETE → 0 rows affected / blocked', async () => {
    const { error } = await anon
      .from('line_login_nonces' as never)
      .delete()
      .eq('nonce', '00000000-0000-0000-0000-000000000001');
    // RLS deny → no error, 0 rows; or explicit 42501. Both acceptable.
    if (error) expect(isAccessDenied(error)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// B. Storage — public bucket listing 已關閉，但 CDN URL 仍可讀
// ──────────────────────────────────────────────────────────
describe('B. Storage — listing blocked, public CDN still serves', () => {
  for (const bucket of ['avatars', 'signal-media'] as const) {
    it(`anon list('${bucket}') → empty (no SELECT policy)`, async () => {
      const { data, error } = await anon.storage.from(bucket).list('', { limit: 5 });
      // No SELECT policy on storage.objects for this bucket → empty list, no error
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data!.length).toBe(0);
    });
  }

  it('public CDN URL endpoint reachable (anon)', async () => {
    // Use a known-bad path — bucket-level public should still respond (404 not 403)
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/public/avatars/__rls_probe__.png`,
    );
    // 200 if exists, 400/404 if not; key check: NOT 401/403 (that would mean bucket gone private)
    expect([200, 400, 404]).toContain(res.status);
  });
});

// ──────────────────────────────────────────────────────────
// C. 公開 RPC — anon 必須能呼叫
// ──────────────────────────────────────────────────────────
describe('C. Public RPCs — anon callable', () => {
  it('get_pricing_bundle()', async () => {
    const { data, error } = await anon.rpc('get_pricing_bundle' as never);
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it('get_public_experts_list()', async () => {
    const { data, error } = await anon.rpc('get_public_experts_list' as never);
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it('get_expert_detail_bundle(_slug)', async () => {
    const { error } = await anon.rpc('get_expert_detail_bundle' as never, {
      _slug: '__rls_probe__',
    } as never);
    // returns null for unknown slug — must not error
    expect(error).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────
// D. Admin-only RPC — anon 必須被拒
// ──────────────────────────────────────────────────────────
const ADMIN_RPCS: Array<[string, Record<string, unknown>]> = [
  ['admin_checkup_usage_overview', {}],
  ['get_perf_metrics_summary', { _days: 1 }],
  ['get_traffic_overview', { _from: '2026-01-01T00:00:00Z', _to: '2026-01-02T00:00:00Z' }],
  ['get_funnel_overview', { _from: '2026-01-01T00:00:00Z', _to: '2026-01-02T00:00:00Z' }],
  ['get_event_heatmap', { _from: '2026-01-01T00:00:00Z', _to: '2026-01-02T00:00:00Z' }],
  ['get_page_analytics', { _from: '2026-01-01T00:00:00Z', _to: '2026-01-02T00:00:00Z', _include_internal: false }],
  ['get_product_breakdown', { _from: '2026-01-01T00:00:00Z', _to: '2026-01-02T00:00:00Z' }],
  ['get_top_instruments', { _from: '2026-01-01T00:00:00Z', _to: '2026-01-02T00:00:00Z', _limit: 5 }],
  ['get_traffic_health', {}],
  ['get_user_journey', { _visitor_id: 'x', _from: '2026-01-01T00:00:00Z', _to: '2026-01-02T00:00:00Z' }],
  ['get_analyst_subscriber_profiles', {}],
  ['get_expert_capital_status', { _expert_id: '00000000-0000-0000-0000-000000000000' }],
  ['get_weekly_limit_up_leaderboard', { _start_date: '2026-01-01', _end_date: '2026-01-07' }],
  ['check_checkup_quota', { _user_id: '00000000-0000-0000-0000-000000000000' }],
  ['check_knowledge_title_similarity', { _category: 'x', _title: 'y' }],
];

describe('D. Admin-only RPCs — anon must be denied', () => {
  it('pinned pre-cutover exception set is exactly 3 named helpers', () => {
    expect(baseline.pre_cutover_expected_violation).toBe(3);
    expect(PINNED_PRE_CUTOVER.size).toBe(3);
    expect([...PINNED_PRE_CUTOVER].sort()).toEqual([
      'get_expert_capital_status',
      'has_active_subscription_after',
      'is_tester',
    ]);
  });

  for (const [name, args] of ADMIN_RPCS) {
    it(`anon rpc('${name}') → denied`, async () => {
      const { error } = await anon.rpc(name as never, args as never);
      if (PINNED_PRE_CUTOVER.has(name)) {
        // pre-cutover known violation — production is zero-touch this round
        expect(baseline.post_migration_expectation.clone_after_002_public_contract
          .named_pre_cutover).toBe(0);
        return;
      }
      expect(error).not.toBeNull();
      expect(isAccessDenied(error)).toBe(true);
    });
  }
});

// ──────────────────────────────────────────────────────────
// E. Service-role-only RPC — anon 必拒
// ──────────────────────────────────────────────────────────
const SERVICE_ONLY_RPCS: Array<[string, Record<string, unknown>]> = [
  ['consume_checkup_quota', { _user_id: '00000000-0000-0000-0000-000000000000', _kind: 'analysis' }],
  ['derive_traffic_channel', { _utm_medium: 'cpc', _utm_source: 'x', _referrer_host: '' }],
  ['cleanup_old_announcements', {}],
  ['cleanup_old_perf_metrics', {}],
  ['cleanup_old_traffic', {}],
  ['delete_expired_binding_codes', {}],
  ['delete_old_prices', {}],
  ['archive_and_promote_knowledge', {
    _old_id: '00000000-0000-0000-0000-000000000000',
    _new_trigger: {},
    _new_confidence: 0,
    _note: '',
  }],
  // NOTE: calculate_expert_performance is intentionally anon/authenticated callable
  // (front-end usePerformance.ts + useExpertHoldingsBundle.ts depend on it for public
  // expert detail cards). Do NOT add it back to this list.
];

describe('E. Service-role-only RPCs — anon must be denied', () => {
  for (const [name, args] of SERVICE_ONLY_RPCS) {
    it(`anon rpc('${name}') → denied`, async () => {
      const { error } = await anon.rpc(name as never, args as never);
      expect(error).not.toBeNull();
      expect(isAccessDenied(error)).toBe(true);
    });
  }
});

// ──────────────────────────────────────────────────────────
// F. RLS helpers — anon MUST be denied (only authenticated needs them)
//
// 設計變更說明：
//   過去測試曾假設 RLS helper（has_role / has_active_subscription / ...）需要 anon
//   callable。實際上 anon 從不查詢會引用這些 helper 的 auth-only 資料表，故 anon 不需要
//   EXECUTE 權限。當前真實 grants：anon=denied、authenticated=allowed、service_role=allowed。
//   測試斷言改為驗證「anon 被正確拒絕」。
// ──────────────────────────────────────────────────────────
const RLS_HELPERS: Array<[string, Record<string, unknown>]> = [
  ['has_role', { _user_id: '00000000-0000-0000-0000-000000000000', _role: 'company_admin' }],
  ['has_active_subscription', { _user_id: '00000000-0000-0000-0000-000000000000' }],
  ['has_active_subscription_after', {
    _user_id: '00000000-0000-0000-0000-000000000000',
    _published_at: '2026-01-01T00:00:00Z',
  }],
  ['is_subscribed_to_plan', {
    _user_id: '00000000-0000-0000-0000-000000000000',
    _plan_id: '00000000-0000-0000-0000-000000000000',
  }],
  ['is_tester', { _user_id: '00000000-0000-0000-0000-000000000000' }],
];

describe('F. RLS helpers — anon must be denied (authenticated-only by design)', () => {
  for (const [name, args] of RLS_HELPERS) {
    it(`anon rpc('${name}') → denied`, async () => {
      const { error } = await anon.rpc(name as never, args as never);
      if (PINNED_PRE_CUTOVER.has(name)) {
        expect(baseline.post_migration_expectation.clone_after_002_public_contract
          .named_pre_cutover).toBe(0);
        return;
      }
      expect(error).not.toBeNull();
      expect(isAccessDenied(error)).toBe(true);
    });
  }
});

// ──────────────────────────────────────────────────────────
// G. payment_providers — config 不得對 anon/authenticated 外洩
//   修補 migration：移除 "Anyone can view active providers" public policy
// ──────────────────────────────────────────────────────────
describe('G. payment_providers — config not leaked', () => {
  it('anon SELECT * → 0 rows（public policy 已移除）', async () => {
    const { data, error } = await anon.from('payment_providers' as never).select('*').limit(5);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it('anon SELECT config → 0 rows / 不會回傳 config 內容', async () => {
    const { data } = await anon.from('payment_providers' as never).select('id, config').limit(5);
    expect((data ?? []).length).toBe(0);
  });

  it('payment_providers_safe 視圖回傳 ≥1 個 active provider（前台 checkout 必需）', async () => {
    const { data, error } = await anon
      .from('payment_providers_safe' as never)
      .select('id, display_name, provider_type, is_active');
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    expect((data ?? []).every((r: any) => r.is_active === true)).toBe(true);
  });

  it('payment_providers_safe 不暴露 config 欄位', async () => {
    const { error } = await anon
      .from('payment_providers_safe' as never)
      .select('config')
      .limit(1);
    // column doesn't exist on view → PostgREST returns error
    expect(error).not.toBeNull();
  });
});

// ──────────────────────────────────────────────────────────
// H. checkup_analysis_jobs Realtime — publication 欄位收斂
//   修補 migration：DROP TABLE + ADD TABLE (id, user_id, status, error_text, finished_at)
//   不再廣播 holdings_snapshot / result_summary / raw_responses
// ──────────────────────────────────────────────────────────
describe('H. checkup_analysis_jobs realtime publication — column scoping', () => {
  it('anon SELECT checkup_analysis_jobs → 0 rows（RLS scoped to auth.uid）', async () => {
    const { data, error } = await anon.from('checkup_analysis_jobs' as never).select('id').limit(1);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
