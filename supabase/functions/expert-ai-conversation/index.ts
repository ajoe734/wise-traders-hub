// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// GET  ?expert_id=... → 取或建 conversation, 回歷史訊息
// DELETE ?expert_id=... → 清空該 conversation 的所有 messages
import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
import { jsonResponse, errorResponse } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { getExpertAiQuota } from '../_shared/expert-ai-quota.ts';

Deno.serve(withLogging('expert-ai-conversation', async (req, _log) => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('unauthorized', 401);

  const url = new URL(req.url);
  const expertId = url.searchParams.get('expert_id');
  if (!expertId) return errorResponse('expert_id required', 400);

  const uc = userClient(req);
  const { data: userData } = await uc.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return errorResponse('unauthorized', 401);

  const admin = serviceClient();

  if (req.method === 'GET') {
    let { data: conv } = await admin
      .from('expert_ai_conversations')
      .select('id, title, created_at, last_message_at')
      .eq('user_id', uid)
      .eq('expert_id', expertId)
      .maybeSingle();

    if (!conv) {
      const { data: exp } = await admin.from('experts').select('name').eq('id', expertId).maybeSingle();
      const { data: newConv, error: cErr } = await admin
        .from('expert_ai_conversations')
        .insert({ user_id: uid, expert_id: expertId, title: `與 ${exp?.name || '導師'} 對話` })
        .select('id, title, created_at, last_message_at')
        .single();
      if (cErr) return errorResponse('create conv failed: ' + cErr.message, 500);
      conv = newConv;
    }

    const { data: messages } = await admin
      .from('expert_ai_messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true });

    const { data: exp } = await admin.from('experts').select('user_id').eq('id', expertId).maybeSingle();
    const quota = await getExpertAiQuota(admin, uid, {
      exemptExpertOwner: true,
      expertOwnerId: exp?.user_id ?? null,
    });

    return jsonResponse({ conversation: conv, messages: messages || [], quota });
  }

  if (req.method === 'DELETE') {
    const { data: conv } = await admin
      .from('expert_ai_conversations')
      .select('id')
      .eq('user_id', uid)
      .eq('expert_id', expertId)
      .maybeSingle();
    if (conv) {
      await admin.from('expert_ai_messages').delete().eq('conversation_id', conv.id);
      await admin
        .from('expert_ai_conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conv.id);
    }
    return jsonResponse({ ok: true });
  }

  return errorResponse('method not allowed', 405);
}));
