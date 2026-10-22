// AUTH: user — Bearer JWT verified via auth.getUser() below
import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
import { requireCompanyAdmin, authErrorResponse } from '../_shared/adminGuard.ts';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

async function checkFriend(admin: any, lineUserId: string | null | undefined) {
  const token = Deno.env.get('PLATFORM_LINE_CHANNEL_TOKEN');
  if (!lineUserId || !token) return { isFriend: false, reason: !lineUserId ? 'no_line' : 'no_token' };
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    await r.body?.cancel();
    return { isFriend: r.ok, lineUserId };
  } catch {
    return { isFriend: false, reason: 'line_error' };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

  // Admin diagnostic mode: check another user's friend status (?user_id=...)
  const url = new URL(req.url);
  const targetUserId = url.searchParams.get('user_id');
  if (targetUserId) {
    try {
      await requireCompanyAdmin(req);
    } catch (e) {
      return authErrorResponse(e, req);
    }
    const admin = serviceClient();
    const { data: prof } = await admin.from('profiles').select('line_user_id, is_line_friend').eq('user_id', targetUserId).maybeSingle();
    const out = await checkFriend(admin, (prof as any)?.line_user_id);
    return json({ ...out, storedFlag: (prof as any)?.is_line_friend ?? null });
  }

  // Self mode: caller's own friend status
  const { data: u, error } = await userClient(req).auth.getUser();
  if (error || !u.user) return json({ error: 'unauthorized' }, 401);

  const admin = serviceClient();
  const { data: prof } = await admin.from('profiles').select('line_user_id').eq('user_id', u.user.id).maybeSingle();
  const out = await checkFriend(admin, (prof as any)?.line_user_id);
  return json(out);
});
