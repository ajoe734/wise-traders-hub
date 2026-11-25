import { supabase } from '@/integrations/supabase/client';

/** payment_intents has no foreign keys, so PostgREST embeds (expert_plans:plan_id(...)) fail with PGRST200.
 *  Attach plan/expert/checkup-plan names with separate lookups instead. */
export const PAYMENT_INTENT_COLUMNS = 'id, status, trade_no, product_kind, plan_id, checkup_plan_id, expert_id, amount, billing_cycle, created_at';

type Row = { plan_id?: string | null; checkup_plan_id?: string | null };
export type WithPlans<T> = T & {
  expert_plans: { name: string; experts?: { name: string; slug: string } } | null;
  checkup_plans: { name: string } | null;
};

export async function attachIntentPlans<T extends Row>(rows: T[]): Promise<WithPlans<T>[]> {
  const planIds = [...new Set(rows.map((r) => r.plan_id).filter(Boolean))] as string[];
  const checkupIds = [...new Set(rows.map((r) => r.checkup_plan_id).filter(Boolean))] as string[];
  const [plans, checkups] = await Promise.all([
    planIds.length
      ? supabase.from('expert_plans').select('id, name, experts(name, slug)').in('id', planIds)
      : Promise.resolve({ data: [] as any[] }),
    checkupIds.length
      ? supabase.from('checkup_plans' as any).select('id, name').in('id', checkupIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const planMap = new Map(((plans.data as any[]) ?? []).map((p) => [p.id, { name: p.name, experts: p.experts ?? undefined }]));
  const checkupMap = new Map(((checkups.data as any[]) ?? []).map((p) => [p.id, { name: p.name }]));
  return rows.map((r) => ({
    ...r,
    expert_plans: (r.plan_id && planMap.get(r.plan_id)) || null,
    checkup_plans: (r.checkup_plan_id && checkupMap.get(r.checkup_plan_id)) || null,
  }));
}
