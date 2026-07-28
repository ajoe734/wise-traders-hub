// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// apologize-line-free-quota — 對先前免費收盤分析被誤扣的 LINE 登入用戶送出道歉通知。
// 流程：
//   1. 僅 company_admin 可呼叫
//   2. 撈出 profiles.line_user_id IS NOT NULL 的所有用戶
//   3. 撈出 expert_line_channels.is_active=true 的所有 OA (channel_access_token)
//   4. 對每位用戶 × 每個 OA，呼叫 LINE Messaging API push
//        - 200 → 標記送達該 OA，break 不重複推
//        - 非 200（多半 user 非該 OA 好友）→ 試下一個 OA
//   5. 全 OA 都失敗者，寫入 notifications 表做站內公告 fallback
//   6. 整批結果寫入 audit_logs，回傳統計
// 支援 ?dry_run=1 — 只列出將要嘗試的 (user, OA) 組合，不實際呼叫 LINE / 不寫 notifications。
import { corsHeaders } from '../_shared/cors.ts';

import { withLogging } from '../_shared/edgeLogger.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const APOLOGY_TITLE = '【legendflow】免費收盤分析異常 — 致歉與已補償 1 次';
const APOLOGY_BODY = [
  '您好，',
  '',
  '先前您使用 LINE 帳號登入並嘗試「免費一次收盤分析」時，因系統異常導致：',
  '分析結果未成功產出，配額卻被扣抵，造成您無法再次使用。',
  '',
  '我們已完成以下處理：',
  '1. 已修復扣抵邏輯，未來不會再發生相同情況',
  '2. 已將您的「免費一次收盤分析」額度重置 +1 次',
  '',
  '請重新登入後至「我的服務」確認，再次嘗試免費分析：',
  'https://legendflow.tw/auth/login',
  '',
  '造成困擾，誠摯致歉。',
  '',
  '— legendflow 團隊',
].join('\n');

Deno.serve(withLogging('apologize-line-free-quota', async (req: Request) => {
  // OPTIONS preflight handled by withLogging.
  if (req.method !== 'POST' && req.method !== 'GET') {
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
    console.error('[apologize] getUser failed', e);
    return json({ error: 'AUTH_FAILED' }, 401);
  }
  if (!callerId) return json({ error: 'AUTH_FAILED' }, 401);

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
  const dryRun = ['1', 'true', 'yes'].includes((url.searchParams.get('dry_run') || '').toLowerCase());

  // 1. targets
  const targetsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=user_id,display_name,line_user_id&line_user_id=not.is.null`,
    { headers: jsonHeaders() },
  );
  if (!targetsRes.ok) {
    const t = await targetsRes.text();
    return json({ error: 'FETCH_TARGETS_FAILED', detail: t }, 500);
  }
  const targets = (await targetsRes.json()) as Array<{
    user_id: string;
    display_name: string | null;
    line_user_id: string;
  }>;

  // 2. expert OAs
  const oaRes = await fetch(
    `${SUPABASE_URL}/rest/v1/expert_line_channels?select=expert_id,channel_name,line_oa_id,channel_access_token&is_active=eq.true`,
    { headers: jsonHeaders() },
  );
  if (!oaRes.ok) {
    const t = await oaRes.text();
    return json({ error: 'FETCH_OAS_FAILED', detail: t }, 500);
  }
  const oas = (await oaRes.json()) as Array<{
    expert_id: string;
    channel_name: string | null;
    line_oa_id: string | null;
    channel_access_token: string | null;
  }>;
  const validOas = oas.filter((o) => !!o.channel_access_token);

  if (dryRun) {
    return json({
      dry_run: true,
      targets: targets.length,
      oas: validOas.map((o) => ({ channel_name: o.channel_name, line_oa_id: o.line_oa_id })),
      total_attempts: targets.length * validOas.length,
      preview: targets.map((t) => ({
        user_id: t.user_id,
        display_name: t.display_name,
        line_user_id: t.line_user_id,
        will_try_oas: validOas.map((o) => o.channel_name),
      })),
    });
  }

  // 3. push loop
  const details: Array<{
    user_id: string;
    line_user_id: string;
    display_name: string | null;
    delivered_via: string | null;
    fail_reasons: Array<{ oa: string; status: number; body: string }>;
    fallback_notification_id: string | null;
  }> = [];

  let deliveredCount = 0;
  let fallbackCount = 0;

  for (const t of targets) {
    const fails: Array<{ oa: string; status: number; body: string }> = [];
    let delivered: string | null = null;

    for (const oa of validOas) {
      try {
        const r = await fetch('https://api.line.me/v2/bot/message/push', {
          signal: AbortSignal.timeout(10000),
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${oa.channel_access_token}`,
          },
          body: JSON.stringify({
            to: t.line_user_id,
            messages: [{ type: 'text', text: `${APOLOGY_TITLE}\n\n${APOLOGY_BODY}` }],
          }),
        });
        if (r.ok) {
          delivered = oa.channel_name || oa.line_oa_id || oa.expert_id;
          await r.text().catch(() => '');
          break;
        } else {
          const body = await r.text().catch(() => '');
          fails.push({ oa: oa.channel_name || oa.expert_id, status: r.status, body: body.slice(0, 200) });
        }
      } catch (e) {
        fails.push({ oa: oa.channel_name || oa.expert_id, status: 0, body: String(e).slice(0, 200) });
      }
    }

    // 4. fallback: insert station notification
    let notifId: string | null = null;
    if (!delivered) {
      try {
        const ins = await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: 'POST',
          headers: { ...jsonHeaders(), Prefer: 'return=representation' },
          body: JSON.stringify({
            user_id: t.user_id,
            title: APOLOGY_TITLE,
            body: APOLOGY_BODY,
            type: 'system_apology',
            link: '/app/account',
          }),
        });
        if (ins.ok) {
          const arr = await ins.json().catch(() => []);
          notifId = Array.isArray(arr) && arr[0]?.id ? arr[0].id : null;
          fallbackCount++;
        } else {
          const b = await ins.text();
          console.error('[apologize] notification insert failed', t.user_id, ins.status, b);
        }
      } catch (e) {
        console.error('[apologize] notification insert error', t.user_id, e);
      }
    } else {
      deliveredCount++;
    }

    details.push({
      user_id: t.user_id,
      line_user_id: t.line_user_id,
      display_name: t.display_name,
      delivered_via: delivered,
      fail_reasons: fails,
      fallback_notification_id: notifId,
    });
  }

  // 5. audit log
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/audit_logs`, {
      method: 'POST',
      headers: { ...jsonHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        actor_id: callerId,
        action: 'apologize_line_free_quota',
        target_type: 'line_login_users',
        target_id: null,
        detail: {
          total: targets.length,
          delivered: deliveredCount,
          fallback: fallbackCount,
          oas_tried: validOas.map((o) => o.channel_name),
          details,
          at: new Date().toISOString(),
        },
      }),
    });
  } catch (e) {
    console.warn('[apologize] audit log failed', e);
  }

  return json({
    total: targets.length,
    oas_tried: validOas.length,
    delivered: deliveredCount,
    fallback: fallbackCount,
    details,
  });
}));

function json(body: unknown, status = 200) {
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
