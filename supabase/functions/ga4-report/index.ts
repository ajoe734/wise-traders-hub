// ga4-report: read-only GA4 Data API report for /company/traffic.
// AUTH: company_admin — Google key and access token never leave this function.
import { requireCompanyAdmin, authErrorResponse } from '../_shared/adminGuard.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { runGa4Report } from '../_shared/ga4ReportCore.ts';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    await requireCompanyAdmin(req);
  } catch (e) {
    return authErrorResponse(e, req);
  }
  const body = await req.json().catch(() => ({}));
  try {
    const result = await runGa4Report((n) => Deno.env.get(n), { startDate: body?.startDate, endDate: body?.endDate }, fetch);
    if (result.status !== 'OK' && result.status !== 'NO_DATA') console.error('ga4-report', result.status, result.message);
    // Status is carried in the body (200) so the admin UI can show the real state.
    return json(result, result.status === 'INVALID_INPUT' ? 400 : 200);
  } catch (e) {
    console.error('ga4-report unexpected', e);
    return json({ status: 'QUERY_ERROR', message: `GA4 查詢失敗：${(e as Error).message}`, serviceAccountEmail: null }, 200);
  }
});
