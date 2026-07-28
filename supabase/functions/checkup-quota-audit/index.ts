// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// checkup-quota-audit — 公司管理員稽核健檢配額。
// 兩種模式：
//   1) 單筆 (mode=single 或省略，需 user_id/email)：回傳 quota 快照 + 該用戶 usage + subs。
//   2) 批次 (mode=list)：依 tier / reason / 日期範圍篩選 checkup_usage，並合併 profile + 最新 sub。
import { corsHeaders } from '../_shared/cors.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { validateInput, validationJsonResponse } from '../_shared/inputValidator.ts';

import { withLogging } from '../_shared/edgeLogger.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

Deno.serve(withLogging('checkup-quota-audit', async (req: Request) => {
  // AUTH: cron (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { requireCronKey(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }

  // OPTIONS preflight handled by withLogging.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'AUTH_REQUIRED' }, 401);

  // verify caller
  let callerId = '';
  try {
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: SERVICE_ROLE_KEY },
    });
    if (!ur.ok) return json({ error: 'AUTH_FAILED' }, 401);
    callerId = (await ur.json())?.id || '';
  } catch (e) {
    console.error('[quota-audit] getUser failed', e);
    return json({ error: 'AUTH_FAILED' }, 401);
  }
  if (!callerId) return json({ error: 'AUTH_FAILED' }, 401);

  // company_admin only
  const roleRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/has_role`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ _user_id: callerId, _role: 'company_admin' }),
  });
  if (!roleRes.ok) return json({ error: 'ROLE_CHECK_FAILED' }, 500);
  if ((await roleRes.json()) !== true) {
    return json({ error: 'FORBIDDEN', message: '僅限公司管理員存取' }, 403);
  }

  const url = new URL(req.url);
  const mode = (url.searchParams.get('mode') || 'single').toLowerCase();

  const issues = validateInput({
    fields: {
      mode: { required: false, type: 'string', label: 'mode', oneOf: ['single', 'list'] },
      user_id: { required: false, type: 'string', label: 'user_id', pattern: /^[0-9a-f-]{36}$/i },
      tier: { required: false, type: 'string', label: 'tier', oneOf: ['line_free', 'none', 'basic', 'pro'] },
      reason: { required: false, type: 'string', label: 'reason', oneOf: ['line_free_gift', 'subscription', 'tester', 'none'] },
    },
    source: {
      mode: url.searchParams.get('mode') || undefined,
      user_id: url.searchParams.get('user_id') || undefined,
      tier: url.searchParams.get('tier') || undefined,
      reason: url.searchParams.get('reason') || undefined,
    },
  });
  if (issues.length) return validationJsonResponse(issues);


  // Audit the admin lookup itself (fire-and-forget, never blocks the response)
  void writeAuditLog(callerId, mode, url).catch((e) =>
    console.warn('[quota-audit] audit log insert failed', e),
  );

  if (mode === 'list') return handleList(url);
  return handleSingle(url);
}));

async function writeAuditLog(actorId: string, mode: string, url: URL) {
  const filters: Record<string, string> = {};
  for (const k of ['user_id', 'email', 'tier', 'reason', 'date_from', 'date_to', 'limit', 'offset']) {
    const v = url.searchParams.get(k);
    if (v) filters[k] = v;
  }
  const targetId =
    mode === 'single' && /^[0-9a-f-]{36}$/i.test(filters.user_id || '') ? filters.user_id : null;
  await fetch(`${SUPABASE_URL}/rest/v1/audit_logs`, {
    method: 'POST',
    headers: { ...jsonHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({
      actor_id: actorId,
      action: 'checkup_quota.audit_query',
      target_type: 'checkup_quota_audit',
      target_id: targetId,
      detail: { mode, filters, at: new Date().toISOString() },
    }),
  });
}

// ---------- single user ----------
async function handleSingle(url: URL) {
  let targetUserId = url.searchParams.get('user_id') || '';
  const email = url.searchParams.get('email') || '';
  const limit = clamp(Number(url.searchParams.get('limit') || '100'), 1, 500);

  if (!targetUserId && !email) {
    return json({ error: 'MISSING_PARAM', message: '請提供 user_id 或 email' }, 400);
  }
  if (!targetUserId && email) {
    targetUserId = await resolveUserIdByEmail(email);
    if (!targetUserId) return json({ error: 'USER_NOT_FOUND' }, 404);
  }

  const [quotaRes, usageRes, subRes, profileRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/rpc/check_checkup_quota`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ _user_id: targetUserId }),
    }),
    fetch(
      `${SUPABASE_URL}/rest/v1/checkup_usage?user_id=eq.${targetUserId}&select=id,kind,used_at&order=used_at.desc&limit=${limit}`,
      { headers: jsonHeaders() },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/checkup_subscriptions?user_id=eq.${targetUserId}&select=id,plan_id,status,billing_cycle,started_at,expires_at,auto_renew,canceled_at&order=started_at.desc&limit=5`,
      { headers: jsonHeaders() },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${targetUserId}&select=user_id,display_name,is_tester,line_user_id`,
      { headers: jsonHeaders() },
    ),
  ]);

  const quota = quotaRes.ok ? await quotaRes.json() : null;
  const usage = usageRes.ok ? await usageRes.json() : [];
  const subs = subRes.ok ? await subRes.json() : [];
  const profile = profileRes.ok ? (await profileRes.json())?.[0] || null : null;
  const reason = inferReason(profile, subs);

  return json({
    target_user_id: targetUserId,
    profile,
    quota,
    reason,
    usage,
    subscriptions: subs,
    fetched_at: new Date().toISOString(),
  });
}

