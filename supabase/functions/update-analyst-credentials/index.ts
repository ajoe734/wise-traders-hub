import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Action = 'fetch_email' | 'update_email' | 'reset_password' | 'send_reset_email';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const siteUrl = Deno.env.get('SITE_URL') || 'https://legendflow.tw';

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing authorization' }, 401);
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return json({ error: 'Unauthorized' }, 401);

    const { data: roleCheck } = await callerClient.rpc('has_role', {
      _user_id: caller.id,
      _role: 'company_admin',
    });
    if (!roleCheck) return json({ error: 'Forbidden: company_admin required' }, 403);

    const body = await req.json();
    const expertId: string | undefined = body.expert_id;
    const action: Action | undefined = body.action;

    if (!expertId || !action) return json({ error: 'expert_id 與 action 為必填' }, 400);
    if (!['fetch_email', 'update_email', 'reset_password', 'send_reset_email'].includes(action)) {
      return json({ error: 'Invalid action' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Resolve target user from expert_id
    const { data: expert, error: expertErr } = await adminClient
      .from('experts')
      .select('id, user_id, name')
      .eq('id', expertId)
      .single();
    if (expertErr || !expert) return json({ error: '找不到該分析師' }, 404);

    const targetUserId: string = expert.user_id;

    // Prevent admin from operating on themselves via this endpoint
    if (targetUserId === caller.id) {
      return json({ error: '不可對自己的帳號操作，請至「個人設定」修改' }, 400);
    }

    // Get current auth user
    const { data: targetUserRes, error: getUserErr } = await adminClient.auth.admin.getUserById(targetUserId);
    if (getUserErr || !targetUserRes?.user) return json({ error: '找不到對應的登入帳號' }, 404);
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
        return json({ error: '此帳號透過 LINE 登入綁定，不可修改 Email' }, 400);
      }
      const newEmail: string = body.email;
      if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return json({ error: 'Email 格式錯誤' }, 400);
      }
      if (newEmail.endsWith('@line.local')) {
        return json({ error: '不可使用保留網域 @line.local' }, 400);
      }

      const { error: updErr } = await adminClient.auth.admin.updateUserById(targetUserId, {
        email: newEmail,
        email_confirm: true,
      });
      if (updErr) return json({ error: translateAuthError(updErr.message) }, 400);

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
        return json({ error: '密碼至少需 8 碼' }, 400);
      }
      if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        return json({ error: '密碼需包含英文字母與數字' }, 400);
      }

      const { error: updErr } = await adminClient.auth.admin.updateUserById(targetUserId, {
        password: newPassword,
      });
      if (updErr) return json({ error: translateAuthError(updErr.message) }, 400);

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
        return json({ error: '此帳號透過 LINE 登入，無有效信箱可寄送' }, 400);
      }
      if (!targetEmail) return json({ error: '帳號無 Email 無法寄送' }, 400);

      const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
        type: 'recovery',
        email: targetEmail,
        options: { redirectTo: `${siteUrl}/reset-password` },
      });
      if (linkErr || !linkData?.properties?.action_link) {
        return json({ error: linkErr ? translateAuthError(linkErr.message) : '產生重設連結失敗' }, 400);
      }
      const actionLink = linkData.properties.action_link;

      if (!resendKey) {
        return json({ error: 'RESEND_API_KEY 未設定，無法寄信' }, 500);
      }

      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#ffffff;color:#111827">
          <h2 style="margin:0 0 16px;font-size:20px;color:#111827">分析師後台密碼重設</h2>
          <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#374151">您好 ${escapeHtml(expert.name)}，</p>
          <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#374151">系統管理員為您發起密碼重設。請點擊下方連結設定新密碼（連結將在 60 分鐘內失效）：</p>
          <p style="margin:24px 0">
            <a href="${actionLink}" style="display:inline-block;padding:12px 24px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600">設定新密碼</a>
          </p>
          <p style="margin:0 0 8px;font-size:12px;color:#6b7280">若按鈕無法點擊，請複製下方網址至瀏覽器開啟：</p>
          <p style="margin:0 0 24px;font-size:12px;color:#6b7280;word-break:break-all">${actionLink}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
          <p style="margin:0;font-size:12px;color:#9ca3af">若您並未提出此請求，請忽略此信。 — LegendFlow</p>
        </div>
      `;

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'LegendFlow <noreply@legendflow.tw>',
          to: [targetEmail],
          subject: '【LegendFlow】分析師後台密碼重設',
          html,
        }),
      });
      if (!resendRes.ok) {
        const errText = await resendRes.text();
        return json({ error: `寄信失敗：${errText}` }, 500);
      }

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
    return json({ error: (err as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * 將 Supabase Auth 原始英文錯誤訊息翻譯成中文，並附上「怎麼解」的指引。
 * 對照表來源：Supabase GoTrue / Auth API 常見錯誤碼。
 */
function translateAuthError(raw: string): string {
  const msg = (raw || '').toLowerCase();

  // ── 密碼類 ──────────────────────────────────────────────
  if (msg.includes('password is known to be weak') || msg.includes('pwned')) {
    return '此密碼曾在資料外洩名單中或過於常見，請改用獨特的新密碼（建議：英文大小寫 + 數字 + 符號，例如 Lf-Mx7q!92Kp）';
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

  // ── 其他：原樣回傳但加前綴提示，方便判斷 ──────────────
  return `操作失敗：${raw}（如持續發生請聯繫工程師）`;
}

