import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRateLimiter, groupExpertDaily, projectRows, safeEqual, taipeiBounds, validateRange } from '../_shared/igReportCore.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-report-key, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });

const allow = createRateLimiter();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405, { Allow: 'GET' });

  const expected = Deno.env.get('REPORT_API_KEY') ?? '';
  const given = req.headers.get('x-report-key') ?? '';
  if (expected.length < 48 || !safeEqual(given, expected)) return json({ error: 'unauthorized' }, 401);

  if (!allow(Date.now())) return json({ error: 'rate limit exceeded' }, 429, { 'Retry-After': '60' });

  const url = new URL(req.url);
  const range = validateRange(url.searchParams.get('since'), url.searchParams.get('until'));
  if (!range.ok) return json({ error: range.error }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await admin.rpc('get_ig_conversion_report', { _since: range.since, _until: range.until });
  if (error) {
    console.error('[ig-conversion-report] rpc failed', error.code);
    return json({ error: 'report unavailable' }, 500);
  }

  // Same source and filter as get_expert_revenue_breakdown (/company/expert-revenue).
  const { from, to } = taipeiBounds(range.since, range.until);
  const splits: Array<{ created_at: string; expert_slug: string | null; gross: unknown; net: unknown; expert_amount: unknown }> = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data: page, error: e2 } = await admin
      .from('revenue_splits')
      .select('id, created_at, expert_id, gross, net, expert_amount')
      .not('expert_id', 'is', null)
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (e2) {
      console.error('[ig-conversion-report] splits failed', e2.code);
      return json({ error: 'report unavailable' }, 500);
    }
    for (const r of (page ?? []) as Array<Record<string, any>>) {
      splits.push({ created_at: r.created_at, expert_slug: r.expert_id, gross: r.gross, net: r.net, expert_amount: r.expert_amount });
    }
    if (!page || page.length < PAGE) break;
  }

  // revenue_splits has no FK to experts; resolve slugs (legendflow.tw/expert/<slug>) separately.
  const ids = [...new Set(splits.map((x) => x.expert_slug).filter(Boolean))] as string[];
  const slugs = new Map<string, string>();
  if (ids.length) {
    const { data: ex, error: e3 } = await admin.from('experts').select('id, slug').in('id', ids);
    if (e3) {
      console.error('[ig-conversion-report] experts failed', e3.code);
      return json({ error: 'report unavailable' }, 500);
    }
    for (const e of ex ?? []) if (e.slug) slugs.set(e.id, e.slug);
  }
  for (const x of splits) x.expert_slug = x.expert_slug ? slugs.get(x.expert_slug) ?? null : null;

  return json({
    rows: projectRows((data ?? []) as Array<Record<string, unknown>>),
    expert_daily: groupExpertDaily(splits, range.since, range.until),
  });
});
