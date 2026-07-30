// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
import { withLogging, type EdgeLogger } from '../_shared/edgeLogger.ts';
import { validateInput, validationJsonResponse } from '../_shared/inputValidator.ts';
type Action = 'fetch_email' | 'update_email' | 'reset_password' | 'send_reset_email';

Deno.serve(withLogging('update-analyst-credentials', async (req, log) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const siteUrl = Deno.env.get('SITE_URL') || 'https://legendflow.tw';

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return fail('MISSING_AUTHORIZATION', '缺少登入憑證，請重新登入後再試', 401, log);
    }

    // AUTH: company_admin (unified contract — see _shared/adminGuard.ts)
    try {
      await requireCompanyAdmin(req);
    } catch (_e) {
      return fail('FORBIDDEN', '權限不足，僅公司管理員可操作分析師帳號', 403, log);
    }

    const body = await req.json();
    const issues = validateInput({
      fields: {
        expert_id: { required: true, type: 'string', label: 'expert_id' },
        action: { required: true, type: 'string', label: 'action', oneOf: ['fetch_email', 'update_email', 'reset_password', 'send_reset_email'] },
      },
      source: body,
    });
    if (issues.length) return validationJsonResponse(issues);
    const expertId: string = body.expert_id;
    const action: Action = body.action;

    const adminClient = serviceClient();

    // Resolve target user from expert_id
    const { data: expert, error: expertErr } = await adminClient
      .from('experts')
      .select('id, user_id, name')
      .eq('id', expertId)
      .single();
    if (expertErr || !expert) return fail('EXPERT_NOT_FOUND', '找不到該分析師', 404, log, { expert_id: expertId, db_error: expertErr?.message });

    const targetUserId: string = expert.user_id;

    // Prevent admin from operating on themselves via this endpoint
    if (targetUserId === caller.id) {
      return fail('SELF_OPERATION_BLOCKED', '不可對自己的帳號操作，請至「個人設定」修改', 400, log, { expert_id: expertId });
    }

    // Get current auth user
    const { data: targetUserRes, error: getUserErr } = await adminClient.auth.admin.getUserById(targetUserId);
    if (getUserErr || !targetUserRes?.user) return fail('AUTH_USER_NOT_FOUND', '找不到對應的登入帳號', 404, log, { expert_id: expertId, target_user_id: targetUserId, auth_error: getUserErr?.message });
    const targetEmail = targetUserRes.user.email || '';

    // Block operations on virtual LINE emails
    const isLineVirtual = targetEmail.endsWith('@line.local');

    // ── fetch_email ─────────────────────────────────────────────
    if (action === 'fetch_email') {
      return json({
        email: targetEmail,
        is_line_virtual: isLineVirtual,
        expert_name: expert.name,
      });
    }

    // ── update_email ────────────────────────────────────────────
    if (action === 'update_email') {
      if (isLineVirtual) {
        return fail('LINE_VIRTUAL_EMAIL', '此帳號透過 LINE 登入綁定，不可修改 Email', 400, log, { expert_id: expertId });
      }
      const newEmail: string = body.email;
      if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return fail('INVALID_EMAIL', 'Email 格式錯誤', 400, log, { expert_id: expertId });
      }
      if (newEmail.endsWith('@line.local')) {
        return fail('RESERVED_EMAIL_DOMAIN', '不可使用保留網域 @line.local', 400, log, { expert_id: expertId });
      }

      const { error: updErr } = await adminClient.auth.admin.updateUserById(targetUserId, {
        email: newEmail,
        email_confirm: true,
      });
      if (updErr) {
        const code = (updErr as any).code || (updErr as any).error_code || '';
        const status = (updErr as any).status || 400;
        return fail('AUTH_EMAIL_UPDATE_FAILED', translateAuthError(updErr.message, code, status), 400, log, { expert_id: expertId, target_user_id: targetUserId, auth_error: updErr.message, auth_code: code, auth_status: status });
      }

      await adminClient.from('audit_logs').insert({
        actor_id: caller.id,
        action: 'update_analyst_credentials',
        target_type: 'auth_user',
        target_id: targetUserId,
        detail: { sub_action: 'update_email', expert_id: expertId, old_email: targetEmail, new_email: newEmail },
      });

      return json({ success: true, email: newEmail });
    }

    // ── reset_password ──────────────────────────────────────────
    if (action === 'reset_password') {
      const newPassword: string = body.new_password;
      if (!newPassword || newPassword.length < 8) {
        return fail('PASSWORD_TOO_SHORT', '密碼至少需 8 碼', 400, log, { expert_id: expertId });
      }
      if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        return fail('PASSWORD_COMPLEXITY', '密碼需包含英文字母與數字', 400, log, { expert_id: expertId });
      }

      const { error: updErr } = await adminClient.auth.admin.updateUserById(targetUserId, {
        password: newPassword,
      });
      if (updErr) {
        const code = (updErr as any).code || (updErr as any).error_code || '';
        const status = (updErr as any).status || 400;
        return fail('AUTH_PASSWORD_UPDATE_FAILED', translateAuthError(updErr.message, code, status), 400, log, { expert_id: expertId, target_user_id: targetUserId, auth_error: updErr.message, auth_code: code, auth_status: status });
      }

      await adminClient.from('audit_logs').insert({
        actor_id: caller.id,
        action: 'update_analyst_credentials',
        target_type: 'auth_user',
        target_id: targetUserId,
        detail: { sub_action: 'reset_password', expert_id: expertId },
      });

      return json({ success: true });
    }

    // ── send_reset_email ────────────────────────────────────────
    if (action === 'send_reset_email') {
      if (isLineVirtual) {
        return fail('LINE_ACCOUNT_NO_EMAIL', '此帳號透過 LINE 登入，無有效信箱可寄送', 400, log, { expert_id: expertId });
      }
      if (!targetEmail) return fail('TARGET_EMAIL_EMPTY', '帳號無 Email 無法寄送', 400, log, { expert_id: expertId });

      const mailClient = userClient(req);
      const { error: resetErr } = await mailClient.auth.resetPasswordForEmail(targetEmail, {
        options: { redirectTo: `${siteUrl}/reset-password` },
      });
      if (resetErr) return fail('RESET_EMAIL_SEND_FAILED', translateAuthError(resetErr.message), 400, log, { expert_id: expertId, target_user_id: targetUserId, auth_error: resetErr.message });

      await adminClient.from('audit_logs').insert({
        actor_id: caller.id,
        action: 'update_analyst_credentials',
        target_type: 'auth_user',
        target_id: targetUserId,
        detail: { sub_action: 'send_reset_email', expert_id: expertId, sent_to: targetEmail },
      });

      return json({ success: true, sent_to: targetEmail });
    }

    return json({ error: 'Unhandled action' }, 400);
  } catch (err) {
    return fail('INTERNAL_ERROR', '分析師帳號操作暫時失敗，請稍後再試', 500, log, { message: (err as Error).message, stack: (err as Error).stack });
  }
}));

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function fail(code: string, message: string, status: number, log: EdgeLogger, detail?: Record<string, unknown>) {
  log.warn('request_failed', { code, status, ...detail });
  return json({ ok: false, code, error: message, message, request_id: log.requestId }, status);
}

