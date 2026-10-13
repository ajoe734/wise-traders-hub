// AUTH: user+cron  老師／管理員觸發單篇，或排程（X-Cron-Key）掃描到期文章
import { serviceClient } from '../_shared/supabaseClients.ts';
import { isCompanyAdmin } from '../_shared/adminGuard.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireCaller, requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { fetchWithRetry } from '../_shared/retryFetch.ts';
import { buildNotificationRow, articleDetailUrl } from '../_shared/routes.ts';
import {
  planArticleAudience, buildArticleFlex, articleInappText, isArticlePushDue, ARTICLE_PUSH_STALE_MS,
} from '../_shared/articlePushCore.ts';

const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast';
const SITE = 'https://legendflow.tw';
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

type Admin = ReturnType<typeof serviceClient>;

async function sendLineBatch(token: string, to: string[], message: unknown): Promise<string | null> {
  try {
    const res = await fetchWithRetry(LINE_MULTICAST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [message] }),
    }, { source: 'line_multicast_article' });
    if (res.ok) return null;
    return `${res.status} ${(await res.text()).slice(0, 200)}`;
  } catch (e) {
    return String((e as Error)?.message ?? e).slice(0, 200);
  }
}

async function deliver(admin: Admin, art: any, onlyUserIds?: Set<string>) {
  const revision: number = art.revision;
  const isRepush = revision > 0;
  const { data: expert } = await admin.from('experts').select('id, name').eq('id', art.expert_id).single();
  const { data: plans } = await admin.from('expert_plans').select('id').eq('expert_id', art.expert_id);
  const planIds = new Set((plans || []).map((p: any) => p.id as string));
  const { data: subs } = planIds.size
    ? await admin.from('member_subscriptions').select('user_id, plan_id, canceled_at, expires_at')
        .in('plan_id', [...planIds]).eq('status', 'active')
    : { data: [] as any[] };
  const { data: bindings } = await admin.from('member_line_bindings').select('user_id, line_user_id')
    .eq('expert_id', art.expert_id).eq('is_active', true);
  const { data: channel } = await admin.from('expert_line_channels').select('channel_access_token, is_active')
    .eq('expert_id', art.expert_id).maybeSingle();
  const hasChannel = !!(channel?.is_active && channel.channel_access_token);

  let audience = planArticleAudience((subs || []) as any, hasChannel ? (bindings || []) as any : [], planIds);
  if (onlyUserIds) {
    audience = {
      line: audience.line.filter((b) => onlyUserIds.has(b.user_id)),
      inapp: audience.inapp.filter((u) => onlyUserIds.has(u)),
    };
  }

  // 寫入紀錄；唯一鍵擋重複，只對新插入（或重試時的失敗列）送出
  const rows = [
    ...audience.line.map((b) => ({ article_id: art.id, expert_id: art.expert_id, user_id: b.user_id, revision, channel: 'line', status: 'pending' })),
    ...audience.inapp.map((u) => ({ article_id: art.id, expert_id: art.expert_id, user_id: u, revision, channel: 'inapp', status: 'pending' })),
  ];
  let claimed = new Set<string>();
  if (rows.length) {
    if (onlyUserIds) {
      const { data } = await admin.from('expert_article_push_log').update({ status: 'pending', error: null, updated_at: new Date().toISOString() })
        .eq('article_id', art.id).eq('revision', revision).eq('status', 'failed').in('user_id', [...onlyUserIds]).select('user_id');
      claimed = new Set((data || []).map((r: any) => r.user_id));
    } else {
      const { data } = await admin.from('expert_article_push_log')
        .upsert(rows, { onConflict: 'article_id,user_id,revision', ignoreDuplicates: true }).select('user_id');
      claimed = new Set((data || []).map((r: any) => r.user_id));
    }
  }

  const url = `${SITE}${articleDetailUrl(art.id)}`;
  const flex = buildArticleFlex({
    expertName: expert?.name ?? '老師', title: art.title, lede: art.lede, trialHtml: art.trial_html,
    bodyHtml: art.body_html, coverUrl: art.cover_url, url, isRepush,
  });
  const lineTargets = audience.line.filter((b) => claimed.has(b.user_id));
  let lineSent = 0, lineFailed = 0;
  for (let i = 0; i < lineTargets.length; i += 500) {
    const batch = lineTargets.slice(i, i + 500);
    const err = await sendLineBatch(channel!.channel_access_token, batch.map((b) => b.line_user_id), flex);
    await admin.from('expert_article_push_log').update({ status: err ? 'failed' : 'sent', error: err, updated_at: new Date().toISOString() })
      .eq('article_id', art.id).eq('revision', revision).in('user_id', batch.map((b) => b.user_id));
    if (err) lineFailed += batch.length; else lineSent += batch.length;
  }

  const inappTargets = audience.inapp.filter((u) => claimed.has(u));
  let inappSent = 0, inappFailed = 0;
  const txt = articleInappText(expert?.name ?? '老師', art.title, isRepush);
  for (let i = 0; i < inappTargets.length; i += 500) {
    const batch = inappTargets.slice(i, i + 500);
    const { error } = await admin.from('notifications').insert(
      batch.map((u) => buildNotificationRow({ userId: u, title: txt.title, body: txt.body, link: articleDetailUrl(art.id) })),
    );
    await admin.from('expert_article_push_log').update({ status: error ? 'failed' : 'sent', error: error?.message ?? null, updated_at: new Date().toISOString() })
      .eq('article_id', art.id).eq('revision', revision).in('user_id', batch);
    if (error) inappFailed += batch.length; else inappSent += batch.length;
  }
  return { article_id: art.id, revision, line_sent: lineSent, line_failed: lineFailed, inapp_sent: inappSent, inapp_failed: inappFailed, line_channel: hasChannel };
}

