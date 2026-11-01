import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRateLimiter, projectRows, safeEqual, validateRange } from '../_shared/igReportCore.ts';

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
  return json(projectRows((data ?? []) as Array<Record<string, unknown>>));
});