// ---------- batch list ----------
//
// Pagination contract:
//   - Preferred: ?page=1&page_size=50 (page_size capped at MAX_PAGE_SIZE)
//   - Back-compat: ?limit=&offset= still works when page/page_size absent.
//   - Response always includes page, page_size, total, total_pages so the
//     client can render a pager and avoid silent truncation.
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

async function handleList(url: URL) {
  const tier = (url.searchParams.get('tier') || '').trim();           // line_free|none|basic|pro|""
  const reasonFilter = (url.searchParams.get('reason') || '').trim(); // line_free_gift|subscription|tester|none|""
  const dateFrom = url.searchParams.get('date_from') || '';           // ISO
  const dateTo = url.searchParams.get('date_to') || '';

  const pageParam = url.searchParams.get('page');
  const pageSizeParam = url.searchParams.get('page_size');
  let pageSize: number;
  let offset: number;
  let page: number;
  if (pageParam !== null || pageSizeParam !== null) {
    pageSize = clamp(Number(pageSizeParam ?? DEFAULT_PAGE_SIZE), 1, MAX_PAGE_SIZE);
    page = Math.max(1, Math.floor(Number(pageParam ?? '1')) || 1);
    offset = (page - 1) * pageSize;
  } else {
    // legacy limit/offset path
    pageSize = clamp(Number(url.searchParams.get('limit') || String(DEFAULT_PAGE_SIZE)), 1, MAX_PAGE_SIZE);
    offset = clamp(Number(url.searchParams.get('offset') || '0'), 0, 1_000_000);
    page = Math.floor(offset / pageSize) + 1;
  }

  // 1) fetch usage page filtered by date
  const params = new URLSearchParams();
  params.set('select', 'id,user_id,kind,used_at');
  params.set('order', 'used_at.desc');
  params.set('limit', String(pageSize));
  params.set('offset', String(offset));
  if (dateFrom) params.append('used_at', `gte.${dateFrom}`);
  if (dateTo) params.append('used_at', `lte.${dateTo}`);

  const usageRes = await fetch(`${SUPABASE_URL}/rest/v1/checkup_usage?${params}`, {
    headers: { ...jsonHeaders(), Prefer: 'count=exact' },
  });
  if (!usageRes.ok) {
    return json({ error: 'USAGE_QUERY_FAILED', detail: await usageRes.text() }, 500);
  }
  const usageRows: Array<{ id: string; user_id: string; kind: string; used_at: string }> =
    await usageRes.json();
  const totalCount = Number(usageRes.headers.get('content-range')?.split('/')?.[1] || usageRows.length);
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1;

  const uids = Array.from(new Set(usageRows.map((r) => r.user_id))).filter(Boolean);
  if (uids.length === 0) {
    return json({
      rows: [], total: totalCount, returned: 0,
      page, page_size: pageSize, total_pages: totalPages,
      filters: { tier, reason: reasonFilter, date_from: dateFrom, date_to: dateTo },
      fetched_at: new Date().toISOString(),
    });
  }

  // 2) batch fetch profiles + subs + quota snapshots
  const inList = `(${uids.map((u) => `"${u}"`).join(',')})`;
  const [profRes, subsRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=in.${inList}&select=user_id,display_name,is_tester,line_user_id`,
      { headers: jsonHeaders() },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/checkup_subscriptions?user_id=in.${inList}&select=user_id,plan_id,status,billing_cycle,started_at,expires_at,canceled_at&order=started_at.desc`,
      { headers: jsonHeaders() },
    ),
  ]);
  const profiles: any[] = profRes.ok ? await profRes.json() : [];
  const subs: any[] = subsRes.ok ? await subsRes.json() : [];
  const profileByUid = new Map(profiles.map((p) => [p.user_id, p]));
  const subsByUid = new Map<string, any[]>();
  for (const s of subs) {
    if (!subsByUid.has(s.user_id)) subsByUid.set(s.user_id, []);
    subsByUid.get(s.user_id)!.push(s);
  }

  // quota snapshots — parallel but limited
  const quotaMap = new Map<string, any>();
  await Promise.all(
    uids.map(async (uid) => {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_checkup_quota`, {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify({ _user_id: uid }),
        });
        if (r.ok) quotaMap.set(uid, await r.json());
      } catch (_) { /* ignore */ }
    }),
  );

  // 3) compose rows + filter by tier/reason in-memory
  let rows = usageRows.map((u) => {
    const prof = profileByUid.get(u.user_id) || null;
    const userSubs = subsByUid.get(u.user_id) || [];
    const reason = inferReason(prof, userSubs);
    const q = quotaMap.get(u.user_id) || null;
    const activeSub = userSubs.find(
      (s) => s.status === 'active' && (!s.expires_at || new Date(s.expires_at) > new Date()),
    );
    return {
      usage_id: u.id,
      user_id: u.user_id,
      display_name: prof?.display_name || null,
      is_tester: !!prof?.is_tester,
      line_user_id: prof?.line_user_id || null,
      kind: u.kind,
      used_at: u.used_at,
      tier: q?.tier || 'unknown',
      period: q?.period || null,
      used: q?.used ?? null,
      limit: q?.limit ?? null,
      remaining: q?.remaining ?? null,
      last_used_at: q?.last_used_at || null,
      reason,
      billing_cycle: activeSub?.billing_cycle || null,
      plan_id: activeSub?.plan_id || null,
    };
  });

  if (tier) rows = rows.filter((r) => r.tier === tier);
  if (reasonFilter) {
    rows = rows.filter((r) =>
      reasonFilter === 'subscription'
        ? r.reason.startsWith('subscription')
        : r.reason === reasonFilter,
    );
  }

  return json({
    rows,
    total: totalCount,
    returned: rows.length,
    page,
    page_size: pageSize,
    total_pages: totalPages,
    filters: { tier, reason: reasonFilter, date_from: dateFrom, date_to: dateTo },
    fetched_at: new Date().toISOString(),
  });
}

// ---------- helpers ----------
function inferReason(profile: any, subs: any[]): string {
  if (profile?.is_tester) return 'tester';
  const activeSub = (subs || []).find(
    (s) => s.status === 'active' && (!s.expires_at || new Date(s.expires_at) > new Date()),
  );
  if (activeSub) return `subscription:${activeSub.billing_cycle || 'unknown'}`;
  if (profile?.line_user_id) return 'line_free_gift';
  return 'none';
}

async function resolveUserIdByEmail(email: string): Promise<string> {
  const r = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!r.ok) return '';
  const eu = await r.json();
  return eu?.users?.[0]?.id || '';
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  };
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}