/**
 * 將 Supabase Auth 原始英文錯誤訊息翻譯成中文，並附上「怎麼解」的指引。
 * 對照表來源：Supabase GoTrue / Auth API 常見錯誤碼。
 */
function translateAuthError(raw: string, code = '', status: number | string = ''): string {
  const msg = (raw || '').toLowerCase();
  const c = (code || '').toLowerCase();

  // ── 密碼類 ──────────────────────────────────────────────
  if (c === 'weak_password' || msg.includes('password is known to be weak') || msg.includes('pwned') || msg.includes('weak_password')) {
    return `此密碼過於常見或曾在資料外洩名單中（HIBP 檢查），請改用更獨特的密碼。建議：英文大小寫 + 數字 + 符號 ≥ 12 碼，例如 Lf-Mx7q!92Kp。（原始錯誤：${raw}）`;
  }
  if (c === 'same_password' || msg.includes('new password should be different') || msg.includes('same as the old')) {
    return `新密碼不可與舊密碼相同，請換一組。（原始錯誤：${raw}）`;
  }
  if (msg.includes('password should be at least') || msg.includes('password is too short')) {
    return '密碼長度不足，請至少使用 8 碼以上';
  }
  if (msg.includes('password should contain')) {
    return '密碼複雜度不足，需混合英文大小寫、數字與符號';
  }
  if (msg.includes('new password should be different')) {
    return '新密碼不可與舊密碼相同';
  }
  if (msg.includes('weak_password')) {
    return '密碼強度不足，請改用更複雜的密碼（建議混合英文大小寫、數字與符號）';
  }

  // ── Email 類 ────────────────────────────────────────────
  if (msg.includes('email address') && msg.includes('invalid')) {
    return 'Email 格式錯誤，請確認拼字（例如缺 @ 或網域）';
  }
  if (msg.includes('email address') && (msg.includes('already') || msg.includes('registered') || msg.includes('exists'))) {
    return '此 Email 已被其他帳號使用，請改用其他信箱';
  }
  if (msg.includes('email_address_invalid')) {
    return 'Email 格式無效或網域不被接受';
  }
  if (msg.includes('email_exists') || msg.includes('user already registered')) {
    return '此 Email 已存在於系統，無法重複建立';
  }
  if (msg.includes('signup is disabled') || msg.includes('signups not allowed')) {
    return '系統已停用註冊功能，無法新增帳號';
  }
  if (msg.includes('email not confirmed')) {
    return '對方 Email 尚未驗證，無法執行此操作';
  }
  if (msg.includes('email rate limit') || msg.includes('email_send_rate_limit')) {
    return '寄信次數過於頻繁，請稍候 60 秒後再試';
  }

  // ── 帳號 / 權限 ─────────────────────────────────────────
  if (msg.includes('user not found')) {
    return '找不到對應的使用者帳號';
  }
  if (msg.includes('user_already_exists')) {
    return '使用者已存在';
  }
  if (msg.includes('not_admin') || msg.includes('not allowed') || msg.includes('forbidden')) {
    return '權限不足，僅 company_admin 可執行此操作';
  }
  if (msg.includes('invalid token') || msg.includes('jwt expired') || msg.includes('jwt malformed')) {
    return '登入憑證已失效，請重新登入後再試';
  }
  if (msg.includes('rate limit') || msg.includes('too many requests')) {
    return '操作過於頻繁，請稍候片刻再試';
  }

  // ── 連線 / 服務 ─────────────────────────────────────────
  if (msg.includes('network') || msg.includes('fetch failed') || msg.includes('econn')) {
    return '網路連線異常，請檢查網路後重試';
  }
  if (msg.includes('database') || msg.includes('internal server')) {
    return '後端服務暫時異常，請稍後再試';
  }

  // ── 其他：原樣回傳並附上 code/status，方便直接判斷 ──────
  const tag = [code, status ? `HTTP ${status}` : ''].filter(Boolean).join(' · ');
  return tag ? `操作失敗（${tag}）：${raw}` : `操作失敗：${raw}`;
}