/** 管理員驗收：只送給指定一人，不寫推播紀錄、不改通知狀態、不看訂閱（草稿也可） */
async function deliverTest(admin: Admin, art: any, testUserId: string) {
  const { data: expert } = await admin.from('experts').select('id, name').eq('id', art.expert_id).single();
  const { data: channel } = await admin.from('expert_line_channels').select('channel_access_token, is_active')
    .eq('expert_id', art.expert_id).maybeSingle();
  const { data: bind } = await admin.from('member_line_bindings').select('line_user_id')
    .eq('expert_id', art.expert_id).eq('user_id', testUserId).eq('is_active', true).maybeSingle();
  const url = `${SITE}${articleDetailUrl(art.id)}`;
  const result: Record<string, unknown> = { test: true, line_bound: !!bind, line_channel: !!(channel?.is_active && channel.channel_access_token) };
  if (bind && channel?.is_active && channel.channel_access_token) {
    const flex = buildArticleFlex({ expertName: expert?.name ?? '老師', title: art.title, lede: art.lede, trialHtml: art.trial_html, bodyHtml: art.body_html, coverUrl: art.cover_url, url, isRepush: false });
    const err = await sendLineBatch(channel.channel_access_token, [bind.line_user_id], flex);
    result.line = err ? `failed: ${err}` : 'sent';
  }
  const txt = articleInappText(expert?.name ?? '老師', art.title, false);
  const { error } = await admin.from('notifications').insert(buildNotificationRow({ userId: testUserId, title: `【測試】${txt.title}`, body: txt.body, link: articleDetailUrl(art.id) }));
  result.inapp = error ? `failed: ${error.message}` : 'sent';
  return result;
}

async function claimAndDeliver(admin: Admin, articleId: string) {
  const { data, error } = await admin.rpc('claim_article_push', { _article_id: articleId });
  if (error) throw error;
  const art = Array.isArray(data) ? data[0] : data;
  if (!art) return { article_id: articleId, skipped: 'not_due_or_already_notified' };
  return await deliver(admin, art);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = serviceClient();
  try {
    const isCron = !!(req.headers.get('x-cron-key') ?? req.headers.get('X-Cron-Key'));
    if (isCron) {
      requireCronKey(req);
      const since = new Date(Date.now() - ARTICLE_PUSH_STALE_MS).toISOString();
      const { data: rows } = await admin.from('expert_articles')
        .select('id, status, publish_at, push_revision, notified_revision')
        .eq('status', 'published').lte('publish_at', new Date().toISOString()).limit(500);
      const due = (rows || []).filter((r: any) => isArticlePushDue(r) && (r.notified_revision != null || r.publish_at >= since));
      const results = [];
      for (const r of due) results.push(await claimAndDeliver(admin, r.id));
      await admin.from('system_jobs_log').insert({ job_name: 'article-push', status: 'ok', detail: { due: due.length, results } } as any).then(() => {}, () => {});
      return json({ ok: true, due: due.length, results });
    }

    const userId = await requireCaller(req);
    const body = await req.json().catch(() => ({}));
    const articleId = typeof body?.article_id === 'string' ? body.article_id : '';
    if (!/^[0-9a-f-]{36}$/i.test(articleId)) return json({ error: 'article_id 必填' }, 400);
    const mode = body?.mode === 'retry_failed' ? 'retry_failed' : 'publish';

    const { data: art } = await admin.from('expert_articles').select('id, expert_id, title, lede, trial_html, body_html, cover_url, push_revision, notified_revision').eq('id', articleId).maybeSingle();
    if (!art) return json({ error: 'not_found' }, 404);
    const { data: ex } = await admin.from('experts').select('user_id').eq('id', art.expert_id).single();
    if (ex?.user_id !== userId && !(await isCompanyAdmin(userId))) return json({ error: 'forbidden' }, 403);

    if (body?.mode === 'test_to_user') {
      if (!(await isCompanyAdmin(userId))) return json({ error: 'forbidden' }, 403);
      const tu = typeof body?.test_user_id === 'string' ? body.test_user_id : '';
      if (!/^[0-9a-f-]{36}$/i.test(tu)) return json({ error: 'test_user_id 必填' }, 400);
      return json({ ok: true, ...(await deliverTest(admin, art, tu)) });
    }
    if (mode === 'retry_failed') {
      if (art.notified_revision == null) return json({ error: 'not_notified_yet' }, 400);
      const { data: failed } = await admin.from('expert_article_push_log').select('user_id')
        .eq('article_id', articleId).eq('revision', art.notified_revision).eq('status', 'failed');
      const ids = new Set((failed || []).map((r: any) => r.user_id as string));
      if (!ids.size) return json({ ok: true, retried: 0 });
      return json({ ok: true, ...(await deliver(admin, { ...art, revision: art.notified_revision }, ids)) });
    }
    return json({ ok: true, ...(await claimAndDeliver(admin, articleId)) });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.code }, e.status);
    console.error('article-push error', e);
    return json({ error: 'internal' }, 500);
  }
});
