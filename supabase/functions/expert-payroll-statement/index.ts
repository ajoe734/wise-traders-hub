// expert-payroll-statement: 老師本人（或公司管理員）讀取自己的月結薪資原始資料，
// 前端用與管理員相同的 computePayroll 計算並匯出。只讀、只回該老師的資料。
// AUTH: requireExpertOwnerOrAdmin（身分取自 JWT，不信任 body 以外的身分欄位）。
import { requireExpertOwnerOrAdmin, authErrorResponse } from '../_shared/adminGuard.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function all(build: () => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

async function inChunks(ids: string[], build: (chunk: string[]) => any): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...await all(() => build(ids.slice(i, i + 150))));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const body = await req.json().catch(() => ({}));
  const expertId = String(body?.expert_id || '');
  if (!UUID.test(expertId)) return json({ error: 'invalid_expert_id' }, 400);
  try {
    await requireExpertOwnerOrAdmin(req, expertId);
  } catch (e) {
    return authErrorResponse(e, req);
  }
  try {
    const db = serviceClient();
    const [splits, experts, locks, plans] = await Promise.all([
      all(() => db.from('revenue_splits').select('id, transaction_id, expert_id, expert_amount, net, platform_amount, rule_source').eq('expert_id', expertId).order('id')),
      db.from('experts').select('id, name, role').eq('id', expertId).then((r: any) => { if (r.error) throw r.error; return r.data || []; }),
      all(() => db.from('expert_payouts').select('*').eq('expert_id', expertId).order('id')),
      all(() => db.from('expert_plans').select('id, name').eq('expert_id', expertId).order('id')),
    ]);
    const txIds = [...new Set(splits.map((s) => s.transaction_id).filter(Boolean))];
    const [txs, refundLogs] = await Promise.all([
      inChunks(txIds, (c) => db.from('payment_transactions').select('id, status, paid_at, created_at, subscription_id, amount').in('id', c).order('id')),
      inChunks(txIds, (c) => db.from('audit_logs').select('id, target_id, created_at').eq('action', 'payment.refund').in('target_id', c).order('id')),
    ]);
    const subIds = [...new Set(txs.map((t) => t.subscription_id).filter(Boolean))];
    const subs = await inChunks(subIds, (c) => db.from('member_subscriptions').select('id, user_id, billing_cycle, plan_id').in('id', c).order('id'));
    const userIds = [...new Set(subs.map((s) => s.user_id).filter(Boolean))];
    const profiles = await inChunks(userIds, (c) => db.from('profiles').select('user_id, display_name, is_tester').in('user_id', c).order('user_id'));
    return json({ splits, txs, subs, experts, locks, plans, profiles, refundLogs: refundLogs.map(({ target_id, created_at }) => ({ target_id, created_at })) });
  } catch (e) {
    console.error('expert-payroll-statement', e);
    return json({ error: 'query_failed' }, 500);
  }
});
