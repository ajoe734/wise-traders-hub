import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u, error } = await userClient.auth.getUser();
  if (error || !u.user) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: prof } = await admin.from('profiles').select('line_user_id').eq('id', u.user.id).maybeSingle();
  const lineUserId = (prof as any)?.line_user_id;
  const token = Deno.env.get('PLATFORM_LINE_CHANNEL_TOKEN');
  if (!lineUserId || !token) return json({ isFriend: false, reason: !lineUserId ? 'no_line' : 'no_token' });

  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    await r.body?.cancel();
    return json({ isFriend: r.ok });
  } catch {
    return json({ isFriend: false, reason: 'line_error' });
  }
});
