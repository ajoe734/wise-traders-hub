// checkup-quota-audit — 公司管理員查詢任一用戶的健檢配額稽核資料。
// 回傳：tier 快照 + 最近 N 筆 checkup_usage 扣次紀錄 + 訂閱來源（推斷扣費原因）。
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return json({ error: 'AUTH_REQUIRED' }, 401);
  }

  // 1) 驗證 JWT → 取 callerId
  let callerId = '';
  try {
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: SERVICE_ROLE_KEY },
    });
    if (!ur.ok) {
      return json({ error: 'AUTH_FAILED' }, 401);
    }
    const u = await ur.json();
    callerId = u?.id || '';
  } catch (e) {
    console.error('[quota-audit] getUser failed', e);
    return json({ error: 'AUTH_FAILED' }, 401);
  }
  if (!callerId) return json({ error: 'AUTH_FAILED' }, 401);

  // 2) 檢查 caller 是否 company_admin（用 has_role RPC）
  const roleRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/has_role`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ _user_id: callerId, _role: 'company_admin' }),
  });
  if (!roleRes.ok) {
    return json({ error: 'ROLE_CHECK_FAILED' }, 500);
  }
  const isAdmin = await roleRes.json();
  if (isAdmin !== true) {
    return json({ error: 'FORBIDDEN', message: '僅限公司管理員存取' }, 403);
  }

  // 3) 解析查詢參數
  const url = new URL(req.url);
  let targetUserId = url.searchParams.get('user_id') || '';
  const email = url.searchParams.get('email') || '';
  const limitRaw = Number(url.searchParams.get('limit') || '100');
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);

  if (!targetUserId && !email) {
    return json({ error: 'MISSING_PARAM', message: '請提供 user_id 或 email' }, 400);
  }

  // 若只有 email，先從 auth.users 查
  if (!targetUserId && email) {
    const eRes = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (eRes.ok) {
      const eu = await eRes.json();
      targetUserId = eu?.users?.[0]?.id || '';
    }
    if (!targetUserId) {
      return json({ error: 'USER_NOT_FOUND' }, 404);
    }
  }

  // 4) 平行抓 quota 快照 + 最近扣次 + 最新訂閱
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

  // 推斷「扣費原因」：用當前 quota.tier 對應到訂閱
  const activeSub = (subs as any[]).find(
    (s) => s.status === 'active' && (!s.expires_at || new Date(s.expires_at) > new Date()),
  ) || null;
  const reason = profile?.is_tester
    ? 'tester'
    : activeSub
      ? `subscription:${activeSub.billing_cycle || 'unknown'}`
      : profile?.line_user_id
        ? 'line_free_gift'
        : 'none';

  return json({
    target_user_id: targetUserId,
    profile,
    quota,
    reason,
    usage,
    subscriptions: subs,
    fetched_at: new Date().toISOString(),
  });
});

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
